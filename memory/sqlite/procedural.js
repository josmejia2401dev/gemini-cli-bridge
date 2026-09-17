/**
 * Gestor de Memoria Procedural.
 * Almacena secuencias de pasos aprendidas para resolver tipos específicos de tareas.
 */
class ProceduralMemory {
  constructor(dbConnection) {
    this.db = dbConnection.getDb();
  }

  saveProcedure(taskType, stepsArray) {
    const stmt = this.db.prepare(`
      INSERT INTO procedural_memory (task_type, steps_json, success_count, updated_at)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(task_type) DO UPDATE SET
        steps_json = excluded.steps_json,
        success_count = success_count + 1,
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(taskType, JSON.stringify(stepsArray));
  }

  getProcedure(taskType) {
    const stmt = this.db.prepare(`SELECT * FROM procedural_memory WHERE task_type = ?`);
    const row = stmt.get(taskType);
    if (row) {
      row.steps = JSON.parse(row.steps_json);
    }
    return row;
  }
}

module.exports = ProceduralMemory;