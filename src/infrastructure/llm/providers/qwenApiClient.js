const { OpenAI } = require('openai');
const fs = require('fs');
const ILLMClient = require('../contracts/ILLMClient');

class QwenApiClient extends ILLMClient {
    constructor({ apiKey = '' } = {}) {
        super();
        if (!apiKey) throw new Error("Se requiere una API Key de Qwen (Alibaba Cloud).");
        this.apiKey = apiKey;
        this.client = null;
        this.modelName = null;
        this.abortController = null;
    }

    // Usamos el targetUrl para definir el modelo. Por defecto ponemos el Qwen3.7-Max o qwen-coder-plus
    async connect(modelName = 'qwen-coder-plus') {
        try {
            this.client = new OpenAI({
                apiKey: this.apiKey,
                baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
            });
            this.modelName = modelName;
            console.log(`✅ Conectado a la API de Qwen (Modelo: ${this.modelName})`);
        } catch (error) {
            console.error('❌ Error conectando a Qwen API:', error);
            throw error;
        }
    }

    async generate({ prompt = '', fileToUpload = null } = {}) {
        const text = await this.sendPrompt({ prompt, filePath: fileToUpload });
        return { text };
    }

    async sendPrompt({ prompt = '', filePath = null } = {}) {
        this.abortController = new AbortController();
        let finalPrompt = prompt;

        // Para código fuente, la mejor práctica en APIs es leerlo e inyectarlo en el prompt
        if (filePath && fs.existsSync(filePath)) {
            console.log(`📄 Leyendo archivo de contexto: ${filePath}...`);
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            finalPrompt = `${prompt}\n\n--- CÓDIGO DEL PROYECTO ---\n${fileContent}\n--------------------------`;
        }

        console.log(`💬 Enviando instrucción a ${this.modelName}...`);

        try {
            const response = await this.client.chat.completions.create(
                {
                    model: this.modelName,
                    messages: [{ role: "user", content: finalPrompt }],
                    n: 1,
                    temperature: 0.5
                },
                {
                    signal: this.abortController.signal
                }
            );

            return response.choices[0]?.message?.content || '';
        } catch (error) {
            if (error.name === 'AbortError') {
                return 'Generación detenida por el usuario.';
            }
            throw error;
        }
    }

    async stopGeneration({ reason = 'USER_REQUEST' } = {}) {
        if (this.abortController) {
            console.log('🛑 Deteniendo la generación de Qwen...');
            this.abortController.abort();
        }
    }

    async close() {
        this.client = null;
        console.log('🔌 Conexión con Qwen cerrada.');
    }
}

module.exports = QwenApiClient;