import * as Sentry from "@sentry/node";
import { prisma } from '../configs/prisma.js';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import axios from 'axios';
import { Client } from '@gradio/client';
import { GoogleGenAI, Modality } from '@google/genai';
import { getGeminiKeys, isGeminiQuotaError } from '../utils/apiPool.js';
const DEFAULT_GEMINI_IMAGE_MODELS = [
    'gemini-2.5-flash-image',
    'gemini-2.5-flash-image-preview',
];
const normalizeGeminiModelName = (model) => model.trim().replace(/^models\//, '');
const isDeprecatedGeminiImageModel = (model) => normalizeGeminiModelName(model).includes('gemini-2.0-flash-preview-image-generation');
const isProGeminiImageModel = (model) => normalizeGeminiModelName(model).includes('gemini-3-pro-image');
const getGeminiImageModels = () => {
    const configuredModels = process.env.GEMINI_IMAGE_MODELS || '';
    const allowProImageModel = process.env.ENABLE_GEMINI_PRO_IMAGE === 'true';
    const models = configuredModels
        .split(',')
        .map(normalizeGeminiModelName)
        .filter(Boolean)
        .filter(model => !isDeprecatedGeminiImageModel(model))
        .filter(model => allowProImageModel || !isProGeminiImageModel(model));
    return [...new Set([...DEFAULT_GEMINI_IMAGE_MODELS, ...models])];
};
export const getActiveGeminiImageModels = () => getGeminiImageModels();
const getGeminiErrorPayload = (error) => {
    if (error?.error)
        return error.error;
    if (error?.response?.data?.error)
        return error.response.data.error;
    if (typeof error?.message === 'string') {
        try {
            const parsed = JSON.parse(error.message);
            return parsed?.error || parsed;
        }
        catch {
            return undefined;
        }
    }
    return undefined;
};
const getGeminiRetryDelay = (error) => {
    const payload = getGeminiErrorPayload(error);
    const retryInfo = payload?.details?.find((detail) => detail?.['@type']?.includes('RetryInfo'));
    return retryInfo?.retryDelay;
};
const getFriendlyGeminiQuotaMessage = (error) => {
    const retryDelay = getGeminiRetryDelay(error);
    return `Gemini image generation quota is exhausted${retryDelay ? `; retry after ${retryDelay}` : ''}. Please enable billing or use API keys from a Google AI project with available image-generation quota.`;
};
const uploadBufferToCloudinary = (buffer, resourceType = 'image') => new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ resource_type: resourceType }, (error, result) => {
        if (error || !result?.secure_url) {
            reject(error || new Error('Cloudinary upload failed'));
            return;
        }
        resolve(result.secure_url);
    });
    stream.end(buffer);
});
const getAdImagePrompt = ({ productName, productDescription, userPrompt, aspectRatio, }) => `Create a premium photorealistic lifestyle advertising image using the two provided reference images.

Reference image 1 is the product. Keep the product identity, color, shape, important details, and proportions recognizable.
Reference image 2 is the model/person. Keep the same person recognizable, with a natural expression and realistic body pose.

Scene direction:
- Product: ${productName}
- Product notes: ${productDescription || 'Use the product as the hero object.'}
- User direction: ${userPrompt || 'Create an upscale airport lounge / premium travel ad scene where the model naturally holds or presents the product.'}
- Recreate the person and product together in one new realistic scene, similar to a professional campaign photo.
- The model must physically interact with the product, for example one hand holding the luggage handle and the other hand pointing at or presenting it.
- Make the product large, sharp, and hero-sized in the foreground, not tiny on the shirt.
- The model should be positioned behind or beside the product with believable body pose, hands, contact, perspective, and shadows.
- Use realistic lighting, reflections, floor contact shadows, and depth of field.
- Use a modern travel/lobby/airport lounge, premium studio, or clean black-white editorial background.
- Do not create a poster, collage, sticker, flat overlay, cutout, or product pasted on top of the model.
- Do not put the product on the model's chest.
- Do not add title text, brand text, watermark, UI, borders, or captions.
- Avoid distorted hands, distorted face, incorrect product wheels/handles, and duplicate products.
- Output aspect ratio should feel like ${aspectRatio || '9:16'}.
`;
const generateLifestyleAdImage = async ({ productFile, modelFile, productName, productDescription, userPrompt, aspectRatio, }) => {
    const productImageBase64 = fs.readFileSync(productFile.path).toString('base64');
    const modelImageBase64 = fs.readFileSync(modelFile.path).toString('base64');
    const prompt = getAdImagePrompt({ productName, productDescription, userPrompt, aspectRatio });
    let lastError;
    let lastQuotaError;
    for (const model of getGeminiImageModels()) {
        for (const apiKey of getGeminiKeys()) {
            try {
                console.log(`[Image Gen] Trying ${model} with key ending in ...${apiKey.slice(-4)}`);
                const ai = new GoogleGenAI({ apiKey });
                const response = await ai.models.generateContent({
                    model,
                    contents: [
                        { text: prompt },
                        {
                            inlineData: {
                                mimeType: productFile.mimetype || 'image/jpeg',
                                data: productImageBase64,
                            },
                        },
                        {
                            inlineData: {
                                mimeType: modelFile.mimetype || 'image/jpeg',
                                data: modelImageBase64,
                            },
                        },
                    ],
                    config: {
                        responseModalities: [Modality.TEXT, Modality.IMAGE],
                    },
                });
                const imagePart = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data);
                const imageData = imagePart?.inlineData?.data;
                if (!imageData) {
                    throw new Error('Gemini image model returned no image');
                }
                return Buffer.from(imageData, 'base64');
            }
            catch (error) {
                lastError = error;
                if (isGeminiQuotaError(error)) {
                    lastQuotaError = error;
                    console.warn(`[Image Gen] ${model} key ...${apiKey.slice(-4)} quota/rate limited. Trying next key.`);
                    continue;
                }
                console.warn(`[Image Gen] ${model} key ...${apiKey.slice(-4)} failed. Trying next option.`, error?.message || error);
            }
        }
    }
    if (lastQuotaError) {
        throw new Error(getFriendlyGeminiQuotaMessage(lastQuotaError));
    }
    throw lastError || new Error('Gemini image generation failed');
};
export const createProject = async (req, res) => {
    let tempProjectId;
    const { userId } = req.auth();
    let isCreditDeducted = false;
    const { name = 'New Project', aspectRatio, userPrompt, productName, productDescription, targetLength = 5 } = req.body;
    const images = req.files;
    if (images.length < 2 || !productName) {
        return res.status(400).json({ message: 'Please provide at least 2 images' });
    }
    let user = await prisma.user.findUnique({
        where: { id: userId },
    });
    // Auto-Onboarding
    if (!user) {
        user = await prisma.user.create({
            data: {
                id: userId,
                email: "",
                name: "New User",
                image: "",
                credits: 20
            }
        });
    }
    if (user.credits < 5) {
        return res.status(401).json({ message: 'Insufficient credits' });
    }
    else {
        await prisma.user.update({
            where: { id: userId },
            data: { credits: { decrement: 5 } }
        }).then(() => {
            isCreditDeducted = true;
        });
    }
    try {
        let uploadedImages = await Promise.all(images.map(async (item) => {
            let result = await cloudinary.uploader.upload(item.path, { resource_type: 'image' });
            return result.secure_url;
        }));
        const project = await prisma.project.create({
            data: {
                name,
                userId,
                productName,
                productDescription,
                userPrompt,
                aspectRatio,
                targetLength: Number(targetLength),
                uploadedImages,
                isGenerating: true
            }
        });
        tempProjectId = project.id;
        let generatedImageUrl = "";
        console.log("Generating AI lifestyle ad image...");
        try {
            const generatedBuffer = await generateLifestyleAdImage({
                productFile: images[0],
                modelFile: images[1],
                productName,
                productDescription,
                userPrompt,
                aspectRatio,
            });
            generatedImageUrl = await uploadBufferToCloudinary(generatedBuffer, 'image');
            console.log("Successfully generated AI lifestyle ad image:", generatedImageUrl);
        }
        catch (error) {
            console.error('Ad Generation Failed:', error.message);
            throw new Error(error.message || 'AI lifestyle image generation failed');
        }
        await prisma.project.update({
            where: { id: project.id },
            data: {
                generatedImage: generatedImageUrl,
                isGenerating: false
            }
        });
        res.json({ projectId: project.id });
    }
    catch (error) {
        if (tempProjectId) {
            await prisma.project.update({
                where: { id: tempProjectId },
                data: { isGenerating: false, error: error.message }
            });
        }
        if (isCreditDeducted) {
            await prisma.user.update({
                where: { id: userId },
                data: { credits: { increment: 5 } }
            });
        }
        Sentry.captureException(error);
        res.status(500).json({ message: error.message });
    }
};
export const createVideo = async (req, res) => {
    const { userId } = req.auth();
    const { projectId } = req.body;
    let isCreditDeducted = false;
    let user = await prisma.user.findUnique({
        where: { id: userId }
    });
    if (!user) {
        user = await prisma.user.create({
            data: { id: userId, email: "", name: "New User", image: "", credits: 20 }
        });
    }
    if (user.credits < 10)
        return res.status(401).json({ message: 'Insufficient credits' });
    await prisma.user.update({
        where: { id: userId },
        data: { credits: { decrement: 10 } }
    }).then(() => { isCreditDeducted = true; });
    try {
        const project = await prisma.project.findUnique({
            where: { id: projectId, userId },
            include: { user: true }
        });
        if (!project || project.isGenerating)
            return res.status(404).json({ message: 'Generation already in progress' });
        if (project.generatedVideo)
            return res.status(404).json({ message: 'Video already generated' });
        await prisma.project.update({
            where: { id: projectId },
            data: { isGenerating: true }
        });
        console.log("Connecting to Gradio SVD Space...");
        try {
            // Using stable-video-diffusion for Image -> Video
            const client = await Client.connect("multimodalart/stable-video-diffusion");
            const imageResponse = await axios.get(project.generatedImage, { responseType: 'arraybuffer' });
            const sourceImage = new Blob([imageResponse.data], {
                type: imageResponse.headers['content-type'] || 'image/jpeg',
            });
            const result = await client.predict("/video", {
                image: sourceImage,
                motion_bucket_id: 127,
                cond_aug: 0.02,
                decoding_t: 1,
                seed: Math.floor(Math.random() * 100000)
            });
            const outputData = result?.data;
            let generatedVideoUrl = "";
            if (outputData && outputData.length > 0) {
                generatedVideoUrl = typeof outputData[0] === 'string' ? outputData[0] : outputData[0]?.url;
            }
            if (!generatedVideoUrl)
                throw new Error("Gradio Client SVD returned empty data");
            // Upload video to Cloudinary
            const finalUpload = await cloudinary.uploader.upload(generatedVideoUrl, { resource_type: 'video' });
            await prisma.project.update({
                where: { id: projectId },
                data: {
                    generatedVideo: finalUpload.secure_url,
                    isGenerating: false
                }
            });
            return res.json({ message: 'Video generation completed', videoUrl: finalUpload.secure_url });
        }
        catch (gradioError) {
            console.error('SVD Generation Failed:', gradioError.message);
            throw new Error(`Video generation failed over Free API: ${gradioError.message}. Please try again later.`);
        }
    }
    catch (error) {
        await prisma.project.update({
            where: { id: projectId, userId },
            data: { isGenerating: false, error: error.message }
        });
        if (isCreditDeducted) {
            await prisma.user.update({
                where: { id: userId },
                data: { credits: { increment: 10 } }
            });
        }
        Sentry.captureException(error);
        res.status(500).json({ message: error.message });
    }
};
export const getAllPublishedProjects = async (req, res) => {
    try {
        const projects = await prisma.project.findMany({
            where: { isPublished: true }
        });
        res.json({ projects });
    }
    catch (error) {
        Sentry.captureException(error);
        res.status(500).json({ message: error.message });
    }
};
export const deleteProject = async (req, res) => {
    try {
        const { userId } = req.auth();
        const projectId = req.params.projectId;
        const project = await prisma.project.findFirst({
            where: { id: projectId, userId }
        });
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }
        await prisma.project.delete({
            where: { id: projectId }
        });
        res.json({ message: 'Project deleted successfully' });
    }
    catch (error) {
        Sentry.captureException(error);
        res.status(500).json({ message: error.message });
    }
};
