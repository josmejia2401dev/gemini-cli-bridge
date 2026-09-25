const SYSTEM_PROMPTS = require('../../../shared/config/prompts');
const ExecutionTask = require('../contracts/executionTask');
const PlanningSubflow = require('../subflows/planningSubflow');
const ExecutionSubflow = require('../subflows/executionSubflow');
const InterpreterSubflow = require('../subflows/interpreterSubflow');
const RecoverySubflow = require('../subflows/recoverySubflow');
const TaskExecutionCoordinator = require('./taskExecutionCoordinator');
const AgentState = require('../state');

class AgentRuntime {
  constructor({
    modelRouter = null, toolRegistry = null, projectRoot = '', repl = null,
    episodicMemory = null, checkpointManager = null, decisionEngine = null,
    planningSubflow = null, executionSubflow = null, interpreterSubflow = null,
    recoverySubflow = null
  } = {}) {
    if (!modelRouter) throw new Error('[AgentRuntime] modelRouter es obligatorio.');
    if (!toolRegistry) throw new Error('[AgentRuntime] toolRegistry es obligatorio.');
    if (!projectRoot) throw new Error('[AgentRuntime] projectRoot es obligatorio.');

    this.modelRouter = modelRouter;
    this.toolRegistry = toolRegistry;
    this.projectRoot = projectRoot;
    this.repl = repl;
    this.episodicMemory = episodicMemory;
    this.checkpointManager = checkpointManager;
    this.decisionEngine = decisionEngine;
    this.currentState = new AgentState();

    this.interpreter = interpreterSubflow || new InterpreterSubflow({ toolRegistry });
    this.execution = executionSubflow || new ExecutionSubflow({ toolRegistry, projectRoot, repl });
    this.planning = planningSubflow || new PlanningSubflow({ modelRouter, repl });
    this.recovery = recoverySubflow || new RecoverySubflow({ episodicMemory });
    this.coordinator = new TaskExecutionCoordinator({
      execution: this.execution,
      recovery: this.recovery,
      planning: this.planning,
      taskResolver: (task, context) => this._resolveTaskInstruction(task, context)
    });
  }

  setProjectRoot(newRoot = '') {
    if (!newRoot || typeof newRoot !== 'string') return;
    this.projectRoot = newRoot;
    this.execution.projectRoot = newRoot;
  }

  async runLoop(input = '', options = { mode: null, pendingState: null }) {
    global.isProcessing = true;
    global.abortLoop = false;
    const mode = options.mode || (this.decisionEngine ? this.decisionEngine.classify(input).mode : 'PLANNING');
    try {
      if (mode === 'DIRECT_CHAT') return await this._runDirectChatFlow(input);
      if (mode === 'DETERMINISTIC') return await this._runDeterministicFlow(input, options);
      return await this._runPlannedFlow(input, options.pendingState || null);
    } finally {
      global.isProcessing = false;
    }
  }


  async _resolveTaskInstruction(task = null, context = { source: '', workingDirectory: '', environment: {}, variables: {}, metadata: {} }) {
    
    const request = `${SYSTEM_PROMPTS.GLOBAL_TOOL_RULES}\n\n[TAREA A EJECUTAR]\n${task.description}\n\nGenera UNA sola instrucción de herramienta válida para completar esta tarea. No expliques nada más.`;
    const response = await this.modelRouter.generate({ prompt: request });
    const interpreted = this.interpreter.parse(response.text);
    if (!interpreted.isInstruction()) throw new Error(`La IA no produjo un tool call ejecutable. Respuesta: ${String(response.text || '').slice(0, 500)}`);
    return new ExecutionTask({ id: task.id, description: task.description, tool: interpreted.tool, args: interpreted.args, context: { ...task.context, ...context, resolvedBy: 'LLM' }, dependencies: task.dependencies });
  }

  async _runDirectChatFlow(input = '') {
    if (!input || global.abortLoop) return { type: 'END' };

    const response = await this.modelRouter.generate({
      prompt: input
    });
    const interpreted = this.interpreter.parse(response.text);

    if (interpreted.isMessage()) {
      console.log(`\n💬 [IA]: ${interpreted.message}`);
      return { type: 'MESSAGE', text: interpreted.message };
    }

    const task = new ExecutionTask({
      id: `chat_inst_${Date.now()}`,
      description: `Instrucción generada por conversación: ${interpreted.tool}`,
      tool: interpreted.tool,
      args: interpreted.args,
      context: { source: 'DIRECT_CHAT', prompt: input }
    });

    console.log(`\n⚡ [INSTRUCCIÓN DETECTADA EN CHAT]: ${interpreted.tool}`);
    const execution = await this.coordinator.executeTaskWithRecovery(task, {
      objective: task.description,
      executionContext: { source: 'DIRECT_CHAT' }
    });

    if (!execution.success) {
      console.log(`\n❌ [SISTEMA] No se pudo completar la instrucción: ${execution.result?.error || 'error desconocido'}`);
      return execution;
    }

    console.log('\n✅ [SISTEMA] Instrucción ejecutada exitosamente.');
    return {
      type: 'EXECUTION',
      tool: interpreted.tool,
      result: execution.result,
      success: true
    };
  }

  async _runDeterministicFlow(input = '') {
    const decision = this.decisionEngine?.classify(input);
    if (!decision?.tool) return this._runDirectChatFlow(input);
    const task = new ExecutionTask({ id: `det_${Date.now()}`, description: input, tool: decision.tool, args: decision.args || {}, context: { source: 'DETERMINISTIC' } });
    const result = await this.coordinator.executeTaskWithRecovery(task, { objective: input, executionContext: { source: 'DETERMINISTIC' } });
    console.log(result.success ? '\n✅ [SISTEMA] Operación completada.\n' : `\n❌ [SISTEMA] Operación no completada: ${result.result?.error || 'error desconocido'}\n`);
    return result;
  }

  async _runPlannedFlow(objective = '', pendingState = null) {
    this.currentState = pendingState || new AgentState({ runId: `run_${Date.now()}`, objective, status: 'PLANNING' });
    this.currentState.objective = this.currentState.objective || objective;
    if (!pendingState) this.currentState.transition('PLANNING');

    if (this.checkpointManager && this.currentState.runId) {
      if (!pendingState) this.checkpointManager.createRun(this.currentState.runId, objective);
      this.checkpointManager.saveCheckpoint(this.currentState);
    }

    const dag = pendingState?.dag || await this.planning.generateAndApproveDAG({ objective, requireApproval: true });
    this.currentState.dag = dag;
    this.currentState.transition('EXECUTING');
    if (this.checkpointManager) this.checkpointManager.saveCheckpoint(this.currentState);

    const result = await this.coordinator.executeDAG(dag, { objective, executionContext: { source: 'PLANNING' } });

    if (result.success) {
      this.currentState.transition('SUCCESS');
      if (this.checkpointManager) {
        this.checkpointManager.saveCheckpoint(this.currentState);
        this.checkpointManager.markRunCompleted(this.currentState.runId, 'SUCCESS');
      }
      console.log('\n🎉 [ÉXITO GLOBAL] Todas las tareas del DAG fueron completadas.\n');
    } else {
      this.currentState.addError(result.result?.error || 'Fallo de ejecución');
      this.currentState.transition('IDLE');
      if (this.checkpointManager) this.checkpointManager.saveCheckpoint(this.currentState);
      console.log(`\n❌ [SISTEMA] El plan no pudo completarse: ${result.result?.error || 'error desconocido'}\n`);
    }
    return result;
  }
}
module.exports = AgentRuntime;
