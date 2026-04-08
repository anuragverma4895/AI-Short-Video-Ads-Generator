const axios = require('axios');

async function testVTON() {
    console.log("Testing VTON...");
    try {
        const response = await axios.get('https://kwai-kolors-kolors-virtual-try-on.hf.space/info');
        console.log("Info:", response.data);
    } catch (e) {
        console.error("Error:", e.message);
    }
}
testVTON();
