import { verifyWebhook } from '@clerk/express/webhooks';
import { prisma } from '../configs/prisma.js';
import * as Sentry from "@sentry/node";
const PLAN_CREDITS = {
    pro: 80,
    premium: 240,
};
const normalizePlanSlug = (value) => {
    if (typeof value !== 'string')
        return '';
    const slug = value.toLowerCase();
    if (slug.includes('premium'))
        return 'premium';
    if (slug.includes('pro'))
        return 'pro';
    return slug;
};
const getPlanSlug = (data) => normalizePlanSlug(data?.subscription_items?.[0]?.plan?.slug ||
    data?.subscription_items?.[0]?.plan?.key ||
    data?.subscription_items?.[0]?.plan?.id ||
    data?.subscription_item?.plan?.slug ||
    data?.subscription_item?.plan?.key ||
    data?.subscription_item?.plan?.id ||
    data?.plan?.slug ||
    data?.plan?.key ||
    data?.plan?.id);
const getPayerUserId = (data) => data?.payer?.user_id ||
    data?.payer?.id ||
    data?.user_id ||
    data?.customer?.user_id ||
    data?.subscription?.payer?.user_id;
const addPlanCredits = async (data) => {
    const planSlug = getPlanSlug(data);
    const clerkUserId = getPayerUserId(data);
    const credits = PLAN_CREDITS[planSlug];
    if (!clerkUserId || !credits) {
        return { credited: false, planSlug, clerkUserId };
    }
    await prisma.user.upsert({
        where: { id: clerkUserId },
        update: { credits: { increment: credits } },
        create: {
            id: clerkUserId,
            email: data?.payer?.email_address || "",
            name: data?.payer?.name || "New User",
            image: data?.payer?.image_url || "",
            credits,
        }
    });
    return { credited: true, planSlug, clerkUserId };
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
                await prisma.user.upsert({
                    where: { id: data.id },
                    update: {
                        email: data?.email_addresses?.[0]?.email_address || "",
                        name: `${data?.first_name || ''} ${data?.last_name || ''}`.trim() || "New User",
                        image: data?.image_url || "",
                    },
                    create: {
                        id: data.id,
                        email: data?.email_addresses?.[0]?.email_address || "",
                        name: `${data?.first_name || ''} ${data?.last_name || ''}`.trim() || "New User",
                        image: data?.image_url || "",
                    }
                });
                break;
            }
            case 'user.updated': {
                await prisma.user.upsert({
                    where: {
                        id: data.id
                    },
                    update: {
                        email: data?.email_addresses?.[0]?.email_address || "",
                        name: `${data?.first_name || ''} ${data?.last_name || ''}`.trim() || "New User",
                        image: data?.image_url || "",
                    },
                    create: {
                        id: data.id,
                        email: data?.email_addresses?.[0]?.email_address || "",
                        name: `${data?.first_name || ''} ${data?.last_name || ''}`.trim() || "New User",
                        image: data?.image_url || "",
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
            case 'subscriptionItem.active': {
                await addPlanCredits(data);
                break;
            }
            case 'paymentAttempt.updated': {
                if ((data.type === "recurring" || data.type === "checkout" || data.charge_type === "recurring" || data.charge_type === "checkout") && data.status === "paid") {
                    await addPlanCredits(data);
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
