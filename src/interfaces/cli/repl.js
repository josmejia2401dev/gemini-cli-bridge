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
      if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
        return ''; // Retorna vacío de forma segura si el usuario interrumpe con Ctrl+C
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
      // Usamos el mismo askQuestion de la clase
      const line = await this.askQuestion('  | ');

      // Si el usuario escribe .send (o si se cancela con Ctrl+C)
      if (line.trim() === '.send') {
        break;
      }

      lines.push(line);
    }

    return lines.join('\n');
  }

  close() {
    this.rl.close();
  }
}

module.exports = REPL;