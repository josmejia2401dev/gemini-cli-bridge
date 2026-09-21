const GeminiPlaywrightClient = require('./providers/geminiPlaywrightClient');
const GeminiApiClient = require('./providers/geminiApiClient');
const QwenApiClient = require('./providers/qwenApiClient');

class LLMFactory {
  /**
   * Instancia un cliente que cumple con el contrato ILLMClient.
   * @param {Object} options
   * @returns {ILLMClient}
   */
  static createClient(type = process.env.LLM_PROVIDER || 'PLAYWRIGHT', options = { sessionDir: '', chatUrlFile: '' }) {
    switch (type.toUpperCase()) {
      case 'PLAYWRIGHT':
        return new GeminiPlaywrightClient(options.sessionDir, options.chatUrlFile);
      case 'GEMINI_API':
        const geminiKey = options.apiKey || process.env.GEMINI_API_KEY;
        if (!geminiKey) throw new Error("Falta la API Key para Gemini API.");
        return new GeminiApiClient(geminiKey);
      case 'QWEN_API':
        const qwenKey = options.apiKey || process.env.QWEN_API_KEY;
        if (!qwenKey) throw new Error("Falta la API Key para Qwen API.");
        return new QwenApiClient(qwenKey);
      default:
        throw new Error(`Proveedor o cliente no encontrado: ${type}`);
    }
  }
}

module.exports = LLMFactory;