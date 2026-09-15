const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');

class REPL {
    constructor() {
        this.rl = readline.createInterface({ input, output });
    }

    async askQuestion(prompt) {
        return await this.rl.question(prompt);
    }

    async askMultiline() {
        console.log('\n  [MODO MULTILÍNEA ACTIVADO]');
        console.log('  > Pega todo tu texto, código o logs.');
        console.log('  > Cuando termines, escribe ".send" en una nueva línea y presiona Enter.\n');
        
        let lines = [];
        return new Promise((resolve) => {
            const onLine = (line) => {
                if (line.trim() === '.send') {
                    this.rl.off('line', onLine);
                    resolve(lines.join('\n'));
                } else {
                    lines.push(line);
                }
            };
            this.rl.on('line', onLine);
        });
    }

    close() {
        this.rl.close();
    }
}

module.exports = REPL;