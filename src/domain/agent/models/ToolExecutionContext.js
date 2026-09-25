/**
 * @class ToolExecutionContext
 */
class ToolExecutionContext {
  /**
   * @param {Object} params
   * @param {string} [params.projectRoot=''] - Ruta raíz del proyecto.
   * @param {Object|null} [params.repl=null] - Interfaz REPL utilizada para interacción con el usuario.
   * @param {boolean} [params.streamOutput=true] - Indica si la salida de ejecución debe transmitirse en tiempo real.
   */
  constructor({
    projectRoot = '',
    repl = null,
    streamOutput = true
  } = {}) {
    this.projectRoot = projectRoot;
    this.repl = repl;
    this.streamOutput = streamOutput;
  }
}

module.exports = ToolExecutionContext;