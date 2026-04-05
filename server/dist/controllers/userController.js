import { clerkClient } from '@clerk/express';
import * as Sentry from "@sentry/node";
import { prisma } from '../configs/prisma.js';
const ensureUserExists = async (userId) => {
    const existingUser = await prisma.user.findUnique({ where: { id: userId } });
    if (existingUser)
        return existingUser;
    const clerkUser = await clerkClient.users.getUser(userId);
    const fallbackEmail = clerkUser.emailAddresses[0]?.emailAddress || `${userId}@no-email.local`;
    const firstName = clerkUser.firstName || '';
    const lastName = clerkUser.lastName || '';
    const fullName = `${firstName} ${lastName}`.trim() || clerkUser.username || 'User';
    return prisma.user.create({
        data: {
            id: userId,
            email: fallbackEmail,
            name: fullName,
            image: clerkUser.imageUrl || '',
        }
    });
};
// Get User Credits
export const getUserCredits = async (req, res) => {
    try {
        const { userId } = req.auth();
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        const user = await ensureUserExists(userId);
        res.json({ credits: user?.credits ?? 0 });
    }
    catch (error) {
        Sentry.captureException(error);
        res.status(500).json({ message: error.code || error.message });
    }
};
//  Const get all User Porjects
export const getAllProjects = async (req, res) => {
    try {
        const { userId } = req.auth();
        const projects = await prisma.project.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' }
        });
        res.json({ projects });
    }
    catch (error) {
        Sentry.captureException(error);
        res.status(500).json({ message: error.code || error.message });
    }
};
// Get Project by id
export const getProjectById = async (req, res) => {
    try {
        const { userId } = req.auth();
        const projectId = req.params.projectId;
        const project = await prisma.project.findFirst({
            where: { id: projectId, userId }
        });
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }
        res.json({ project });
    }
    catch (error) {
        Sentry.captureException(error);
        res.status(500).json({ message: error.code || error.message });
    }
};
// publish / unpublish project
export const toggleProjectPublic = async (req, res) => {
    try {
        const { userId } = req.auth();
        const projectId = req.params.projectId;
        const project = await prisma.project.findFirst({
            where: { id: projectId, userId }
        });
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }
        if (!project.generatedImage && !project?.generatedVideo) {
            return res.status(404).json({ message: 'image or video not generated' });
        }
        await prisma.project.update({
            where: { id: projectId },
            data: { isPublished: !project.isPublished }
        });
        res.json({ isPublished: !project.isPublished });
    }
    catch (error) {
        Sentry.captureException(error);
        res.status(500).json({ message: error.code || error.message });
    }
};
