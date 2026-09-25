const ExecutionTask = require('./contracts/executionTask');

class TaskDAG {
  constructor({
    tasks = [] // Cada tarea: { id: '', description: '', tool: null, args: { path: '', filePath: '', content: '', command: '', query: '', target: '', symbol: '', paths: [], createDirs: true, status: 'SUCCESS', summary: '', reason: '', task_id: '' }, context: { source: '', workingDirectory: '', environment: {}, variables: {}, metadata: {} }, dependencies: [], status: 'pending' }.
  } = {}) {
    const taskArray = Array.isArray(tasks)
      ? tasks
      : (tasks && typeof tasks === 'object' ? Object.values(tasks) : []);

    this.tasks = new Map();

    for (const rawTask of taskArray) {
      if (!rawTask || !rawTask.id || !rawTask.description) continue;

      const task = rawTask instanceof ExecutionTask
        ? rawTask
        : new ExecutionTask({
            id: rawTask.id,
            description: rawTask.description,
            tool: rawTask.tool ?? null,
            args: rawTask.args ?? {},
            context: rawTask.context ?? {},
            dependencies: rawTask.dependencies ?? []
          });

      if (this.tasks.has(task.id)) {
        throw new Error(
          `[DAG ERROR] ID duplicado: '${task.id}'.`
        );
      }

      this.tasks.set(task.id, {
        ...task.toJSON(),
        status: rawTask.status || 'pending'
      });
    }

    if (this.tasks.size > 0) {
      this.validate();
    }
  }

  validate() {
    if (this.tasks.size === 0) {
      throw new Error(
        '[DAG ERROR] El DAG debe contener al menos una tarea.'
      );
    }

    const ids = new Set(this.tasks.keys());

    for (const task of this.tasks.values()) {
      if (!task.description.trim()) {
        throw new Error(
          `[DAG ERROR] La tarea '${task.id}' no tiene descripción.`
        );
      }

      for (const depId of task.dependencies) {
        if (depId === task.id) {
          throw new Error(
            `[DAG ERROR] La tarea '${task.id}' depende de sí misma.`
          );
        }

        if (!ids.has(depId)) {
          throw new Error(
            `[DAG ERROR] La tarea '${task.id}' referencia una dependencia inexistente: '${depId}'.`
          );
        }
      }
    }

    const state = new Map();

    const visit = (id) => {
      state.set(id, 'visiting');

      for (const dep of this.tasks.get(id).dependencies) {
        if (state.get(dep) === 'visiting') return true;
        if (!state.get(dep) && visit(dep)) return true;
      }

      state.set(id, 'visited');
      return false;
    };

    for (const id of this.tasks.keys()) {
      if (!state.get(id) && visit(id)) {
        throw new Error(
          '[DAG ERROR] Se detectó un ciclo de dependencias.'
        );
      }
    }

    return true;
  }

  getNextTasks({
    status = 'pending'
  } = {}) {
    return [...this.tasks.values()].filter(task =>
      task.status === status &&
      task.dependencies.every(
        dependencyId =>
          this.tasks.get(dependencyId)?.status === 'completed'
      )
    );
  }

  getWaitingManualTasks() {
    return [...this.tasks.values()].filter(
      task => task.status === 'waiting_manual'
    );
  }

  updateStatus({
    id = '',
    status = 'pending'
  } = {}) {
    const task = this.tasks.get(id);

    if (!task) return false;

    const allowed = {
      pending: ['in_progress'],
      in_progress: ['completed', 'failed', 'waiting_manual'],
      failed: ['pending', 'in_progress', 'waiting_manual'],
      waiting_manual: ['completed', 'pending'],
      completed: ['in_progress', 'pending']
    }[task.status];

    if (allowed && !allowed.includes(status)) {
      return false;
    }

    task.status = status;
    return true;
  }

  markInProgress(id = '') {
    return this.updateStatus({
      id,
      status: 'in_progress'
    });
  }

  markCompleted(id = '') {
    return this.updateStatus({
      id,
      status: 'completed'
    });
  }

  markFailed(id = '') {
    return this.updateStatus({
      id,
      status: 'failed'
    });
  }

  markWaitingManual(id = '') {
    return this.updateStatus({
      id,
      status: 'waiting_manual'
    });
  }

  isCompleted() {
    return this.tasks.size > 0 &&
      [...this.tasks.values()].every(
        task => task.status === 'completed'
      );
  }

  hasFailed() {
    return [...this.tasks.values()].some(
      task => task.status === 'failed'
    );
  }

  hasWaitingManualResolution() {
    return this.getWaitingManualTasks().length > 0;
  }

  getSequence() {
    return [...this.tasks.values()];
  }

  formatSummary({
    title = 'PLAN DE EJECUCIÓN - TASK DAG'
  } = {}) {
    let out =
      `\n  📋 [${title}]\n  ===============================================================\n`;

    for (const task of this.tasks.values()) {
      const deps = task.dependencies.length
        ? ` (Depende de: ${task.dependencies.join(', ')})`
        : ' (Independiente / Lista)';

      const icon =
        task.status === 'completed'
          ? '✅'
          : task.status === 'in_progress'
            ? '⏳'
            : task.status === 'failed'
              ? '❌'
              : task.status === 'waiting_manual'
                ? '👤'
                : '📌';

      out +=
        `  ${icon} [${task.id}] ${task.description}${deps}` +
        (task.status === 'waiting_manual'
          ? ' [ESPERANDO RESOLUCIÓN MANUAL]'
          : '') +
        '\n';
    }

    return (
      out +
      '  ===============================================================\n'
    );
  }

  toJSON() {
    return [...this.tasks.values()].map(task => ({
      ...task,
      args: { ...task.args },
      context: { ...task.context },
      dependencies: [...task.dependencies]
    }));
  }

  static fromJSON({
    data = { tasks: [] }
  } = {}) {
    const parsed = Array.isArray(data)
      ? data
      : (
          data?.tasks
            ? data.tasks
            : Object.values(data || {})
        );

    return new TaskDAG({
      tasks: parsed
    });
  }
}

module.exports = TaskDAG;
