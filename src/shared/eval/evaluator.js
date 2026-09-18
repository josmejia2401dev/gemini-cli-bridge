const fs = require('fs');
const path = require('path');
const Verifier = require('../agent/verifier');
const ErrorAnalyzer = require('../agent/errorAnalyzer');

/**
 * Runner de pruebas sintéticas y benchmarks para evaluar cuantitativamente
 * el rendimiento del agente, precisión, latencias y tasa de recuperación.
 */
class AgentEvaluator {
  constructor(testCasesDir = null) {
    this.testCasesDir = testCasesDir || path.join(__dirname, 'testCases');
  }

  runAllTests() {
    console.log('\n===================================================================');
    console.log('  🧪 [EVALUADOR & BENCHMARK] Ejecutando suite de pruebas sintácticas');
    console.log('===================================================================\n');

    if (!fs.existsSync(this.testCasesDir)) {
      console.log('  ⚠️ Directorio de test cases no encontrado.');
      return;
    }

    const files = fs.readdirSync(this.testCasesDir).filter(f => f.endsWith('.json'));
    const results = [];

    let totalTests = files.length;
    let passedCount = 0;
    let loopRecoveries = 0;
    let totalLatencyMs = 0;

    for (const file of files) {
      const startTime = Date.now();
      const test = JSON.parse(fs.readFileSync(path.join(this.testCasesDir, file), 'utf-8'));
      
      let testPassed = false;
      let recoverySuccess = false;
      let reason = '';

      // 1. Evaluación de sintaxis y verifier pre-ejecución
      if (test.input) {
        const verification = Verifier.preExecuteCommand(test.input);
        testPassed = verification.valid;
        reason = verification.valid ? 'OK' : verification.reason;
      } else {
        testPassed = true;
        reason = 'OK';
      }

      // 2. Simulación de recuperación de error (si aplica en el caso de prueba)
      if (test.simulatedError) {
        const analysis = ErrorAnalyzer.cleanStackTrace(test.simulatedError);
        recoverySuccess = analysis.length > 0;
        if (recoverySuccess) loopRecoveries++;
      }

      const durationMs = Date.now() - startTime;
      totalLatencyMs += durationMs;

      if (testPassed) passedCount++;

      results.push({
        TestID: test.id,
        Tarea: test.task ? test.task.substring(0, 32) : 'Sin nombre',
        Resultado: testPassed ? 'PASÓ ✅' : 'FALLÓ ❌',
        Detalle: reason.substring(0, 30),
        Latencia: `${durationMs}ms`
      });
    }

    // 🎯 REPORTE TABULAR INTERACTIVO
    console.table(results);

    const accuracyRate = totalTests > 0 ? ((passedCount / totalTests) * 100).toFixed(1) : '0.0';
    const avgLatencyMs = totalTests > 0 ? Math.round(totalLatencyMs / totalTests) : 0;
    const recoveryRate = totalTests > 0 ? ((loopRecoveries / totalTests) * 100).toFixed(1) : '0.0';

    console.log('-------------------------------------------------------------------');
    console.log('  📊 RESUMEN CUANTITATIVO DEL BENCHMARK');
    console.log('-------------------------------------------------------------------');
    console.log(`  • Tasa de Precisión Sintáctica: ${accuracyRate}% (${passedCount}/${totalTests})`);
    console.log(`  • Latencia Media de Verificación: ${avgLatencyMs} ms`);
    console.log(`  • Tasa de Recuperación de Bucles: ${recoveryRate}%`);
    console.log('===================================================================\n');
  }
}

if (require.main === module) {
  const evaluator = new AgentEvaluator();
  evaluator.runAllTests();
}

module.exports = AgentEvaluator;