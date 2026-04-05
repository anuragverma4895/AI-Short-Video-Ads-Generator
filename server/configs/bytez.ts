import Bytez from 'bytez.js';

let bytezClient: any = null;

export const getBytezClient = () => {
    if (!process.env.BYTEZ_API_KEY) {
        return null;
    }

    if (!bytezClient) {
        bytezClient = new Bytez(process.env.BYTEZ_API_KEY);
    }

    return bytezClient;
};

export default getBytezClient;
