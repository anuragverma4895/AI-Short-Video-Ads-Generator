import * as Sentry from "@sentry/node";
import { prisma } from '../configs/prisma.js';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Modality } from '@google/genai';
import { createGeminiClient, isGeminiQuotaError } from '../utils/apiPool.js';
const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const DEFAULT_GEMINI_VIDEO_MODEL = 'veo-3.1-generate-preview';
const DEFAULT_GEMINI_VIDEO_POLL_INTERVAL_MS = 10000;
const DEFAULT_GEMINI_VIDEO_TIMEOUT_MS = 10 * 60 * 1000;
const normalizeGeminiModelName = (model) => model.trim().replace(/^models\//, '');
const isDeprecatedGeminiImageModel = (model) => normalizeGeminiModelName(model).includes('gemini-2.0-flash-preview-image-generation');
const getConfiguredGeminiModel = (envName, fallbackModel) => {
    const configuredModel = process.env[envName]?.split(',')[0];
    const model = normalizeGeminiModelName(configuredModel || fallbackModel);
    if (!model || isDeprecatedGeminiImageModel(model)) {
        return fallbackModel;
    }
    return model;
};
const getGeminiImageModel = () => getConfiguredGeminiModel('GEMINI_IMAGE_MODEL', DEFAULT_GEMINI_IMAGE_MODEL);
const getGeminiVideoModel = () => getConfiguredGeminiModel('GEMINI_VIDEO_MODEL', DEFAULT_GEMINI_VIDEO_MODEL);
const getGeminiVideoPollIntervalMs = () => Number(process.env.GEMINI_VIDEO_POLL_INTERVAL_MS) || DEFAULT_GEMINI_VIDEO_POLL_INTERVAL_MS;
const getGeminiVideoTimeoutMs = () => Number(process.env.GEMINI_VIDEO_TIMEOUT_MS) || DEFAULT_GEMINI_VIDEO_TIMEOUT_MS;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
export const getActiveGeminiImageModels = () => [getGeminiImageModel()];
export const getActiveGeminiVideoModel = () => getGeminiVideoModel();
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
    const model = getGeminiImageModel();
    const ai = createGeminiClient();
    try {
        console.log(`[Image Gen] Generating with ${model}`);
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
        if (isGeminiQuotaError(error)) {
            throw new Error('Gemini image generation quota is exhausted or rate limited for the configured API key.');
        }
        throw error;
    }
};
const normalizeVideoAspectRatio = (aspectRatio) => aspectRatio === '16:9' ? '16:9' : '9:16';
const getAdVideoPrompt = ({ productName, productDescription, userPrompt, }) => `Create a premium short-form UGC advertising video from the provided generated lifestyle ad image.

Product: ${productName}
Product notes: ${productDescription || 'Keep the product as the hero object.'}
Creative direction: ${userPrompt || 'Create smooth camera movement for a premium social media product ad.'}

Animate the existing scene naturally with subtle cinematic camera movement, realistic lighting changes, clean product emphasis, and polished commercial pacing. Keep the same product and person recognizable. Do not add captions, logos, watermarks, UI, borders, or distorted extra products.`;
const getVideoDurationSeconds = (targetLength) => {
    const duration = Number(targetLength);
    if (!Number.isFinite(duration))
        return undefined;
    return Math.min(Math.max(Math.round(duration), 4), 8);
};
const getGeminiGeneratedVideoBuffer = async ({ imageUrl, productName, productDescription, userPrompt, aspectRatio, targetLength, }) => {
    const ai = createGeminiClient();
    const model = getGeminiVideoModel();
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageBytes = Buffer.from(imageResponse.data).toString('base64');
    const mimeType = imageResponse.headers['content-type'] || 'image/jpeg';
    const prompt = getAdVideoPrompt({ productName, productDescription, userPrompt });
    console.log(`[Video Gen] Generating with ${model}`);
    let operation = await ai.models.generateVideos({
        model,
        prompt,
        image: {
            imageBytes,
            mimeType,
        },
        config: {
            numberOfVideos: 1,
            aspectRatio: normalizeVideoAspectRatio(aspectRatio),
            durationSeconds: getVideoDurationSeconds(targetLength),
            personGeneration: 'allow_adult',
        },
    });
    const startedAt = Date.now();
    const pollIntervalMs = getGeminiVideoPollIntervalMs();
    const timeoutMs = getGeminiVideoTimeoutMs();
    while (!operation.done) {
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error('Gemini video generation timed out. Please try again later.');
        }
        console.log('[Video Gen] Waiting for Gemini video operation...');
        await wait(pollIntervalMs);
        operation = await ai.operations.getVideosOperation({ operation });
    }
    if (operation.error) {
        throw new Error(`Gemini video generation failed: ${JSON.stringify(operation.error)}`);
    }
    const generatedVideo = operation.response?.generatedVideos?.[0]?.video;
    if (!generatedVideo) {
        throw new Error('Gemini video model returned no video');
    }
    if (generatedVideo.videoBytes) {
        return Buffer.from(generatedVideo.videoBytes, 'base64');
    }
    const downloadPath = path.join(process.cwd(), `gemini-video-${Date.now()}-${Math.round(Math.random() * 1000000)}.mp4`);
    try {
        await ai.files.download({ file: generatedVideo, downloadPath });
        return await fs.promises.readFile(downloadPath);
    }
    finally {
        await fs.promises.unlink(downloadPath).catch(() => undefined);
    }
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
            throw new Error(`AI lifestyle image generation failed: ${error.message}`);
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
        if (!project.generatedImage)
            return res.status(400).json({ message: 'Please generate an image before creating a video' });
        if (project.generatedVideo)
            return res.status(404).json({ message: 'Video already generated' });
        await prisma.project.update({
            where: { id: projectId },
            data: { isGenerating: true }
        });
        console.log("Generating video with Gemini Veo...");
        try {
            const generatedVideoBuffer = await getGeminiGeneratedVideoBuffer({
                imageUrl: project.generatedImage,
                productName: project.productName,
                productDescription: project.productDescription,
                userPrompt: project.userPrompt,
                aspectRatio: project.aspectRatio,
                targetLength: project.targetLength,
            });
            const generatedVideoUrl = await uploadBufferToCloudinary(generatedVideoBuffer, 'video');
            await prisma.project.update({
                where: { id: projectId },
                data: {
                    generatedVideo: generatedVideoUrl,
                    isGenerating: false
                }
            });
            return res.json({ message: 'Video generation completed', videoUrl: generatedVideoUrl });
        }
        catch (geminiError) {
            console.error('Gemini video generation failed:', geminiError.message);
            if (isGeminiQuotaError(geminiError)) {
                throw new Error('Gemini video generation quota is exhausted or rate limited for the configured API key.');
            }
            throw new Error(`Video generation failed with Gemini: ${geminiError.message}. Please try again later.`);
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
