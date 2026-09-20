import dotenv from 'dotenv';
dotenv.config();
const XAI_BASE_URL = 'https://api.x.ai/v1';
/**
 * Resolves the xAI API key for the whole generation pipeline.
 */
export const getXaiApiKey = () => {
    const apiKey = process.env.XAI_API_KEY?.trim();
    if (!apiKey) {
        throw new Error("No xAI API key found. Please set XAI_API_KEY in server/.env.");
    }
    return apiKey;
};
/**
 * Returns common headers for xAI API requests.
 */
export const getXaiHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getXaiApiKey()}`,
});
/**
 * Returns the xAI base URL.
 */
export const getXaiBaseUrl = () => XAI_BASE_URL;
/**
 * Checks if the error is a quota/rate-limit error from xAI.
 */
export const isQuotaError = (error) => {
    const message = JSON.stringify(error?.error || error?.response?.data || error?.message || error).toLowerCase();
    return (error?.status === 429 ||
        error?.code === 429 ||
        error?.response?.status === 429 ||
        message.includes('resource_exhausted') ||
        message.includes('quota') ||
        message.includes('rate limit') ||
        message.includes('rate_limit'));
};
