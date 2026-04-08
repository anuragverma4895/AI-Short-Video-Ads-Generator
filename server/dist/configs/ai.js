import Groq from "groq-sdk";
const resolvedApiKey = process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.MODELSLAB_API_KEY ||
    process.env.GOOGLE_CLOUD_API_KEY;
const ai = new Groq({
    apiKey: resolvedApiKey,
});
export default ai;
