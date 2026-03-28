import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ 
  apiKey: process.env.GOOGLE_CLOUD_API_KEY,
});

async function testImagen3() {
  try {
    const model = 'imagen-3';
    console.log(`Testing image generation with ${model}...`);
    const response = await ai.models.generateImages({
      model,
      prompt: 'A simple red circle',
    });
    console.log('Success!', JSON.stringify(response, null, 2));
  } catch (err: any) {
    console.error('Failed:', err.message);
  }
}

testImagen3();

async function testFlashLiteLatestImage() {
  try {
    const model = 'gemini-flash-lite-latest';
    console.log(`Testing image generation with ${model}...`);
    const response = await ai.models.generateContent({
      model,
      contents: [{ text: 'Generate a simple red circle' }],
      config: {
        responseModalities: ['IMAGE'],
      },
    });
    console.log('Success!', JSON.stringify(response, null, 2));
  } catch (err: any) {
    console.error('Failed:', err.message);
  }
}

testFlashLiteLatestImage();

async function testGemini3ProImageTemp0() {
  try {
    const model = 'gemini-3-pro-image-preview';
    console.log(`Testing image generation with ${model} (temp 0)...`);
    const response = await ai.models.generateContent({
      model,
      contents: [{ text: 'Generate a simple red circle' }],
      config: {
        responseModalities: ['IMAGE'],
        temperature: 0,
      },
    });
    console.log('Success!', JSON.stringify(response, null, 2));
  } catch (err: any) {
    console.error('Failed:', err.message);
  }
}

testGemini3ProImageTemp0();
