const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');

class REPL {
  constructor() {
    this.rl = readline.createInterface({ input, output });
  }

  async askQuestion(prompt) {
    try {
      return await this.rl.question(prompt);
    } catch (err) {
      if (
        err.name === 'AbortError' || 
        err.code === 'ABORT_ERR' || 
        err.code === 'ERR_USE_AFTER_CLOSE'
      ) {
        return ''; // Retorna vacío de forma segura si la consola se cerró o interrumpió
      }
      throw err;
    }
  }

  async askMultiline() {
    console.log('\n  [MODO MULTILÍNEA ACTIVADO]');
    console.log('  > Pega todo tu texto, código o logs.');
    console.log('  > Cuando termines, escribe ".send" en una nueva línea y presiona Enter.\n');

    const lines = [];

    while (true) {
      const line = await this.askQuestion('  | ');

      if (line.trim() === '.send' || this.rl.closed) {
        break;
      }

      lines.push(line);
    }

    return lines.join('\n');
  }

  close() {
    try {
      this.rl.close();
    } catch (e) {}
  }
}

module.exports = REPL;