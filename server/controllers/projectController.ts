import { Request, Response } from 'express';
import * as Sentry from "@sentry/node"
import { prisma } from '../configs/prisma.js';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { getXaiHeaders, getXaiBaseUrl, isQuotaError } from '../utils/apiPool.js';

const DEFAULT_XAI_IMAGE_MODEL = 'grok-imagine-image';
const DEFAULT_XAI_VIDEO_MODEL = 'grok-imagine-video';
const DEFAULT_XAI_VIDEO_POLL_INTERVAL_MS = 10000;
const DEFAULT_XAI_VIDEO_TIMEOUT_MS = 10 * 60 * 1000;

const getXaiImageModel = () => process.env.XAI_IMAGE_MODEL?.trim() || DEFAULT_XAI_IMAGE_MODEL;
const getXaiVideoModel = () => process.env.XAI_VIDEO_MODEL?.trim() || DEFAULT_XAI_VIDEO_MODEL;

const getXaiVideoPollIntervalMs = () => Number(process.env.XAI_VIDEO_POLL_INTERVAL_MS) || DEFAULT_XAI_VIDEO_POLL_INTERVAL_MS;
const getXaiVideoTimeoutMs = () => Number(process.env.XAI_VIDEO_TIMEOUT_MS) || DEFAULT_XAI_VIDEO_TIMEOUT_MS;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const getActiveImageModels = () => [getXaiImageModel()];
export const getActiveVideoModel = () => getXaiVideoModel();

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
    const model = getXaiImageModel();

    const productMime = productFile.mimetype || 'image/jpeg';
    const modelMime = modelFile.mimetype || 'image/jpeg';

    try {
        console.log(`[Image Gen] Generating with xAI ${model}`);
        const response = await axios.post(
            `${getXaiBaseUrl()}/images/edits`,
            {
                model,
                prompt,
                images: [
                    { image_url: `data:${productMime};base64,${productImageBase64}` },
                    { image_url: `data:${modelMime};base64,${modelImageBase64}` },
                ],
            },
            {
                headers: getXaiHeaders(),
                timeout: 120000,
            }
        );

        const imageUrl = response.data?.data?.[0]?.url;
        if (!imageUrl) {
            throw new Error('xAI image model returned no image');
        }

        // Download the generated image to a buffer
        const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        return Buffer.from(imageResponse.data);

    } catch (error: any) {
        if (isQuotaError(error)) {
            throw new Error('xAI image generation quota is exhausted or rate limited for the configured API key.');
        }

        // Extract useful error message from xAI response
        const xaiError = error?.response?.data;
        if (xaiError) {
            const errMsg = typeof xaiError === 'string' ? xaiError : JSON.stringify(xaiError);
            throw new Error(`xAI image generation failed: ${errMsg}`);
        }

        throw error;
    }
}

const normalizeVideoAspectRatio = (aspectRatio?: string | null) => aspectRatio === '16:9' ? '16:9' : '9:16';

const getAdVideoPrompt = ({
    productName,
    productDescription,
    userPrompt,
}: {
    productName: string;
    productDescription?: string | null;
    userPrompt?: string | null;
}) => `Create a premium short-form UGC advertising video from the provided generated lifestyle ad image.

Product: ${productName}
Product notes: ${productDescription || 'Keep the product as the hero object.'}
Creative direction: ${userPrompt || 'Create smooth camera movement for a premium social media product ad.'}

Animate the existing scene naturally with subtle cinematic camera movement, realistic lighting changes, clean product emphasis, and polished commercial pacing. Keep the same product and person recognizable. Do not add captions, logos, watermarks, UI, borders, or distorted extra products.`;

const getVideoDurationSeconds = (targetLength?: number | null) => {
    const duration = Number(targetLength);
    if (!Number.isFinite(duration)) return undefined;
    return Math.min(Math.max(Math.round(duration), 4), 8);
};

const getGrokGeneratedVideoBuffer = async ({
    imageUrl,
    productName,
    productDescription,
    userPrompt,
    aspectRatio,
    targetLength,
}: {
    imageUrl: string;
    productName: string;
    productDescription?: string | null;
    userPrompt?: string | null;
    aspectRatio?: string | null;
    targetLength?: number | null;
}) => {
    const model = getXaiVideoModel();
    const prompt = getAdVideoPrompt({ productName, productDescription, userPrompt });
    const duration = getVideoDurationSeconds(targetLength);

    console.log(`[Video Gen] Generating with xAI ${model}`);

    // Initiate video generation
    const genResponse = await axios.post(
        `${getXaiBaseUrl()}/videos/generations`,
        {
            model,
            prompt,
            image: {
                url: imageUrl,
            },
            ...(duration ? { duration } : {}),
        },
        {
            headers: getXaiHeaders(),
            timeout: 30000,
        }
    );

    const requestId = genResponse.data?.request_id;
    if (!requestId) {
        throw new Error('xAI video generation returned no request_id');
    }

    // Poll for completion
    const startedAt = Date.now();
    const pollIntervalMs = getXaiVideoPollIntervalMs();
    const timeoutMs = getXaiVideoTimeoutMs();

    while (true) {
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error('xAI video generation timed out. Please try again later.');
        }

        console.log('[Video Gen] Waiting for xAI video operation...');
        await wait(pollIntervalMs);

        const statusResponse = await axios.get(
            `${getXaiBaseUrl()}/videos/${requestId}`,
            { headers: { 'Authorization': `Bearer ${process.env.XAI_API_KEY}` } }
        );

        const status = statusResponse.data?.status;

        if (status === 'COMPLETED' || status === 'completed') {
            const videoUrl = statusResponse.data?.video_url || statusResponse.data?.data?.[0]?.url;
            if (!videoUrl) {
                throw new Error('xAI video generation completed but returned no video URL');
            }

            // Download the video to a buffer
            const videoResponse = await axios.get(videoUrl, { responseType: 'arraybuffer' });
            return Buffer.from(videoResponse.data);
        }

        if (status === 'FAILED' || status === 'failed') {
            const errorMsg = statusResponse.data?.error || 'Unknown error';
            throw new Error(`xAI video generation failed: ${JSON.stringify(errorMsg)}`);
        }

        // Otherwise still processing, continue polling
    }
};

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
        if (!project.generatedImage) return res.status(400).json({ message: 'Please generate an image before creating a video' });
        if (project.generatedVideo) return res.status(404).json({ message: 'Video already generated' });

        await prisma.project.update({
            where: { id: projectId },
            data: { isGenerating: true }
        })

        console.log("Generating video with xAI Grok...");
        try {
            const generatedVideoBuffer = await getGrokGeneratedVideoBuffer({
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
        } catch (xaiError: any) {
            console.error('xAI video generation failed:', xaiError.message);
            if (isQuotaError(xaiError)) {
                throw new Error('xAI video generation quota is exhausted or rate limited for the configured API key.');
            }
            throw new Error(`Video generation failed with xAI: ${xaiError.message}. Please try again later.`);
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
