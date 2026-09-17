/**
 * Gestor de Memoria Operacional.
 * Mantiene el control del estado activo de la tarea durante la sesión.
 */
class OperationalMemory {
  constructor(dbConnection) {
    this.db = dbConnection.getDb();
  }

  setTask(taskId, goal) {
    const stmt = this.db.prepare(`
      INSERT INTO operational_memory (task_id, goal, current_step, status, updated_at)
      VALUES (?, ?, 1, 'active', CURRENT_TIMESTAMP)
      ON CONFLICT(task_id) DO UPDATE SET
        goal = excluded.goal,
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(taskId, goal);
  }

  updateProgress(taskId, currentStep, status = 'active', filesChanged = []) {
    const stmt = this.db.prepare(`
      UPDATE operational_memory
      SET current_step = ?, status = ?, files_changed = ?, updated_at = CURRENT_TIMESTAMP
      WHERE task_id = ?
    `);
    stmt.run(currentStep, status, JSON.stringify(filesChanged), taskId);
  }

  getTask(taskId) {
    const stmt = this.db.prepare(`SELECT * FROM operational_memory WHERE task_id = ?`);
    const row = stmt.get(taskId);
    if (row) {
      row.files_changed = JSON.parse(row.files_changed || '[]');
    }
    return row;
  }

  clearTask(taskId) {
    const stmt = this.db.prepare(`DELETE FROM operational_memory WHERE task_id = ?`);
    stmt.run(taskId);
  }
}

module.exports = OperationalMemory;