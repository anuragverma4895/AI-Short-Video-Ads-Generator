import Bytez from 'bytez.js';
let cachedApiKey;
let cachedClient = null;
export const getBytezClient = () => {
    const apiKey = process.env.BYTEZ_API_KEY?.trim();
    if (!apiKey) {
        return null;
    }
    if (!cachedClient || cachedApiKey !== apiKey) {
        cachedApiKey = apiKey;
        cachedClient = new Bytez(apiKey);
    }
    return cachedClient;
};
