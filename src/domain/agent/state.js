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
    toolCalls = [], // item: { tool: '', args: { path: '', filePath: '', content: '' }, result: null, timestamp: '' }
    errors = [], // item: { step: 1, error: '', timestamp: '' }
    dag = { tasks: [] }
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
    this.dag = dag instanceof TaskDAG ? dag : TaskDAG.fromJSON({ data: dag });
  }

  transition(newStatus = 'IDLE') {
    if (this.status === newStatus) {
      return;
    }
    const allowed = VALID_TRANSITIONS[this.status];
    if (allowed && !allowed.includes(newStatus)) {
      console.warn(`  ⚠️ [AGENT_STATE] Transición de estado rechazada: '${this.status}' -> '${newStatus}'`);
      return;
    }
    this.status = newStatus;
  }

  addToolCall({ tool = '', args = { path: '', content: '' }, result = null } = {}) {
    this.toolCalls.push({
      tool,
      args: { ...(args || {}) },
      result,
      timestamp: new Date().toISOString()
    });
  }

  addFileRead(filePath = '') {
    if (!this.filesRead.includes(filePath)) {
      this.filesRead.push(filePath);
    }
  }

  addFileModified(filePath = '') {
    if (!this.filesModified.includes(filePath)) {
      this.filesModified.push(filePath);
    }
  }

  addError(error = 'Fallo no especificado') {
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

  static fromJSON(data = { tasks: [] }) {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return new AgentState(parsed);
  }
}

module.exports = AgentState;