const ExecutionTask = require('../contracts/executionTask');
const ExecutionResult = require('../contracts/executionResult');
const RecoveryContext = require('../contracts/recoveryContext');
const ErrorAnalyzer = require('../errorAnalyzer');

class RecoverySubflow {
  constructor({ episodicMemory = null, errorAnalyzer = ErrorAnalyzer } = {}) {
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
    if (!(task instanceof ExecutionTask)) throw new Error('[RecoverySubflow] task debe ser ExecutionTask.');
    if (!(result instanceof ExecutionResult)) throw new Error('[RecoverySubflow] result debe ser ExecutionResult.');

    let historicalSolutions = [];
    let historicalSolution = null;
    let failureId = null;

    if (this.episodicMemory) {
      try {
        if (typeof this.episodicMemory.recordFailure === 'function') {
          failureId = this.episodicMemory.recordFailure(
            task.description,
            result.error || '',
            executionContext.userFeedback || null
          );
        }

        // Cada fallo consulta inmediatamente la memoria. No hay umbral ni contador.
        if (typeof this.episodicMemory.findPastExperience === 'function') {
          const experiences = this.episodicMemory.findPastExperience(task.description);
          historicalSolutions.push(
            ...(experiences || [])
              .map(x => x.solution_applied || x.solution)
              .filter(Boolean)
          );
        }

        const command = task.args?.command || task.description;
        if (this.errorAnalyzer && typeof this.errorAnalyzer.analyze === 'function') {
          const analysis = this.errorAnalyzer.analyze({ command, rawError: result.error || '', episodicMemory: this.episodicMemory });
          if (analysis?.solution) {
            historicalSolutions.unshift(`Solución conocida para ${analysis.signature}: ${analysis.solution}`);
          }
        }

        historicalSolutions = [...new Set(historicalSolutions)];
        historicalSolution = historicalSolutions[0] || null;

        if (historicalSolution) {
          console.log('  🧠 [RECOVERY] Se encontró una solución previa en la memoria y se incorporará como feedback para la IA.');
        } else {
          console.log('  🧠 [RECOVERY] No se encontró una solución previa utilizable.');
        }
      } catch (err) {
        console.warn(`  ⚠️ [RecoverySubflow] No se pudo consultar/registrar memoria: ${err.message}`);
      }
    }

    return {
      context: new RecoveryContext({
        task,
        result,
        historicalSolution,
        historicalSolutions,
        parentDAG,
        recoveryScopeTask: recoveryScopeTask instanceof ExecutionTask ? recoveryScopeTask : task,
        executionContext
      }),
      failureId
    };
  }

  async registerSuccessfulFix({ failureId = null, task = null, solutionDetails = '' } = {}) {
    if (!this.episodicMemory) return;
    try {
      if (typeof this.episodicMemory.recordSolution === 'function' && failureId) {
        this.episodicMemory.recordSolution(failureId, solutionDetails || `Resolución exitosa: ${task.description}`);
      } else if (typeof this.episodicMemory.recordSuccess === 'function') {
        this.episodicMemory.recordSuccess(task.description, solutionDetails || 'Resolución exitosa.');
      }
    } catch (e) {
      console.warn(`  ⚠️ [RecoverySubflow] No se pudo registrar la solución: ${e.message}`);
    }
  }
}
module.exports = RecoverySubflow;
