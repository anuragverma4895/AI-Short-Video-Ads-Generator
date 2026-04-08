import * as Sentry from "@sentry/node";
import { prisma } from '../configs/prisma.js';
import { v2 as cloudinary } from 'cloudinary';
import axios from 'axios';
import { Client } from '@gradio/client';
import { GoogleGenAI } from '@google/genai';
import { getRandomGeminiKey } from '../utils/apiPool.js';
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
        console.log("Connecting to Gemini API Pool for Smart Ad Composition...");
        try {
            const img1 = uploadedImages[0];
            const img2 = uploadedImages[1];
            // Fetch images and convert to base64 for Gemini Vision
            const r1 = await axios.get(img1, { responseType: 'arraybuffer' });
            const r2 = await axios.get(img2, { responseType: 'arraybuffer' });
            const b1 = Buffer.from(r1.data, 'binary').toString('base64');
            const b2 = Buffer.from(r2.data, 'binary').toString('base64');
            const ai = new GoogleGenAI({ apiKey: getRandomGeminiKey() });
            // Ask Gemini to classify Person vs Product and generate a Slogan
            const promptContent = `I am providing two images. One is a human model/person, and the other is a product (e.g. luggage, clothing, accessory). The product name is "${productName}". 
Analyze them and return a pure JSON object (do not wrap in markdown \`\`\`json). The JSON must be exactly:
{
  "personImageUrl": "<url of the person image>",
  "productImageUrl": "<url of the product image>",
  "adSlogan": "<A catchy, short 3-word UPPERCASE advertising slogan for this product>"
}
Use exactly these two URLs to fill the JSON:
URL A: ${img1}
URL B: ${img2}`;
            const result = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: [
                    { text: promptContent },
                    { inlineData: { mimeType: "image/jpeg", data: b1 } },
                    { inlineData: { mimeType: "image/jpeg", data: b2 } }
                ],
                config: {
                    responseMimeType: "application/json"
                }
            });
            // Parse Gemini Response
            const parts = result.candidates?.[0]?.content?.parts || [];
            let rawJson = parts.map((p) => p.text).join("") || "{}";
            const analysis = JSON.parse(rawJson);
            const bgPersonUrl = analysis.personImageUrl || img1;
            const fgProductUrl = analysis.productImageUrl || img2;
            const sloganText = analysis.adSlogan || productName.toUpperCase();
            // Extract Cloudinary Public IDs
            const bgPublicId = bgPersonUrl.split('/').pop()?.split('.')[0] || '';
            const fgPublicId = fgProductUrl.split('/').pop()?.split('.')[0] || '';
            // Smart Compose with Cloudinary Layering
            const cloudinaryFinalUrl = cloudinary.url(bgPublicId, {
                transformation: [
                    // Background layer (Person) filled
                    { width: 1080, height: 1920, crop: 'fill', gravity: 'auto' },
                    // Ad Slogan Layer
                    { overlay: { font_family: "Arial", font_size: 100, font_weight: "bold", text: sloganText }, color: "white" },
                    { flags: 'layer_apply', gravity: "north", y: 200 },
                    // Foreground Product Layer
                    { overlay: fgPublicId },
                    { effect: 'make_transparent:20', color: 'white' },
                    { width: 650, crop: 'scale' },
                    { flags: 'layer_apply', gravity: 'south', y: 150 }
                ]
            });
            const finalUpload = await cloudinary.uploader.upload(cloudinaryFinalUrl, { resource_type: 'image' });
            generatedImageUrl = finalUpload.secure_url;
            console.log("Successfully generated Composed Ad via Gemini+Cloudinary:", generatedImageUrl);
        }
        catch (error) {
            console.error('Ad Generation Failed:', error.message);
            throw new Error(`Composite Failed: ${error.message}`);
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
            const imageResponse = await axios.get(project.generatedImage, { responseType: 'blob' });
            const result = await client.predict("/video", {
                image: imageResponse.data,
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
