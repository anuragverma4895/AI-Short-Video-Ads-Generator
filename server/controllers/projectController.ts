import { Request, Response } from 'express';
import * as Sentry from "@sentry/node"
import { prisma } from '../configs/prisma.js';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';
import { getBytezClient } from '../configs/bytez.js';
import ai from '../configs/ai.js';
import axios from 'axios';

const MODELSLAB_TEXT_TO_IMAGE_URL = 'https://modelslab.com/api/v7/images/text-to-image';

const normalizeAspectRatio = (value?: string) => {
    const allowed = new Set(['1:1', '9:16', '16:9', '3:2', '2:3', '4:3', '3:4']);
    const ratio = value || '9:16';
    return allowed.has(ratio) ? ratio : '9:16';
}

const isGeminiKey = (key?: string) => {
    return Boolean(key && key.startsWith('AIza'));
}

const bytezImageModelId = process.env.BYTEZ_IMAGE_MODEL || 'fal-ai/nano-banana';
const bytezVideoModelId = process.env.BYTEZ_VIDEO_MODEL || 'tencent/HunyuanVideo-1.5';

const isReadableBytezStream = (value: any) => {
    return Boolean(
        value &&
        typeof value !== 'string' &&
        (typeof value.pipe === 'function' || typeof value.getReader === 'function' || typeof value[Symbol.asyncIterator] === 'function')
    );
};

