import dotenv from 'dotenv';
dotenv.config();

/**
 * Parses the comma-separated API keys from the environments
 */
const getApiKeys = (): string[] => {
    const keysStr = process.env.GEMINI_API_KEYS || '';
    return keysStr.split(',').map(key => key.trim()).filter(key => key.length > 0);
};

// Global pool to hold available keys
const availableKeys = getApiKeys();

/**
 * Returns a random API key from the pool to avoid hitting rate limits.
 */
export const getRandomGeminiKey = (): string => {
    if (availableKeys.length === 0) {
        throw new Error("No Gemini API keys found in the environment. Please check GEMINI_API_KEYS.");
    }
    const randomIndex = Math.floor(Math.random() * availableKeys.length);
    const selectedKey = availableKeys[randomIndex];
    console.log(`[API Pool] Using key ending in ...${selectedKey.slice(-4)}`);
    return selectedKey;
};
