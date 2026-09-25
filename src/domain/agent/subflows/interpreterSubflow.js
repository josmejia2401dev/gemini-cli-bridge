const OutputParser = require('../../../shared/utils/outputParser');
const { InterpreterResult } = require('../contracts/interpreterResult');

/**
 * Interpreta una respuesta del LLM como mensaje conversacional o instrucción ejecutable.
 * No ejecuta herramientas: esa responsabilidad pertenece a ExecutionSubflow.
 */
class InterpreterSubflow {
  constructor({ toolRegistry = null } = {}) {
    this.toolRegistry = toolRegistry;
  }

  parse(rawText = '') {
    const text = String(rawText || '').trim();
    if (!text) return InterpreterResult.createMessage('');

    const parsed = OutputParser.parseToolCall(text);
    if (parsed.success && parsed.data?.tool) {
      const tool = parsed.data.tool;
      if (this.toolRegistry && typeof this.toolRegistry.getTool === 'function' && !this.toolRegistry.getTool(tool)) {
        return InterpreterResult.createMessage(text);
      }
      return InterpreterResult.createInstruction({
        tool,
        args: parsed.data.arguments || {},
        rawText: text
      });
    }

    return InterpreterResult.createMessage(text);
  }
}

module.exports = InterpreterSubflow;
