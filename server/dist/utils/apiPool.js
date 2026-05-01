import dotenv from 'dotenv';
dotenv.config();
/**
 * Parses API keys from the environment. GEMINI_API_KEYS supports comma-separated
 * values; the single-key env names are kept as fallbacks for local setups.
 */
const getApiKeys = () => {
    const pooledKeys = (process.env.GEMINI_API_KEYS || '')
        .split(',')
        .map(key => key.trim())
        .filter(Boolean);
    const fallbackKeys = [
        process.env.GEMINI_API_KEY,
        process.env.GOOGLE_API_KEY,
        process.env.GOOGLE_CLOUD_API_KEY,
    ].filter((key) => Boolean(key?.trim()));
    return [...new Set([...pooledKeys, ...fallbackKeys])];
};
const shuffle = (items) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
};
/**
 * Returns all available Gemini keys in random order for retry/failover.
 */
export const getGeminiKeys = () => {
    const keys = getApiKeys();
    if (keys.length === 0) {
        throw new Error("No Gemini API keys found in the environment. Please check GEMINI_API_KEYS.");
    }
    return shuffle(keys);
};
/**
 * Returns a random API key from the pool.
 */
export const getRandomGeminiKey = () => {
    const [selectedKey] = getGeminiKeys();
    console.log(`[API Pool] Using key ending in ...${selectedKey.slice(-4)}`);
    return selectedKey;
};
export const isGeminiQuotaError = (error) => {
    const message = JSON.stringify(error?.error || error?.response?.data || error?.message || error).toLowerCase();
    return (error?.status === 429 ||
        error?.code === 429 ||
        error?.response?.status === 429 ||
        message.includes('resource_exhausted') ||
        message.includes('quota') ||
        message.includes('rate limit'));
};
