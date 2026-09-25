const ToolExecutionContext = require('./ToolExecutionContext');

/**
 * @class ToolExecutionRequest
 */
class ToolExecutionRequest {
  /**
   * @param {Object} params
   * @param {string} params.name - Nombre de la herramienta a ejecutar.
   * @param {Object} params.args - Argumentos de la herramienta.
   * @param {ToolExecutionContext} params.context - Contexto de ejecución.
   */
  constructor({
    name,
    args = {},
    context
  }) {
    if (!name) {
      throw new Error(
        'ToolExecutionRequest requiere "name".'
      );
    }

    if (!(context instanceof ToolExecutionContext)) {
      throw new Error(
        'ToolExecutionRequest requiere un "context" válido.'
      );
    }

    this.name = name;
    this.args = args;
    this.context = context;
  }
}

module.exports = ToolExecutionRequest;