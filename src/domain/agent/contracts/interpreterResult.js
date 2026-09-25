const InterpreterResultType = Object.freeze({
  MESSAGE: 'MESSAGE',
  INSTRUCTION: 'INSTRUCTION'
});

class InterpreterResult {
  constructor({
    type = InterpreterResultType.MESSAGE,
    message = '',
    tool = null,
    args = {
      path: '',
      filePath: '',
      content: '',
      command: '',
      query: '',
      target: '',
      symbol: '',
      paths: [],
      createDirs: true,
      status: 'SUCCESS',
      summary: '',
      reason: '',
      task_id: ''
    },
    rawText = ''
  } = {}) {
    if (!Object.values(InterpreterResultType).includes(type)) {
      throw new Error(`[InterpreterResult] Tipo inválido "${type}". Tipos permitidos: ${Object.values(InterpreterResultType).join(', ')}.`);
    }

    this.type = type;
    this.message = String(message || '');
    this.tool = tool ? String(tool).trim() : null;
    this.args = Object.freeze({ ...args });
    this.rawText = String(rawText || '');

    Object.freeze(this);
  }

  static createMessage(text = '') {
    return new InterpreterResult({
      type: InterpreterResultType.MESSAGE,
      message: text,
      rawText: text
    });
  }

  static createInstruction({
    tool = '',
    args = {
      path: '',
      filePath: '',
      content: '',
      command: '',
      query: '',
      target: '',
      symbol: '',
      paths: [],
      createDirs: true,
      status: 'SUCCESS',
      summary: '',
      reason: '',
      task_id: ''
    },
    rawText = ''
  } = {}) {
    return new InterpreterResult({
      type: InterpreterResultType.INSTRUCTION,
      tool,
      args,
      rawText
    });
  }

  isInstruction() {
    return this.type === InterpreterResultType.INSTRUCTION;
  }

  isMessage() {
    return this.type === InterpreterResultType.MESSAGE;
  }
}

module.exports = {
  InterpreterResult,
  InterpreterResultType
};
