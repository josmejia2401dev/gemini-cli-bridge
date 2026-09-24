const TaskDAG = require('./dag');

const VALID_TRANSITIONS = {
  IDLE: ['PLANNING', 'EXECUTING', 'SUCCESS'],
  PLANNING: ['EXECUTING', 'REPLAN', 'IDLE'],
  EXECUTING: ['VERIFYING', 'REPLAN', 'SUCCESS', 'IDLE'],
  VERIFYING: ['EXECUTING', 'SUCCESS', 'REPLAN', 'IDLE'],
  REPLAN: ['PLANNING', 'EXECUTING', 'IDLE'],
  SUCCESS: ['IDLE', 'PLANNING']
};

class AgentState {
  constructor({
    runId = null,
    objective = '',
    status = 'IDLE',
    currentStep = 1,
    completedSteps = [],
    failedSteps = [],
    filesRead = [],
    filesModified = [],
    toolCalls = [],
    errors = [],
    dag = []
  } = {}) {
    this.runId = runId;
    this.objective = objective;
    this.status = status;
    this.currentStep = currentStep;
    this.completedSteps = completedSteps;
    this.failedSteps = failedSteps;
    this.filesRead = Array.from(new Set(filesRead));
    this.filesModified = Array.from(new Set(filesModified));
    this.toolCalls = toolCalls;
    this.errors = errors;
    this.dag = dag instanceof TaskDAG ? dag : TaskDAG.fromJSON(dag);
  }

  transition(newStatus) {
    const allowed = VALID_TRANSITIONS[this.status];
    if (allowed && !allowed.includes(newStatus)) {
      console.warn(`  ⚠️ [AGENT_STATE] Transición de estado rechazada: '${this.status}' -> '${newStatus}'`);
      return;
    }
    this.status = newStatus;
  }

  addToolCall(tool, args, result) {
    this.toolCalls.push({
      tool,
      args,
      result,
      timestamp: new Date().toISOString()
    });
  }

  addFileRead(filePath) {
    if (!this.filesRead.includes(filePath)) {
      this.filesRead.push(filePath);
    }
  }

  addFileModified(filePath) {
    if (!this.filesModified.includes(filePath)) {
      this.filesModified.push(filePath);
    }
  }

  addError(error) {
    this.errors.push({
      step: this.currentStep,
      error: typeof error === 'string' ? error : error.message,
      timestamp: new Date().toISOString()
    });
  }

  toJSON() {
    return {
      runId: this.runId,
      objective: this.objective,
      status: this.status,
      currentStep: this.currentStep,
      completedSteps: this.completedSteps,
      failedSteps: this.failedSteps,
      skippedTasks: this.skippedTasks,
      filesRead: this.filesRead,
      filesModified: this.filesModified,
      toolCalls: this.toolCalls,
      errors: this.errors,
      dag: this.dag.toJSON()
    };
  }

  static fromJSON(data) {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return new AgentState(parsed);
  }
}

module.exports = AgentState;