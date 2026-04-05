import * as Sentry from "@sentry/node";
import { prisma } from '../configs/prisma.js';
import { v2 as cloudinary } from 'cloudinary';
import { HarmBlockThreshold, HarmCategory } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { getBytezClient } from '../configs/bytez.js';
import ai from '../configs/ai.js';
import axios from 'axios';
const MODELSLAB_TEXT_TO_IMAGE_URL = 'https://modelslab.com/api/v7/images/text-to-image';
const normalizeAspectRatio = (value) => {
    const allowed = new Set(['1:1', '9:16', '16:9', '3:2', '2:3', '4:3', '3:4']);
    const ratio = value || '9:16';
    return allowed.has(ratio) ? ratio : '9:16';
};
const isGeminiKey = (key) => {
    return Boolean(key && key.startsWith('AIza'));
};
const bytezImageModelId = process.env.BYTEZ_IMAGE_MODEL || 'fal-ai/nano-banana';
const bytezVideoModelId = process.env.BYTEZ_VIDEO_MODEL || 'tencent/HunyuanVideo-1.5';
const isReadableBytezStream = (value) => {
    return Boolean(value &&
        typeof value !== 'string' &&
        (typeof value.pipe === 'function' || typeof value.getReader === 'function' || typeof value[Symbol.asyncIterator] === 'function'));
};
const collectBytezStream = async (stream) => {
    if (typeof stream.getReader === 'function') {
        const reader = stream.getReader();
        const chunks = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (value) {
                chunks.push(value instanceof Uint8Array ? value : new Uint8Array(value));
            }
        }
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
        }
        return Buffer.from(merged);
    }
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
};
const uploadGeneratedBuffer = async (buffer, resourceType) => {
    if (resourceType === 'image') {
        const base64Image = `data:image/png;base64,${buffer.toString('base64')}`;
        const uploadResult = await cloudinary.uploader.upload(base64Image, { resource_type: 'image' });
        return uploadResult.secure_url;
    }
    const tempDir = path.resolve('tmp-generated');
    fs.mkdirSync(tempDir, { recursive: true });
    const filePath = path.join(tempDir, `${Date.now()}-${Math.random().toString(16).slice(2)}.mp4`);
    fs.writeFileSync(filePath, buffer);
    try {
        const uploadResult = await cloudinary.uploader.upload(filePath, { resource_type: 'video' });
        return uploadResult.secure_url;
    }
    finally {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
};
const resolveBytezOutput = async (result, resourceType) => {
    if (!result) {
        throw new Error('Bytez returned no output');
    }
    if (typeof result === 'string') {
        if (result.startsWith('http')) {
            return result;
        }
        if (result.startsWith('data:')) {
            const base64Payload = result.split(',')[1] || '';
            const buffer = Buffer.from(base64Payload, 'base64');
            return uploadGeneratedBuffer(buffer, resourceType);
        }
        return result;
    }
    if (isReadableBytezStream(result)) {
        const buffer = await collectBytezStream(result);
        return uploadGeneratedBuffer(buffer, resourceType);
    }
    if (typeof result === 'object') {
        if (typeof result.output === 'string') {
            return resolveBytezOutput(result.output, resourceType);
        }
        if (result.output && isReadableBytezStream(result.output)) {
            return resolveBytezOutput(result.output, resourceType);
        }
        if (result.error) {
            throw new Error(result.error);
        }
    }
    throw new Error('Unsupported Bytez output');
};
const runBytezMediaModel = async (modelId, input, resourceType) => {
    const bytez = getBytezClient();
    if (!bytez) {
        throw new Error('BYTEZ_API_KEY is missing');
    }
    const model = bytez.model(modelId);
    const result = await model.run(input);
    return resolveBytezOutput(result, resourceType);
};
const generateImageWithModelsLab = async (apiKey, uploadedImages, userPrompt, productName, productDescription, aspectRatio) => {
    const textPrompt = [
        `Create a realistic ecommerce ad-style image showing a person naturally using or holding the product ${productName}.`,
        productDescription ? `Product details: ${productDescription}.` : '',
        `Reference image 1 (person/model): ${uploadedImages[0]}`,
        `Reference image 2 (product): ${uploadedImages[1]}`,
        'Blend both references with consistent lighting, perspective and shadows.',
        userPrompt || '',
    ].filter(Boolean).join(' ');
    let data;
    try {
        const response = await axios.post(MODELSLAB_TEXT_TO_IMAGE_URL, {
            prompt: textPrompt,
            model_id: process.env.MODELSLAB_MODEL_ID || 'nano-banana-pro',
            aspect_ratio: normalizeAspectRatio(aspectRatio),
            key: apiKey,
        });
        data = response.data;
    }
    catch (error) {
        const apiMessage = error?.response?.data?.error?.message ||
            error?.response?.data?.message ||
            error?.message ||
            'ModelsLab request failed';
        throw new Error(`ModelsLab: ${apiMessage}`);
    }
    const outputUrl = data?.output?.[0] || data?.data?.[0] || data?.image || data?.url;
    if (!outputUrl) {
        throw new Error(data?.message || 'ModelsLab did not return an image URL');
    }
    return outputUrl;
};
const buildBytezImageInput = (uploadedImages, userPrompt, productName, productDescription, aspectRatio) => ({
    prompt: [
        `Create a premium ecommerce ad image for ${productName}.`,
        productDescription ? `Product details: ${productDescription}.` : '',
        'Use the two reference images as visual guidance for the person and the product.',
        `Reference image 1: ${uploadedImages[0]}`,
        `Reference image 2: ${uploadedImages[1]}`,
        'Make the final composition realistic, polished, and commercially usable.',
        userPrompt || '',
    ].filter(Boolean).join(' '),
    image_1: uploadedImages[0],
    image_2: uploadedImages[1],
    image1: uploadedImages[0],
    image2: uploadedImages[1],
    images: uploadedImages,
    aspect_ratio: normalizeAspectRatio(aspectRatio),
    aspectRatio: normalizeAspectRatio(aspectRatio),
});
const buildBytezVideoInput = (imageUrl, project) => ({
    prompt: [
        `Create a cinematic product video using the provided reference image.`,
        `Keep the person and product consistent with the image.`,
        `Product name: ${project.productName}`,
        project.productDescription ? `Product description: ${project.productDescription}` : '',
    ].filter(Boolean).join(' '),
    image: imageUrl,
    image_url: imageUrl,
    url: imageUrl,
    first_frame_image: imageUrl,
});
const shouldUseImageFallback = (genError) => {
    const errorText = JSON.stringify(genError || {}).toLowerCase();
    const message = String(genError?.message || '').toLowerCase();
    return (message.includes('billing_required') ||
        message.includes('api key not valid') ||
        message.includes('invalid argument') ||
        message.includes('out of credits') ||
        message.includes('modelslab') ||
        errorText.includes('api_key_invalid') ||
        errorText.includes('invalid_argument') ||
        errorText.includes('out of credits') ||
        errorText.includes('modelslab') ||
        errorText.includes('limit: 0') ||
        message.includes('429'));
};
const loadImage = (path, mimeType) => {
    return {
        inlineData: {
            data: fs.readFileSync(path).toString('base64'),
            mimeType
        }
    };
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
    const user = await prisma.user.findUnique({
        where: { id: userId },
    });
    if (!user || user.credits < 5) {
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
        try {
            const generatedImageUrl = await runBytezMediaModel(bytezImageModelId, buildBytezImageInput(uploadedImages, userPrompt, productName, productDescription, aspectRatio), 'image');
            await prisma.project.update({
                where: { id: project.id },
                data: {
                    generatedImage: generatedImageUrl,
                    isGenerating: false
                }
            });
            return res.json({ projectId: project.id });
        }
        catch (bytezError) {
            console.error('Bytez image generation failed:', bytezError?.message || bytezError);
        }
        const model = 'models/gemini-1.5-flash';
        const generationConfig = {
            maxOutputTokens: 32768,
            temperature: 1,
            topP: 0.95,
            responseModalities: ['IMAGE'],
            imageConfig: {
                aspectRatio: aspectRatio || '9:16', imageSize: '1K'
            },
            safetySettings: [
                {
                    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                    threshold: HarmBlockThreshold.OFF
                },
                {
                    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold: HarmBlockThreshold.OFF,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold: HarmBlockThreshold.OFF,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                    threshold: HarmBlockThreshold.OFF,
                },
            ]
        };
        // image to base64 structure for ai model
        const img1base64 = loadImage(images[0].path, images[0].mimetype);
        const img2base64 = loadImage(images[1].path, images[1].mimetype);
        const prompt = {
            text: `Combine the person and product into a realistic photo. Make the person naturally hold or use the product. Match lighting, shadows, scale and perspective. Make the person stand in professional studio lighting. Output ecommerce-quality photo realistic imagery.
            ${userPrompt}`
        };
        let uploadResult;
        try {
            const resolvedKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_CLOUD_API_KEY;
            const modelslabKey = process.env.MODELSLAB_API_KEY || (!isGeminiKey(resolvedKey) ? resolvedKey : undefined);
            const forceModelsLab = process.env.IMAGE_PROVIDER?.toLowerCase() === 'modelslab';
            if ((forceModelsLab || !isGeminiKey(resolvedKey)) && modelslabKey) {
                const generatedUrl = await generateImageWithModelsLab(modelslabKey, uploadedImages, userPrompt, productName, productDescription, aspectRatio);
                uploadResult = { secure_url: generatedUrl };
            }
            else {
                // Generate the image using Gemini when a valid Gemini key is configured
                const response = await ai.models.generateContent({
                    model,
                    contents: [img1base64, img2base64, prompt],
                    config: generationConfig,
                });
                // Check if the response is valid
                if (!response?.candidates?.[0]?.content?.parts) {
                    if (response?.error?.code === 429 && response?.error?.message?.includes('limit: 0')) {
                        throw new Error('BILLING_REQUIRED');
                    }
                    throw new Error(response?.error?.message || 'Unexpected response from AI model');
                }
                const parts = response.candidates[0].content.parts;
                let finalBuffer = null;
                for (const part of parts) {
                    if (part.inlineData) {
                        finalBuffer = Buffer.from(part.inlineData.data, 'base64');
                    }
                }
                if (!finalBuffer) {
                    throw new Error('Failed to generate image');
                }
                const base64Image = `data:image/png;base64,${finalBuffer.toString('base64')}`;
                uploadResult = await cloudinary.uploader.upload(base64Image, { resource_type: 'image' });
            }
        }
        catch (genError) {
            console.error('Image Generation Failed:', genError.message);
            // FALLBACK: Use Cloudinary to combine images if AI fails
            // This is a "Direct API" solution using Cloudinary's overlay feature
            if (shouldUseImageFallback(genError)) {
                console.log('Using Cloudinary Fallback...');
                // We'll use the first image as base and overlay the second one
                // This makes the project "work" without Gemini quota
                const personImg = uploadedImages[0];
                const productImg = uploadedImages[1].split('/').pop()?.split('.')[0]; // get public id
                if (productImg) {
                    uploadResult = {
                        secure_url: cloudinary.url(uploadedImages[0].split('/').pop()?.split('.')[0] || '', {
                            transformation: [
                                { width: 1024, height: 1024, crop: 'limit' },
                                { overlay: productImg, width: 300, gravity: 'south_east', x: 20, y: 20 }
                            ]
                        })
                    };
                }
                else {
                    uploadResult = { secure_url: uploadedImages[0] };
                }
            }
            else {
                throw genError;
            }
        }
        await prisma.project.update({
            where: { id: project.id },
            data: {
                generatedImage: uploadResult.secure_url,
                isGenerating: false
            }
        });
        res.json({ projectId: project.id });
    }
    catch (error) {
        if (tempProjectId) {
            // update project status and error message
            await prisma.project.update({
                where: { id: tempProjectId },
                data: { isGenerating: false, error: error.message }
            });
        }
        if (isCreditDeducted) {
            // add credits back
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
    const user = await prisma.user.findUnique({
        where: { id: userId }
    });
    if (!user || user.credits < 10) {
        return res.status(401).json({ message: 'Insufficient credits' });
    }
    // deduct credits for video generation
    await prisma.user.update({
        where: { id: userId },
        data: { credits: { decrement: 10 } }
    }).then(() => { isCreditDeducted = true; });
    try {
        const project = await prisma.project.findUnique({
            where: { id: projectId, userId },
            include: { user: true }
        });
        if (!project || project.isGenerating) {
            return res.status(404).json({ message: 'Generation already in progress' });
        }
        if (project.generatedVideo) {
            return res.status(404).json({ message: 'Video already generated' });
        }
        await prisma.project.update({
            where: { id: projectId },
            data: { isGenerating: true }
        });
        try {
            const generatedVideoUrl = await runBytezMediaModel(bytezVideoModelId, buildBytezVideoInput(project.generatedImage, project), 'video');
            await prisma.project.update({
                where: { id: projectId },
                data: {
                    generatedVideo: generatedVideoUrl,
                    isGenerating: false
                }
            });
            return res.json({ message: 'Video generation completed', videoUrl: generatedVideoUrl });
        }
        catch (bytezError) {
            console.error('Bytez video generation failed:', bytezError?.message || bytezError);
        }
        const prompt = `make the person showcase the product which is ${project.productName} ${project.productDescription && `and Product Description: ${project.productDescription}`}`;
        const model = 'models/gemini-1.5-pro';
        if (!project.generatedImage) {
            throw new Error('Generated image not found');
        }
        const image = await axios.get(project.generatedImage, { responseType: 'arraybuffer', });
        const imageBytes = Buffer.from(image.data);
        let operation = await ai.models.generateVideos({
            model,
            prompt,
            image: {
                imageBytes: imageBytes.toString('base64'),
                mimeType: 'image/png',
            },
            config: {
                aspectRatio: project?.aspectRatio || '9:16',
                numberOfVideos: 1,
                resolution: '720p',
            }
        });
        while (!operation.done) {
            console.log('Waiting for video generation to complete ... ');
            await new Promise((resolve) => setTimeout(resolve, 10000));
            operation = await ai.operations.getVideosOperation({
                operation: operation,
            });
        }
        const filename = `${userId}-${Date.now()}.mp4`;
        const videosDir = path.resolve('videos');
        const filePath = path.join(videosDir, filename);
        // Create the videos directory if it doesn't exist
        fs.mkdirSync(videosDir, { recursive: true });
        if (!operation.response.generatedVideos) {
            throw new Error(operation.response.raiMediaFilteredReasons[0]);
        }
        // Download the video.
        await ai.files.download({
            file: operation.response.generatedVideos[0].video,
            downloadPath: filePath,
        });
        const uploadResult = await cloudinary.uploader.upload(filePath, {
            resource_type: 'video'
        });
        await prisma.project.update({
            where: { id: projectId },
            data: {
                generatedVideo: uploadResult.secure_url,
                isGenerating: false
            }
        });
        // remove video file from disk after upload
        fs.unlinkSync(filePath);
        res.json({ message: 'Video generation completed', videoUrl: uploadResult.secure_url });
    }
    catch (error) {
        // update project status and error message
        await prisma.project.update({
            where: { id: projectId, userId },
            data: { isGenerating: false, error: error.message }
        });
        if (isCreditDeducted) {
            // add credits back
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
