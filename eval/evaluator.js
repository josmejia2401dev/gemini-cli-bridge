const fs = require('fs');
const path = require('path');
const Verifier = require('../agent/verifier');

/**
 * Runner de pruebas estándar para evaluar la tasa de precisión sintáctica del agente.
 */
class AgentEvaluator {
  constructor(testCasesDir = null) {
    this.testCasesDir = testCasesDir || path.join(__dirname, 'testCases');
  }

  runAllTests() {
    console.log('\n  🧪 [EVALUADOR] Ejecutando suite de pruebas sintácticas del agente...');
    if (!fs.existsSync(this.testCasesDir)) {
      console.log('  ⚠️ Directorio de test cases no encontrado.');
      return;
    }

    const files = fs.readdirSync(this.testCasesDir).filter(f => f.endsWith('.json'));
    let passed = 0;

    for (const file of files) {
      const test = JSON.parse(fs.readFileSync(path.join(this.testCasesDir, file), 'utf-8'));
      const verification = Verifier.preExecuteCommand(test.input);

      if (verification.valid) {
        console.log(`  ✅ Test [${test.id}] PASÓ: "${test.input}"`);
        passed++;
      } else {
        console.log(`  ❌ Test [${test.id}] FALLÓ: "${test.input}" -> ${verification.reason}`);
      }
    }

    console.log(`\n  Resultados: ${passed}/${files.length} pruebas pasadas.\n`);
  }
}

module.exports = AgentEvaluator;