import { Request, Response } from 'express';
import * as Sentry from "@sentry/node"
import { prisma } from '../configs/prisma.js';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Client } from '@gradio/client';
import { GoogleGenAI, Modality } from '@google/genai';
import { getGeminiKeys, isGeminiQuotaError } from '../utils/apiPool.js';

const DEFAULT_GEMINI_IMAGE_MODELS = [
    'gemini-2.5-flash-image',
    'gemini-2.5-flash-image-preview',
    'gemini-3-pro-image-preview',
];

const normalizeGeminiModelName = (model: string) => model.trim().replace(/^models\//, '');

const isDeprecatedGeminiImageModel = (model: string) =>
    normalizeGeminiModelName(model).includes('gemini-2.0-flash-preview-image-generation');

const getGeminiImageModels = () => {
    const configuredModels = process.env.GEMINI_IMAGE_MODELS || '';

    const models = configuredModels
        .split(',')
        .map(normalizeGeminiModelName)
        .filter(Boolean)
        .filter(model => !isDeprecatedGeminiImageModel(model));

    return [...new Set([...DEFAULT_GEMINI_IMAGE_MODELS, ...models])];
}

export const getActiveGeminiImageModels = () => getGeminiImageModels();

const uploadBufferToCloudinary = (buffer: Buffer, resourceType: 'image' | 'video' = 'image') =>
    new Promise<string>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { resource_type: resourceType },
            (error, result) => {
                if (error || !result?.secure_url) {
                    reject(error || new Error('Cloudinary upload failed'));
                    return;
                }

                resolve(result.secure_url);
            }
        );

        stream.end(buffer);
    });

const getAdImagePrompt = ({
    productName,
    productDescription,
    userPrompt,
    aspectRatio,
}: {
    productName: string;
    productDescription?: string;
    userPrompt?: string;
    aspectRatio?: string;
}) => `Create a premium photorealistic lifestyle advertising image using the two provided reference images.

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

const generateLifestyleAdImage = async ({
    productFile,
    modelFile,
    productName,
    productDescription,
    userPrompt,
    aspectRatio,
}: {
    productFile: any;
    modelFile: any;
    productName: string;
    productDescription?: string;
    userPrompt?: string;
    aspectRatio?: string;
}) => {
    const productImageBase64 = fs.readFileSync(productFile.path).toString('base64');
    const modelImageBase64 = fs.readFileSync(modelFile.path).toString('base64');
    const prompt = getAdImagePrompt({ productName, productDescription, userPrompt, aspectRatio });
    let lastError: any;

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
                ] as any,
                config: {
                    responseModalities: [Modality.TEXT, Modality.IMAGE],
                },
            });

            const imagePart = response.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData?.data);
            const imageData = imagePart?.inlineData?.data;
            if (!imageData) {
                throw new Error('Gemini image model returned no image');
            }

            return Buffer.from(imageData, 'base64');
            } catch (error: any) {
                lastError = error;
                if (isGeminiQuotaError(error)) {
                    console.warn(`[Image Gen] ${model} key ...${apiKey.slice(-4)} quota/rate limited. Trying next key.`);
                    continue;
                }

                console.warn(`[Image Gen] ${model} key ...${apiKey.slice(-4)} failed. Trying next option.`, error?.message || error);
            }
        }
    }

    throw lastError || new Error('Gemini image generation failed');
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
                let result = await cloudinary.uploader.upload(item.path, { resource_type: 'image' });
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

        } catch (error: any) {
            console.error('Ad Generation Failed:', error.message);
            throw new Error(`AI lifestyle image generation failed: ${error.message}`);
        }

        await prisma.project.update({
            where: { id: project.id },
            data: {
                generatedImage: generatedImageUrl,
                isGenerating: false
            }
        })

        res.json({ projectId: project.id });

    } catch (error: any) {
        if (tempProjectId) {
            await prisma.project.update({
                where: { id: tempProjectId },
                data: { isGenerating: false, error: error.message }
            })
        }
        if (isCreditDeducted) {
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

    if (!user) {
        user = await prisma.user.create({
            data: { id: userId, email: "", name: "New User", image: "", credits: 20 }
        })
    }

    if (user.credits < 10) return res.status(401).json({ message: 'Insufficient credits' });

    await prisma.user.update({
        where: { id: userId },
        data: { credits: { decrement: 10 } }
    }).then(() => { isCreditDeducted = true });

    try {
        const project = await prisma.project.findUnique({
            where: { id: projectId, userId },
            include: { user: true }
        })

        if (!project || project.isGenerating) return res.status(404).json({ message: 'Generation already in progress' });
        if (project.generatedVideo) return res.status(404).json({ message: 'Video already generated' });

        await prisma.project.update({
            where: { id: projectId },
            data: { isGenerating: true }
        })

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

            const outputData: any = result?.data;
            let generatedVideoUrl = "";
            if (outputData && outputData.length > 0) {
                 generatedVideoUrl = typeof outputData[0] === 'string' ? outputData[0] : outputData[0]?.url;
            }
            if(!generatedVideoUrl) throw new Error("Gradio Client SVD returned empty data");

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
        } catch (gradioError: any) {
            console.error('SVD Generation Failed:', gradioError.message);
            throw new Error(`Video generation failed over Free API: ${gradioError.message}. Please try again later.`);
        }

    } catch (error: any) {
        await prisma.project.update({
            where: { id: projectId, userId },
            data: { isGenerating: false, error: error.message }
        })

        if(isCreditDeducted) {
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
