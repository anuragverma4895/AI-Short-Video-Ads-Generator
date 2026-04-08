import { Request, Response } from 'express';
import * as Sentry from "@sentry/node"
import { prisma } from '../configs/prisma.js';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Client } from '@gradio/client';



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

        console.log("Connecting to Gradio IDM-VTON Space...");
        try {
            // Attempt Virtual Try-On using IDM-VTON free space
            const personImgUrl = uploadedImages[0];
            const garmentImgUrl = uploadedImages[1];
            
            // Using handle_file-like approach by fetching as blob
            const personResponse = await axios.get(personImgUrl, { responseType: 'blob' });
            const garmentResponse = await axios.get(garmentImgUrl, { responseType: 'blob' });

            const client = await Client.connect("yisol/IDM-VTON");
            const result = await client.predict("/tryon", {
                dict: personResponse.data,
                garm_img: garmentResponse.data,
                garment_des: `${productName} ${productDescription}`,
                is_checked: true,
                is_checked_crop: false,
                denoise_steps: 30,
                seed: Math.floor(Math.random() * 100000)
            });

            const outputData: any = result?.data;
            if (outputData && outputData.length > 0) {
                 // Huggingface space returns URL or FileData object
                 generatedImageUrl = typeof outputData[0] === 'string' ? outputData[0] : outputData[0]?.url;
            }
            if(!generatedImageUrl) throw new Error("Gradio client returned empty data");

            // Upload to our cloudinary
            const finalUpload = await cloudinary.uploader.upload(generatedImageUrl, { resource_type: 'image' });
            generatedImageUrl = finalUpload.secure_url;
            console.log("Successfully generated VTON image:", generatedImageUrl);

        } catch (vtonError: any) {
            console.error('IDM-VTON Generation Failed:', vtonError.message);
            console.log('Using Cloudinary Fallback for Composition...');
            const personImg = uploadedImages[0];
            const productImg = uploadedImages[1].split('/').pop()?.split('.')[0];

            if (productImg) {
                const fallbackUrl = cloudinary.url(uploadedImages[0].split('/').pop()?.split('.')[0] || '', {
                    transformation: [
                        { width: 1024, height: 1024, crop: 'limit' },
                        { overlay: productImg, width: 300, gravity: 'south_east', x: 20, y: 20 }
                    ]
                });
                const finalUpload = await cloudinary.uploader.upload(fallbackUrl, { resource_type: 'image' });
                generatedImageUrl = finalUpload.secure_url;
            } else {
                generatedImageUrl = uploadedImages[0];
            }
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
            const imageResponse = await axios.get(project.generatedImage, { responseType: 'blob' });
            
            const result = await client.predict("/video", {
                image: imageResponse.data,
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