const TaskDAG = require('./dag');

const VALID_TRANSITIONS = {
  IDLE: ['PLANNING', 'EXECUTING', 'SUCCESS'],
  PLANNING: ['EXECUTING', 'REPLAN', 'IDLE', 'WAITING_MANUAL'],
  EXECUTING: ['VERIFYING', 'REPLAN', 'SUCCESS', 'IDLE', 'WAITING_MANUAL'],
  VERIFYING: ['EXECUTING', 'SUCCESS', 'REPLAN', 'IDLE', 'WAITING_MANUAL'],
  REPLAN: ['PLANNING', 'EXECUTING', 'IDLE', 'WAITING_MANUAL'],
  WAITING_MANUAL: ['EXECUTING', 'SUCCESS', 'IDLE'],
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
    toolCalls = [], // item: { tool: '', args: {}, result: null, timestamp: '' }
    errors = [], // item: { step: 1, error: '', timestamp: '' }
    manualResolution = {
      taskId: null,
      failureId: null,
      error: ''
    },
    dag = { tasks: [] }
  } = {}) {
    this.runId = runId;
    this.objective = objective;
    this.status = status;
    this.currentStep = currentStep;
    this.completedSteps = Array.isArray(completedSteps) ? completedSteps : [];
    this.failedSteps = Array.isArray(failedSteps) ? failedSteps : [];
    this.filesRead = Array.from(new Set(filesRead));
    this.filesModified = Array.from(new Set(filesModified));
    this.toolCalls = Array.isArray(toolCalls) ? toolCalls : [];
    this.errors = Array.isArray(errors) ? errors : [];
    this.manualResolution = {
      taskId: manualResolution?.taskId || null,
      failureId: manualResolution?.failureId ?? null,
      error: String(manualResolution?.error || '')
    };
    this.dag = dag instanceof TaskDAG
      ? dag
      : TaskDAG.fromJSON({ data: dag });
  }

  transition(newStatus = 'IDLE') {
    if (this.status === newStatus) return;

    const allowed = VALID_TRANSITIONS[this.status];

    if (allowed && !allowed.includes(newStatus)) {
      console.warn(
        `  ⚠️ [AGENT_STATE] Transición de estado rechazada: '${this.status}' -> '${newStatus}'`
      );
      return;
    }

    this.status = newStatus;
  }

  addToolCall({
    tool = '',
    args = {},
    result = null
  } = {}) {
    this.toolCalls.push({
      tool,
      args: { ...(args || {}) },
      result,
      timestamp: new Date().toISOString()
    });
  }

  addFileRead(filePath = '') {
    if (filePath && !this.filesRead.includes(filePath)) {
      this.filesRead.push(filePath);
    }
  }

  addFileModified(filePath = '') {
    if (
      filePath &&
      !this.filesModified.includes(filePath)
    ) {
      this.filesModified.push(filePath);
    }
  }

  addError(
    error = 'Fallo no especificado'
  ) {
    this.errors.push({
      step: this.currentStep,
      error:
        typeof error === 'string'
          ? error
          : error?.message || String(error),
      timestamp:
        new Date().toISOString()
    });
  }

  hasWaitingManualResolution() {
    return Boolean(
      this.manualResolution.taskId ||
      this.dag.hasWaitingManualResolution()
    );
  }

  setManualResolution({
    taskId = null,
    failureId = null,
    error = ''
  } = {}) {
    this.manualResolution = {
      taskId: taskId || null,
      failureId: failureId ?? null,
      error: String(error || '')
    };
  }

  clearManualResolution() {
    this.manualResolution = {
      taskId: null,
      failureId: null,
      error: ''
    };
  }

  getWaitingManualTasks() {
    return this.dag.getWaitingManualTasks();
  }

  toJSON() {
    return {
      runId: this.runId,
      objective: this.objective,
      status: this.status,
      currentStep: this.currentStep,
      completedSteps: this.completedSteps,
      failedSteps: this.failedSteps,
      filesRead: this.filesRead,
      filesModified: this.filesModified,
      toolCalls: this.toolCalls,
      errors: this.errors,
      manualResolution: { ...this.manualResolution },
      dag: this.dag.toJSON()
    };
  }

  static fromJSON(
    data = { tasks: [] }
  ) {
    const parsed =
      typeof data === 'string'
        ? JSON.parse(data)
        : data;

    return new AgentState(parsed);
  }
}

module.exports = AgentState;
