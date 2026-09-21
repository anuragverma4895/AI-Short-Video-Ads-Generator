import dotenv from 'dotenv';
dotenv.config();

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Resolves the Gemini API key for the whole generation pipeline.
 */
export const getGeminiApiKey = (): string => {
    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
        throw new Error("No Gemini API key found. Please set GEMINI_API_KEY in server/.env.");
    }

    return apiKey;
};

/**
 * Returns common headers for Gemini API requests.
 */
export const getGeminiHeaders = () => ({
    'Content-Type': 'application/json',
    'x-goog-api-key': getGeminiApiKey(),
});

/**
 * Returns the Gemini base URL.
 */
export const getGeminiBaseUrl = () => GEMINI_BASE_URL;

/**
 * Checks if the error is a quota/rate-limit error from Gemini.
 */
export const isQuotaError = (error: any) => {
    const message = JSON.stringify(error?.error || error?.response?.data || error?.message || error).toLowerCase();
    return (
        error?.status === 429 ||
        error?.code === 429 ||
        error?.response?.status === 429 ||
        message.includes('resource_exhausted') ||
        message.includes('quota') ||
        message.includes('rate limit') ||
        message.includes('rate_limit')
    );
}
