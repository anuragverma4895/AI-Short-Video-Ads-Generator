import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
dotenv.config();

/**
 * Resolves one Gemini API key for the whole generation pipeline.
 */
export const getGeminiApiKey = (): string => {
    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
        throw new Error("No Gemini API key found. Please set GEMINI_API_KEY in server/.env.");
    }

    return apiKey;
};

export const createGeminiClient = () => {
    const apiKey = getGeminiApiKey();
    console.log(`[Gemini] Using API key ending in ...${apiKey.slice(-4)}`);
    return new GoogleGenAI({ apiKey });
};

export const isGeminiQuotaError = (error: any) => {
    const message = JSON.stringify(error?.error || error?.response?.data || error?.message || error).toLowerCase();
    return (
        error?.status === 429 ||
        error?.code === 429 ||
        error?.response?.status === 429 ||
        message.includes('resource_exhausted') ||
        message.includes('quota') ||
        message.includes('rate limit')
    );
}
