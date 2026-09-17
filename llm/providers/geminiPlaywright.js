const GeminiClient = require('../../llm/geminiClient');

/**
 * Adaptador para desacoplar Playwright de la lógica del agente.
 * Implementa la interfaz LLMProvider.
 */
class GeminiPlaywrightProvider {
  constructor(sessionDir, chatUrlFile) {
    this.client = new GeminiClient(sessionDir, chatUrlFile);
  }

  async connect(targetUrl) {
    await this.client.init(targetUrl);
  }

  async generate({ prompt, fileToUpload }) {
    const text = await this.client.sendPrompt(prompt, fileToUpload);
    return { text };
  }

  async stopGeneration() {
    await this.client.stopGeneration();
  }

  async close() {
    await this.client.close();
  }
}

module.exports = GeminiPlaywrightProvider;