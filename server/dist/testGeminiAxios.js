import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();
async function testGeminiAxios() {
    try {
        const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        console.log(`Calling Gemini via axios...`);
        const response = await axios.post(url, {
            contents: [{ parts: [{ text: 'Say hello' }] }]
        });
        console.log('Success!', response.data.candidates[0].content.parts[0].text);
    }
    catch (err) {
        console.error('Failed:', err.response?.data || err.message);
    }
}
testGeminiAxios();
