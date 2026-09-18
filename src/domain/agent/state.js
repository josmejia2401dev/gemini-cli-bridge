const TaskDAG = require('./dag');

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
    evidence = [],
    errors = [],
    iterations = 0,
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
    this.evidence = evidence;
    this.errors = errors;
    this.iterations = iterations;
    this.dag = dag instanceof TaskDAG ? dag : TaskDAG.fromJSON(dag);
  }

  transition(newStatus) {
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

  addEvidence(type, target, passed = false, details = '') {
    const existingIndex = this.evidence.findIndex(e => e.type === type && e.target === target);
    const entry = { type, target, passed, details, timestamp: new Date().toISOString() };
    if (existingIndex >= 0) {
      this.evidence[existingIndex] = entry;
    } else {
      this.evidence.push(entry);
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
      filesRead: this.filesRead,
      filesModified: this.filesModified,
      toolCalls: this.toolCalls,
      evidence: this.evidence,
      errors: this.errors,
      iterations: this.iterations,
      dag: this.dag.toJSON()
    };
  }

  static fromJSON(data) {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return new AgentState(parsed);
  }
}

module.exports = AgentState;