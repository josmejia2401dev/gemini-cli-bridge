/**
 * Contrato Base Abstracto para Clientes LLM.
 * @abstract
 */
class ILLMClient {
  async connect(targetUrl) {
    throw new Error("El método 'connect()' debe ser implementado.");
  }

  async generate({ prompt, fileToUpload }) {
    throw new Error("El método 'generate()' debe ser implementado.");
  }

  async sendPrompt(prompt, filePath = null) {
    throw new Error("El método 'sendPrompt()' debe ser implementado.");
  }

  async stopGeneration() {
    throw new Error("El método 'stopGeneration()' debe ser implementado.");
  }

  async close() {
    throw new Error("El método 'close()' debe ser implementado.");
  }
}

module.exports = ILLMClient;