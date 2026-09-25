/**
 * Contrato Base Abstracto para Clientes LLM.
 * @abstract
 */
class ILLMClient {
  async connect(targetUrl = '') {
    throw new Error("El método 'connect()' debe ser implementado.");
  }

  async generate({ prompt = '', fileToUpload = null } = {}) {
    throw new Error("El método 'generate()' debe ser implementado.");
  }

  async sendPrompt({ prompt = '', filePath = null } = {}) {
    throw new Error("El método 'sendPrompt()' debe ser implementado.");
  }

  async stopGeneration() {
    throw new Error("El método 'stopGeneration()' debe ser implementado.");
  }

  async getChatHistory() {
    return 'El proveedor actual no soporta la extracción de historial visual.';
  }

  async setupWebUIListener(callback = null) {
    // Método opcional para clientes con interfaz Web UI
  }

  async close() {
    throw new Error("El método 'close()' debe ser implementado.");
  }
}

module.exports = ILLMClient;