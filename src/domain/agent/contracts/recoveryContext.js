const ExecutionTask = require('./executionTask');
const ExecutionResult = require('./executionResult');

class RecoveryContext {
  constructor({
    task = null,
    result = null,
    historicalSolution = null,
    historicalSolutions = [],
    parentDAG = null,
    recoveryScopeTask = null,
    failureSignature = '',
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
      throw new Error('[RecoveryContext] task debe ser ExecutionTask.');
    }

    if (!(result instanceof ExecutionResult)) {
      throw new Error('[RecoveryContext] result debe ser ExecutionResult.');
    }

    this.task = task;
    this.result = result;
    this.recoveryScopeTask = recoveryScopeTask instanceof ExecutionTask ? recoveryScopeTask : task;
    this.historicalSolution = historicalSolution ? String(historicalSolution).trim() : null;
    this.historicalSolutions = Object.freeze(Array.isArray(historicalSolutions) ? [...historicalSolutions] : []);
    this.parentDAG = parentDAG;
    this.failureSignature = String(failureSignature || '').trim();
    this.executionContext = Object.freeze({ ...(executionContext || {}) });

    Object.freeze(this);
  }

  hasKnownSolution() {
    return Boolean(this.historicalSolution || this.historicalSolutions.length);
  }

  buildRecoveryPrompt({
    includeParentDAG = false,
    userFeedback = ''
  } = {}) {
    let prompt = '[SISTEMA: RECUPERACIÓN DE EJECUCIÓN]\n';

    prompt += '\n=== ALCANCE DE RECUPERACIÓN ===\n';
    prompt += 'El plan de recuperación debe solucionar EXCLUSIVAMENTE la tarea fallida indicada abajo.\n';
    prompt += 'No replantees el DAG original completo.\n';
    prompt += 'No incluyas tareas no relacionadas con la recuperación de esta tarea.\n';
    prompt += 'El DAG original permanece intacto y continuará con sus tareas pendientes cuando esta recuperación termine correctamente.\n';
    prompt += `\nTAREA OBJETIVO: [${this.recoveryScopeTask.id}] ${this.recoveryScopeTask.description}\n`;

    prompt += '\n=== EVIDENCIA DE EJECUCIÓN ===\n';
    prompt += `TOOL: ${this.task.tool || 'N/A'}\n`;
    prompt += `ARGS:\n${JSON.stringify(this.task.args, null, 2)}\n`;
    prompt += `\nERROR:\n${this.result.error || 'Fallo no especificado'}\n`;

    if (this.result.exitCode !== null && this.result.exitCode !== undefined) {
      prompt += `EXIT CODE: ${this.result.exitCode}\n`;
    }

    if (this.result.errorCode) {
      prompt += `ERROR CODE: ${this.result.errorCode}\n`;
    }

    if (this.result.signal) {
      prompt += `SIGNAL: ${this.result.signal}\n`;
    }

    if (this.failureSignature) {
      prompt += `FIRMA DEL ERROR: ${this.failureSignature}\n`;
    }

    if (this.result.stdout) {
      prompt += `\nSTDOUT:\n${this.result.stdout}\n`;
    }

    if (this.result.stderr) {
      prompt += `\nSTDERR:\n${this.result.stderr}\n`;
    }

    prompt += `\nCONTEXTO DE EJECUCIÓN:\n${JSON.stringify(this.executionContext, null, 2)}\n`;
    prompt += '\n=== FEEDBACK DE MEMORIA ===\n';

    if (this.hasKnownSolution()) {
      for (const solution of this.historicalSolutions) {
        prompt += `- ${solution}\n`;
      }

      if (this.historicalSolution && !this.historicalSolutions.includes(this.historicalSolution)) {
        prompt += `- ${this.historicalSolution}\n`;
      }
    } else {
      prompt += 'No se encontró una solución previa utilizable.\n';
    }

    if (userFeedback) {
      prompt += `\n=== FEEDBACK ADICIONAL DEL USUARIO ===\n${String(userFeedback).trim()}\n`;
    }

    if (includeParentDAG && this.parentDAG && typeof this.parentDAG.toJSON === 'function') {
      prompt += '\n=== DAG ORIGINAL: SOLO CONTEXTO ===\n';
      prompt += 'NO modificar, sustituir ni replanificar las demás tareas del DAG original.\n';
      prompt += `${JSON.stringify(this.parentDAG.toJSON(), null, 2)}\n`;
    }

    prompt += '\n=== INSTRUCCIÓN PARA PLANNING ===\n';
    prompt += 'Genera únicamente un DAG de recuperación para resolver la TAREA OBJETIVO.\n';
    prompt += 'Todas las subtareas deben estar directamente justificadas por la solución de esta tarea.\n';
    prompt += 'El DAG de recuperación requiere aprobación explícita del usuario antes de ejecutarse.\n';

    return prompt;
  }
}

module.exports = RecoveryContext;
