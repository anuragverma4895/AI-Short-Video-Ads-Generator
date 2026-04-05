import { GoogleGenAI } from "@google/genai";
const resolvedApiKey = process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.MODELSLAB_API_KEY ||
    process.env.GOOGLE_CLOUD_API_KEY;
const ai = new GoogleGenAI({
    apiKey: resolvedApiKey,
});
export default ai;
