/**
 * Enrutador centralizado de proveedores LLM.
 * Permite cambiar de motor (Playwright, API, Ollama) sin tocar el AgentRuntime.
 */
class ModelRouter {
  constructor(defaultProvider = null) {
    this.providers = new Map();
    if (defaultProvider) {
      this.registerProvider('default', defaultProvider);
    }
  }

  registerProvider(name, provider) {
    this.providers.set(name, provider);
  }

  getProvider(name = 'default') {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Proveedor LLM '${name}' no registrado.`);
    }
    return provider;
  }

  async generate(request, providerName = 'default') {
    const provider = this.getProvider(providerName);
    return await provider.generate(request);
  }
}

module.exports = ModelRouter;