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
      this.tasks.get(id).status = status;
    }
  }

  isCompleted() {
    // Map usa .size, no .length
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

  // Imprime el árbol de subtareas en la terminal antes de iniciar acciones
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
    // Permite deserializar tanto un Arreglo directos [...] como un Objeto { tasks: [...] }
    const tasksArray = Array.isArray(data) ? data : (data.tasks || Object.values(data));
    return new TaskDAG(tasksArray);
  }
}

module.exports = TaskDAG;