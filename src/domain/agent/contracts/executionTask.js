class ExecutionTask {
  constructor({
    id = '',
    description = '',
    tool = null,
    args = {
      path: '',
      filePath: '',
      content: '',
      command: '',
      query: '',
      target: '',
      symbol: '',
      paths: [],
      createDirs: true,
      status: 'SUCCESS',
      summary: '',
      reason: '',
      task_id: ''
    },
    context = {
      source: '',
      workingDirectory: '',
      environment: {},
      variables: {},
      metadata: {}
    },
    dependencies = [] // Cada elemento puede representar el id de una tarea: ['task_1', 'task_2'].
  } = {}) {
    if (!id || typeof id !== 'string' || !id.trim()) throw new Error('[ExecutionTask] id es obligatorio.');
    if (!description || typeof description !== 'string' || !description.trim()) throw new Error('[ExecutionTask] description es obligatorio.');
    if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('[ExecutionTask] args debe ser un objeto.');
    if (context === null || typeof context !== 'object' || Array.isArray(context)) throw new Error('[ExecutionTask] context debe ser un objeto.');
    if (!Array.isArray(dependencies)) throw new Error('[ExecutionTask] dependencies debe ser un array.');

    this.id = id.trim();
    this.description = description.trim();
    this.tool = tool ? String(tool).trim() : null;
    this.args = Object.freeze({ ...args });
    this.context = Object.freeze({ ...context });
    this.dependencies = Object.freeze([...dependencies]);
    Object.freeze(this);
  }

  hasExplicitTool() {
    return Boolean(this.tool);
  }

  toJSON() {
    return {
      id: this.id,
      description: this.description,
      tool: this.tool,
      args: { ...this.args },
      context: { ...this.context },
      dependencies: [...this.dependencies]
    };
  }
}

module.exports = ExecutionTask;
