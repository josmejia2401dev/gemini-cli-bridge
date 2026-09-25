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
    executionContext = {
      source: '',
      workingDirectory: '',
      environment: {},
      variables: {},
      metadata: {}
    }
  } = {}) {
    if (!(task instanceof ExecutionTask)) throw new Error('[RecoveryContext] task debe ser ExecutionTask.');
    if (!(result instanceof ExecutionResult)) throw new Error('[RecoveryContext] result debe ser ExecutionResult.');

    this.task = task;
    this.result = result;
    this.recoveryScopeTask = recoveryScopeTask instanceof ExecutionTask ? recoveryScopeTask : task;
    this.historicalSolution = historicalSolution ? String(historicalSolution).trim() : null;
    this.historicalSolutions = Object.freeze(Array.isArray(historicalSolutions) ? [...historicalSolutions] : []);
    this.parentDAG = parentDAG;
    this.executionContext = Object.freeze({ ...executionContext });
    Object.freeze(this);
  }

  hasKnownSolution() {
    return Boolean(this.historicalSolution || this.historicalSolutions.length);
  }

  buildRecoveryPrompt({ includeParentDAG = false } = {}) {
    let prompt = '[SISTEMA: RECUPERACIÓN DE EJECUCIÓN]\n';
    prompt += 'ALCANCE OBLIGATORIO: genera un plan EXCLUSIVAMENTE para resolver la tarea fallida.\n';
    prompt += `TAREA OBJETIVO DE RECUPERACIÓN: [${this.recoveryScopeTask.id}] "${this.recoveryScopeTask.description}"\n`;
    if (this.task.id !== this.recoveryScopeTask.id) {
      prompt += `PASO DE RECUPERACIÓN QUE FALLÓ: [${this.task.id}] "${this.task.description}"\n`;
    }
    prompt += 'IMPORTANTE: el nuevo DAG es temporal y local a la tarea objetivo de recuperación. No replantees, sustituyas ni incluyas otras tareas del DAG original. Cuando esta recuperación termine, el DAG original continuará con sus tareas pendientes.\n';

    if (this.task.hasExplicitTool()) {
      prompt += `Herramienta que falló: ${this.task.tool}\n`;
      prompt += `Argumentos: ${JSON.stringify(this.task.args)}\n`;
    }

    prompt += `\nERROR DE EJECUCIÓN:\n${this.result.error || 'Fallo no especificado'}\n`;
    if (this.result.stdout) prompt += `\nSTDOUT:\n${this.result.stdout}\n`;
    if (this.result.stderr) prompt += `\nSTDERR:\n${this.result.stderr}\n`;

    if (this.executionContext && Object.keys(this.executionContext).length) {
      prompt += `\nCONTEXTO DE EJECUCIÓN:\n${JSON.stringify(this.executionContext, null, 2)}\n`;
    }

    if (this.hasKnownSolution()) {
      prompt += '\nSOLUCIONES CONOCIDAS EN LA MEMORIA:\n';
      for (const solution of this.historicalSolutions) prompt += `- ${solution}\n`;
      if (this.historicalSolution && !this.historicalSolutions.includes(this.historicalSolution)) {
        prompt += `- ${this.historicalSolution}\n`;
      }
      prompt += '\nUsa esta experiencia como feedback. Adáptala al contexto actual y verifica que sea aplicable.\n';
    } else {
      prompt += '\nNo se encontró una solución previa utilizable. Propón una estrategia para resolver únicamente la tarea fallida.\n';
    }

    if (includeParentDAG && this.parentDAG && typeof this.parentDAG.toJSON === 'function') {
      prompt += `\nDAG ORIGINAL (SOLO CONTEXTO, NO MODIFICAR NI REPLANIFICAR):\n${JSON.stringify(this.parentDAG.toJSON(), null, 2)}\n`;
    }

    prompt += '\nGenera únicamente un nuevo DAG de recuperación para solucionar esta tarea fallida. No incluyas tareas ajenas al objetivo de recuperación. Requiere aprobación del usuario antes de ejecutarse.';
    return prompt;
  }
}

module.exports = RecoveryContext;
