const GeminiPlaywrightClient = require('./providers/geminiPlaywrightClient');

class LLMFactory {
  /**
   * Instancia un cliente que cumple con el contrato ILLMClient.
   * @param {Object} options
   * @returns {ILLMClient}
   */
  static createClient(type = process.env.LLM_PROVIDER || 'PLAYWRIGHT', options = {}) {
    switch (type.toUpperCase()) {
      case 'PLAYWRIGHT':
        return new GeminiPlaywrightClient(options.sessionDir, options.chatUrlFile);
      default:
        throw Error('Proveedor o cliente no encontrado');
    }
  }
}

module.exports = LLMFactory;