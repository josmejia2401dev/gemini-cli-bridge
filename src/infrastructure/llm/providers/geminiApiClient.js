const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const ILLMClient = require('../contracts/ILLMClient');

class GeminiApiClient extends ILLMClient {
    constructor(apiKey) {
        super();
        if (!apiKey) throw new Error("Se requiere una API Key de Gemini.");
        this.apiKey = apiKey;
        this.genAI = null;
        this.model = null;
        this.abortController = null;
    }

    // En las APIs, usaremos 'targetUrl' como el nombre del modelo
    async connect(modelName = 'gemini-1.5-pro') {
        try {
            this.genAI = new GoogleGenerativeAI(this.apiKey);
            this.model = this.genAI.getGenerativeModel({ model: modelName });
            console.log(`✅ Conectado a la API de Gemini (Modelo: ${modelName})`);
        } catch (error) {
            console.error('❌ Error conectando a Gemini API:', error);
            throw error;
        }
    }

    async generate({ prompt, fileToUpload = null }) {
        const text = await this.sendPrompt(prompt, fileToUpload);
        return { text };
    }

    async sendPrompt(prompt, filePath = null) {
        this.abortController = new AbortController();
        let finalPrompt = prompt;

        // Si hay un archivo, lo leemos e inyectamos como contexto
        if (filePath && fs.existsSync(filePath)) {
            console.log('📄 Adjuntando archivo de contexto...');
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            finalPrompt = `${prompt}\n\n--- CÓDIGO/CONTEXTO ADJUNTO ---\n${fileContent}\n--------------------------`;
        }

        console.log('💬 Enviando instrucción a Gemini...');

        try {
            const result = await this.model.generateContent(finalPrompt, {
                // Permite detener la petición en curso
                signal: this.abortController.signal
            });

            const responseText = result.response.text();
            return responseText;
        } catch (error) {
            if (error.name === 'AbortError') {
                return 'Generación detenida por el usuario.';
            }
            throw error;
        }
    }

    async stopGeneration() {
        if (this.abortController) {
            console.log('🛑 Deteniendo la generación de Gemini...');
            this.abortController.abort();
        }
    }

    async close() {
        // Para APIs REST no hay sesión de navegador que cerrar, 
        // pero limpiamos referencias.
        this.genAI = null;
        this.model = null;
        console.log('🔌 Conexión con Gemini cerrada.');
    }
}

module.exports = GeminiApiClient;