const collectBytezStream = async (stream: any) => {
    if (typeof stream.getReader === 'function') {
        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
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

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
};

const uploadGeneratedBuffer = async (buffer: Buffer, resourceType: 'image' | 'video') => {
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
    } finally {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
};

const resolveBytezOutput = async (result: any, resourceType: 'image' | 'video') => {
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

const runBytezMediaModel = async (modelId: string, input: any, resourceType: 'image' | 'video') => {
    const bytez = getBytezClient();
    if (!bytez) {
        throw new Error('BYTEZ_API_KEY is missing');
    }

    const model = bytez.model(modelId);
    const result = await model.run(input);
    return resolveBytezOutput(result, resourceType);
};

const generateImageWithModelsLab = async (
    apiKey: string,
    uploadedImages: string[],
    userPrompt: string,
    productName: string,
    productDescription: string,
    aspectRatio?: string
) => {
    const textPrompt = [
        `Create a realistic ecommerce ad-style image showing a person naturally using or holding the product ${productName}.`,
        productDescription ? `Product details: ${productDescription}.` : '',
        `Reference image 1 (person/model): ${uploadedImages[0]}`,
        `Reference image 2 (product): ${uploadedImages[1]}`,
        'Blend both references with consistent lighting, perspective and shadows.',
        userPrompt || '',
    ].filter(Boolean).join(' ');

    let data: any;
    try {
        const response = await axios.post(MODELSLAB_TEXT_TO_IMAGE_URL, {
            prompt: textPrompt,
            model_id: process.env.MODELSLAB_MODEL_ID || 'nano-banana-pro',
            aspect_ratio: normalizeAspectRatio(aspectRatio),
            key: apiKey,
        });
        data = response.data;
    } catch (error: any) {
        const apiMessage =
            error?.response?.data?.error?.message ||
            error?.response?.data?.message ||
            error?.message ||
            'ModelsLab request failed';

        throw new Error(`ModelsLab: ${apiMessage}`);
    }

    const outputUrl = data?.output?.[0] || data?.data?.[0] || data?.image || data?.url;
    if (!outputUrl) {
        throw new Error(data?.message || 'ModelsLab did not return an image URL');
    }

    return outputUrl as string;
}

const buildBytezImageInput = (
    uploadedImages: string[],
    userPrompt: string,
    productName: string,
    productDescription: string,
    aspectRatio?: string
) => ({
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

const buildBytezVideoInput = (imageUrl: string, project: any) => ({
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

const shouldUseImageFallback = (genError: any) => {
    const errorText = JSON.stringify(genError || {}).toLowerCase();
    const message = String(genError?.message || '').toLowerCase();

    return (
        message.includes('billing_required') ||
        message.includes('api key not valid') ||
        message.includes('invalid argument') ||
        message.includes('out of credits') ||
        message.includes('modelslab') ||
        errorText.includes('api_key_invalid') ||
        errorText.includes('invalid_argument') ||
        errorText.includes('out of credits') ||
        errorText.includes('modelslab') ||
        errorText.includes('limit: 0') ||
        message.includes('429')
    );
}

const loadImage = (path: string, mimeType: string) => {
    return {
        inlineData: {
            data: fs.readFileSync(path).toString('base64'),
            mimeType
        }
    }
}

export const createProject = async (req: Request, res: Response) => {
    let tempProjectId: string | undefined;
    const { userId } = req.auth();
    let isCreditDeducted = false;

    const { name = 'New Project', aspectRatio, userPrompt, productName, productDescription, targetLength = 5 } = req.body;

    const images: any = req.files;

    if (images.length < 2 || !productName) {
        return res.status(400).json({ message: 'Please provide at least 2 images' })
    }

    let user = await prisma.user.findUnique({
        where: { id: userId },
    })

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
        })
    }

    if (user.credits < 5) {
        return res.status(401).json({ message: 'Insufficient credits' })
    } else {
        await prisma.user.update({
            where: { id: userId },
            data: { credits: { decrement: 5 } }
        }).then(() => {
            isCreditDeducted = true;
        });
    }


    try {

        let uploadedImages = await Promise.all(
            images.map(async (item: any) => {
                let result = await cloudinary.uploader.upload(item.path,
                    { resource_type: 'image' });
                return result.secure_url;

            })
        )
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
        })

        tempProjectId = project.id;

        try {
            const generatedImageUrl = await runBytezMediaModel(
                bytezImageModelId,
                buildBytezImageInput(uploadedImages, userPrompt, productName, productDescription, aspectRatio),
                'image'
            );

            await prisma.project.update({
                where: { id: project.id },
                data: {
                    generatedImage: generatedImageUrl,
                    isGenerating: false
                }
            });

            return res.json({ projectId: project.id });
        } catch (bytezError: any) {
            console.error('Bytez image generation failed:', bytezError?.message || bytezError);
        }

        let uploadResult;
        try {
            // First try Groq to generate a highly detailed prompt
            let finalImagePrompt = `Professional premium ecommerce ad photo for ${productName}. ${productDescription || ''} ${userPrompt || ''}`;
            try {
                const completion = await ai.chat.completions.create({
                    messages: [
                        { role: 'system', content: 'You are an elite ecommerce prompt engineer. Write a stable diffusion image prompt. Output ONLY the raw prompt, no intro or outro text, no quotation marks.' },
                        { role: 'user', content: `Product: ${productName}. Description: ${productDescription}. Focus: ${userPrompt}. Create an actionable, realistic image generation prompt combining person and product.` }
                    ],
                    model: 'llama3-8b-8192',
                });
                if (completion.choices[0]?.message?.content) {
                    finalImagePrompt = completion.choices[0].message.content.trim();
                    console.log("[Groq Prompt Generated]:", finalImagePrompt);
                }
            } catch (groqError: any) {
                console.error('Groq prompt generation failed (falling back to default text):', groqError.message);
            }

            // Fetch resulting Image from Pollinations AI (Free Limitless Engine)
            console.log("Generating Image via Pollinations based on Groq Prompt...");
            const encodedPrompt = encodeURIComponent(finalImagePrompt.slice(0, 900));
            const pollUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 10000)}`;
            
            const imageResponse = await axios.get(pollUrl, { responseType: 'arraybuffer' });
            const finalBuffer = Buffer.from(imageResponse.data);
            const base64Image = `data:image/png;base64,${finalBuffer.toString('base64')}`;
            uploadResult = await cloudinary.uploader.upload(base64Image, { resource_type: 'image' });

        } catch (genError: any) {
            console.error('Image Generation Failed:', genError.message);
            
            // FALLBACK: Use Cloudinary to combine images if AI fails
            console.log('Using Cloudinary Fallback...');
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
            } else {
                uploadResult = { secure_url: uploadedImages[0] };
            }
        }

        await prisma.project.update({
            where: { id: project.id },
            data: {
                generatedImage: uploadResult.secure_url,
                isGenerating: false
            }
        })

        res.json({ projectId: project.id });

    } catch (error: any) {
        if (tempProjectId) {

            // update project status and error message
            await prisma.project.update({
                where: { id: tempProjectId },
                data: { isGenerating: false, error: error.message }
            })
        }
        if (isCreditDeducted) {
            // add credits back
            await prisma.user.update({
                where: { id: userId },
                data: { credits: { increment: 5 } }
            })
        }

        Sentry.captureException(error);
        res.status(500).json({ message: error.message });
    }
}

export const createVideo = async (req: Request, res: Response) => {
    const { userId } = req.auth()
    const { projectId } = req.body;
    let isCreditDeducted = false;

    let user = await prisma.user.findUnique({
        where: { id: userId }
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
        })
    }

    if (user.credits < 10) {
        return res.status(401).json({ message: 'Insufficient credits' });
    }


    // deduct credits for video generation
    await prisma.user.update({
        where: { id: userId },
        data: { credits: { decrement: 10 } }
    }).then(() => { isCreditDeducted = true });

    try {
        const project = await prisma.project.findUnique({
            where: { id: projectId, userId },
            include: { user: true }
        })

        if (!project || project.isGenerating) {
            return res.status(404).json({ message: 'Generation already in progress' });
        }

        if (project.generatedVideo) {
            return res.status(404).json({ message: 'Video already generated' });
        }

        await prisma.project.update({
            where: { id: projectId },
            data: { isGenerating: true }
        })

        try {
            const generatedVideoUrl = await runBytezMediaModel(
                bytezVideoModelId,
                buildBytezVideoInput(project.generatedImage, project),
                'video'
            );

            await prisma.project.update({
                where: { id: projectId },
                data: {
                    generatedVideo: generatedVideoUrl,
                    isGenerating: false
                }
            });

            return res.json({ message: 'Video generation completed', videoUrl: generatedVideoUrl });
        } catch (bytezError: any) {
            console.error('Bytez video generation failed:', bytezError?.message || bytezError);
        }

        // Use Groq + Proxy / Fallback for Video
        // Because Groq is an LLM engine and Pollinations does not support video natively, we throw a fallback alert.
        throw new Error('Groq SDK is configured but does not native support Video generation. Please configure Bytez logic in ENV.');

    } catch (error: any) {

        // update project status and error message
        await prisma.project.update({
            where: { id: projectId, userId },
            data: { isGenerating: false, error: error.message }
        })

        if(isCreditDeducted) {
            // add credits back
            await prisma.user.update({
                where: { id: userId },
                data: { credits: { increment: 10 }}
            })
        }

        Sentry.captureException(error);
            res.status(500).json({ message: error.message });
        }
}

export const getAllPublishedProjects = async (req: Request, res: Response) => {
    try {
        const projects = await prisma.project.findMany({
            where: { isPublished: true }
        })
        res.json({projects})

    } catch (error: any) {
        Sentry.captureException(error);
        res.status(500).json({ message: error.message });
    }
}


export const deleteProject = async (req: Request, res: Response) => {
    try {
        const { userId } = req.auth();
        const projectId = req.params.projectId as string;

        const project = await prisma.project.findFirst({
            where: { id: projectId, userId }
        })

        if (!project) {
            return res.status(404).json({ message: 'Project not found' })
        }

        await prisma.project.delete({
            where: { id: projectId }
        })

        res.json({ message: 'Project deleted successfully' })
        
    } catch (error: any) {
        Sentry.captureException(error);
        res.status(500).json({ message: error.message });
    }
}