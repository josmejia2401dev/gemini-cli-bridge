class TaskDAG {
  constructor(tasks = []) {
    // Normaliza el parámetro recibiendo Arreglos u Objetos de la deserialización de JSON
    const taskArray = Array.isArray(tasks)
      ? tasks
      : (tasks && typeof tasks === 'object' ? Object.values(tasks) : []);

    this.tasks = new Map(
      taskArray.map(t => [
        t.id,
        {
          id: t.id,
          description: t.description,
          dependencies: t.dependencies || [],
          status: t.status || 'pending'
        }
      ])
    );

    this.validate();
  }

  validate() {
    for (const [id, task] of this.tasks.entries()) {
      for (const depId of task.dependencies) {
        if (depId === id) {
          throw new Error(`[DAG ERROR] La tarea '${id}' depende de sí misma.`);
        }
        if (!this.tasks.has(depId)) {
          throw new Error(`[DAG ERROR] La tarea '${id}' hace referencia a una dependencia inexistente: '${depId}'.`);
        }
      }
    }

    const visited = new Map();
    const hasCycle = (taskId) => {
      visited.set(taskId, 'visiting');
      const task = this.tasks.get(taskId);
      for (const depId of (task?.dependencies || [])) {
        const state = visited.get(depId);
        if (state === 'visiting') return true;
        if (!state && hasCycle(depId)) return true;
      }
      visited.set(taskId, 'visited');
      return false;
    };

    for (const taskId of this.tasks.keys()) {
      if (!visited.has(taskId)) {
        if (hasCycle(taskId)) {
          throw new Error(`[DAG ERROR] Se detectó un ciclo infinito de dependencias en la estructura del DAG.`);
        }
      }
    }
  }

  // Retorna todas las tareas pendientes cuyas dependencias ya están completadas
  getNextTasks() {
    const executables = [];
    for (const task of this.tasks.values()) {
      if (task.status === 'pending') {
        const depsSatisfied = task.dependencies.every(depId => {
          const dep = this.tasks.get(depId);
          return dep && dep.status === 'completed';
        });
        if (depsSatisfied) {
          executables.push(task);
        }
      }
    }
    return executables;
  }

  updateStatus(id, status) {
    if (this.tasks.has(id)) {
      const task = this.tasks.get(id);
      const validTransitions = {
        pending: ['in_progress'],
        in_progress: ['completed', 'failed'],
        failed: ['pending', 'in_progress'],
        completed: ['in_progress', 'pending']
      };

      const allowed = validTransitions[task.status];
      if (allowed && !allowed.includes(status)) {
        console.warn(`  ⚠️ [DAG] Transición de subtarea rechazada en [${id}]: '${task.status}' -> '${status}'`);
        return;
      }
      task.status = status;
    }
  }

  markInProgress(id) {
    this.updateStatus(id, 'in_progress');
  }

  markCompleted(id) {
    this.updateStatus(id, 'completed');
  }

  markFailed(id) {
    this.updateStatus(id, 'failed');
  }

  isCompleted() {
    if (!this.tasks || this.tasks.size === 0) {
      return false;
    }
    return Array.from(this.tasks.values()).every(t => t.status === 'completed');
  }

  hasFailed() {
    if (!this.tasks || this.tasks.size === 0) {
      return false;
    }
    return Array.from(this.tasks.values()).some(t => t.status === 'failed');
  }

  formatSummary() {
    let output = '\n  📋 [PLAN DE EJECUCIÓN - TASK DAG]\n';
    output += '  ===============================================================\n';
    for (const task of this.tasks.values()) {
      const deps = task.dependencies.length > 0
        ? ` (Depende de: ${task.dependencies.join(', ')})`
        : ' (Independiente / Lista)';

      let icon = '📌';
      if (task.status === 'completed') icon = '✅';
      if (task.status === 'in_progress') icon = '⏳';
      if (task.status === 'failed') icon = '❌';

      output += `  ${icon} [${task.id}] ${task.description}${deps}\n`;
    }
    output += '  ===============================================================\n';
    return output;
  }

  toJSON() {
    return Array.from(this.tasks.values());
  }

  static fromJSON(data) {
    if (!data) return new TaskDAG([]);
    const tasksArray = Array.isArray(data) ? data : (data.tasks || Object.values(data));
    return new TaskDAG(tasksArray);
  }
}

module.exports = TaskDAG;