import { clerkClient } from '@clerk/express';
import { verifyWebhook } from '@clerk/express/webhooks';
import { prisma } from '../configs/prisma.js';
import * as Sentry from "@sentry/node";
const PLAN_CREDITS = {
    pro: 80,
    premium: 240,
};
const normalizePlanId = (rawPlan) => {
    if (!rawPlan)
        return null;
    const normalized = rawPlan.toLowerCase();
    if (normalized.includes('premium') || normalized.includes('ultra')) {
        return 'premium';
    }
    if (normalized.includes('pro')) {
        return 'pro';
    }
    return null;
};
const extractPlanId = (data) => {
    const planCandidates = [
        data?.subscription_items?.[0]?.plan?.slug,
        data?.subscription_items?.[0]?.price?.lookup_key,
        data?.subscription_items?.[0]?.price?.nickname,
        data?.plan?.slug,
        data?.plan?.name,
        data?.product?.slug,
        data?.product?.name,
    ];
    for (const plan of planCandidates) {
        const normalized = normalizePlanId(plan);
        if (normalized)
            return normalized;
    }
    return null;
};
const ensureUserExists = async (clerkUserId) => {
    const existingUser = await prisma.user.findUnique({ where: { id: clerkUserId } });
    if (existingUser)
        return existingUser;
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    const fallbackEmail = clerkUser.emailAddresses[0]?.emailAddress || `${clerkUserId}@no-email.local`;
    const firstName = clerkUser.firstName || '';
    const lastName = clerkUser.lastName || '';
    const fullName = `${firstName} ${lastName}`.trim() || clerkUser.username || 'User';
    return prisma.user.create({
        data: {
            id: clerkUserId,
            email: fallbackEmail,
            name: fullName,
            image: clerkUser.imageUrl || '',
        },
    });
};
const applyCreditsForEvent = async (data) => {
    const clerkUserId = data?.user_id || data?.payer?.user_id;
    const normalizedPlanId = extractPlanId(data);
    if (!clerkUserId || !normalizedPlanId) {
        return;
    }
    await ensureUserExists(clerkUserId);
    await prisma.user.update({
        where: { id: clerkUserId },
        data: { credits: { increment: PLAN_CREDITS[normalizedPlanId] } }
    });
};
const clerkWebhooks = async (req, res) => {
    try {
        const evt = await verifyWebhook(req, {
            signingSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET
        });
        //  getting Data from request
        const { data, type } = evt;
        // Switch Cases for different events
        switch (type) {
            case 'user.created': {
                await prisma.user.create({
                    data: {
                        id: data.id,
                        email: data?.email_addresses?.[0]?.email_address,
                        name: data?.first_name + ' ' + data?.last_name,
                        image: data?.image_url,
                    }
                });
                break;
            }
            case 'user.updated': {
                await prisma.user.update({
                    where: {
                        id: data.id
                    },
                    data: {
                        email: data?.email_addresses?.[0]?.email_address,
                        name: data?.first_name + ' ' + data?.last_name,
                        image: data?.image_url,
                    }
                });
                break;
            }
            case 'user.deleted': {
                await prisma.user.delete({
                    where: {
                        id: data.id
                    }
                });
                break;
            }
            case 'subscription.created':
            case 'subscription.updated': {
                // Intentionally no credit changes here to prevent double-crediting.
                break;
            }
            case 'paymentAttempt.updated': {
                if ((data.charge_type === "recurring" || data.charge_type === "checkout") && data.status === "paid") {
                    await applyCreditsForEvent(data);
                }
                break;
            }
            default:
                break;
        }
        res.json({ message: "Webhook Received : " + type });
    }
    catch (error) {
        Sentry.captureException(error);
        res.status(500).json({ message: error.message });
    }
};
export default clerkWebhooks;
