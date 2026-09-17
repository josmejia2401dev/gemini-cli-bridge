/**
 * Gestor de Memoria Episódica.
 * Guarda las experiencias de fallos y las observaciones enviadas por el usuario ('n [motivo]').
 */
class EpisodicMemory {
  constructor(dbConnection) {
    this.db = dbConnection.getDb();
  }

  recordFailure(command, errorOutput, userFeedback = null) {
    const stmt = this.db.prepare(`
      INSERT INTO episodic_memory (command, error_output, user_feedback)
      VALUES (?, ?, ?)
    `);
    stmt.run(command, errorOutput, userFeedback);
  }

  recordSolution(command, solutionApplied) {
    const stmt = this.db.prepare(`
      UPDATE episodic_memory
      SET solution_applied = ?
      WHERE command = ? AND solution_applied IS NULL
    `);
    stmt.run(solutionApplied, command);
  }

  findPastExperience(command) {
    const stmt = this.db.prepare(`
      SELECT * FROM episodic_memory 
      WHERE command LIKE ? OR user_feedback IS NOT NULL
      ORDER BY created_at DESC LIMIT 3
    `);
    return stmt.all(`%${command}%`);
  }
}

module.exports = EpisodicMemory;