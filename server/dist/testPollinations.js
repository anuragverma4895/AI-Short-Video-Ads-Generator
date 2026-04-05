import axios from 'axios';
import fs from 'fs';
async function testPollinations() {
    try {
        const prompt = encodeURIComponent('A professional studio photo of a futuristic running shoe, realistic lighting, 4k');
        const url = `https://image.pollinations.ai/prompt/${prompt}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1000)}`;
        console.log(`Downloading from: ${url}`);
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        fs.writeFileSync('/tmp/pollinations_test.png', response.data);
        console.log('Success! Saved to /tmp/pollinations_test.png');
        console.log('File size:', response.data.length);
    }
    catch (err) {
        console.error('Failed:', err.message);
    }
}
testPollinations();
