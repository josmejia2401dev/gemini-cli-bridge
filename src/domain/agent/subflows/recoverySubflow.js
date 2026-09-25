const ExecutionTask = require('../contracts/executionTask');
const ExecutionResult = require('../contracts/executionResult');
const RecoveryContext = require('../contracts/recoveryContext');
const ErrorAnalyzer = require('../errorAnalyzer');

class RecoverySubflow {
  constructor({
    episodicMemory = null,
    errorAnalyzer = ErrorAnalyzer
  } = {}) {
    this.episodicMemory = episodicMemory;
    this.errorAnalyzer = errorAnalyzer;
  }

  async handleFailure({
    task = null,
    result = null,
    parentDAG = null,
    recoveryScopeTask = null,
    executionContext = {
      source: '',
      userFeedback: '',
      workingDirectory: '',
      environment: {},
      variables: {},
      metadata: {}
    }
  } = {}) {
    if (!(task instanceof ExecutionTask)) {
      throw new Error('[RecoverySubflow] task debe ser ExecutionTask.');
    }

    if (!(result instanceof ExecutionResult)) {
      throw new Error('[RecoverySubflow] result debe ser ExecutionResult.');
    }

    const scopeTask = recoveryScopeTask instanceof ExecutionTask ? recoveryScopeTask : task;
    const rawFailure = [result.error, result.stdout, result.stderr].filter(Boolean).join('\n');
    const command = task.args?.command || task.description;

    console.log('\n  ⚠️ [RECOVERY] La ejecución falló.');
    console.log(`     🎯 Tarea fallida: [${task.id}] ${task.description}`);
    console.log(`     🎯 Alcance de recuperación: [${scopeTask.id}] ${scopeTask.description}`);
    console.log(`     🔧 Tool: ${task.tool || 'N/A'}`);
    console.log(`     ❌ Error: ${result.error || 'Fallo no especificado'}`);

    if (result.exitCode !== null && result.exitCode !== undefined) {
      console.log(`     🔢 Exit code: ${result.exitCode}`);
    }

    if (result.stdout) console.log(`     📄 STDOUT:\n${result.stdout}`);
    if (result.stderr) console.log(`     📄 STDERR:\n${result.stderr}`);

    let historicalSolutions = [];
    let historicalSolution = null;
    let failureId = null;
    let failureSignature = '';

    try {
      if (this.errorAnalyzer && typeof this.errorAnalyzer.analyze === 'function') {
        const analysis = this.errorAnalyzer.analyze({
          command,
          rawError: rawFailure,
          episodicMemory: this.episodicMemory
        });

        failureSignature = analysis?.signature || '';

        if (failureSignature) {
          console.log(`     🧾 Firma del error: ${failureSignature}`);
        }

        if (analysis?.solution) {
          historicalSolutions.push(
            `Solución conocida asociada al análisis del error: ${analysis.solution}`
          );
        }
      }

      if (this.episodicMemory && typeof this.episodicMemory.recordFailure === 'function') {
        failureId = this.episodicMemory.recordFailure(
          command,
          rawFailure,
          executionContext.userFeedback || null
        );
      }

      console.log('     🔎 [RECOVERY][BD] Consultando memoria episódica inmediatamente...');

      if (this.episodicMemory && typeof this.episodicMemory.findPastExperience === 'function') {
        const experiences = this.episodicMemory.findPastExperience(command) || [];

        historicalSolutions.push(
          ...experiences
            .map(item => item.solution_applied || item.solution)
            .filter(Boolean)
        );
      }

      historicalSolutions = [
        ...new Set(
          historicalSolutions
            .map(solution => String(solution).trim())
            .filter(Boolean)
        )
      ];

      historicalSolution = historicalSolutions[0] || null;

      if (historicalSolutions.length) {
        console.log('     🧠 [RECOVERY][BD] Soluciones encontradas:');
        for (const solution of historicalSolutions) {
          console.log(`        - ${solution}`);
        }
      } else {
        console.log('     🧠 [RECOVERY][BD] No se encontró una solución previa utilizable.');
      }
    } catch (error) {
      console.warn(`     ⚠️ [RECOVERY][BD] Error consultando memoria: ${error.message}`);
    }

    const context = new RecoveryContext({
      task,
      result,
      historicalSolution,
      historicalSolutions,
      parentDAG,
      recoveryScopeTask: scopeTask,
      failureSignature,
      executionContext
    });

    console.log('\n  📤 [RECOVERY FEEDBACK → IA]');
    console.log('  ---------------------------------------------------------------');
    console.log(context.buildRecoveryPrompt({ includeParentDAG: false }));
    console.log('  ---------------------------------------------------------------');

    return {
      context,
      failureId
    };
  }

  async registerSuccessfulFix({
    failureId = null,
    task = null,
    solutionDetails = ''
  } = {}) {
    if (!this.episodicMemory || !(task instanceof ExecutionTask)) return;

    try {
      const details = solutionDetails || `Resolución exitosa: ${task.description}`;

      if (typeof this.episodicMemory.recordSolution === 'function' && failureId) {
        this.episodicMemory.recordSolution(failureId, details);
      } else if (typeof this.episodicMemory.recordSuccess === 'function') {
        this.episodicMemory.recordSuccess(task.description, details);
      }
    } catch (error) {
      console.warn(`  ⚠️ [RECOVERY] No se pudo registrar la solución: ${error.message}`);
    }
  }
}

module.exports = RecoverySubflow;
