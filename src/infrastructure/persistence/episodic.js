/**
 * Gestor de Memoria Episódica.
 * Guarda las experiencias de fallos, soluciones aplicadas y observaciones.
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
    WHERE command LIKE ?
    ORDER BY created_at DESC LIMIT 3
  `);
  return stmt.all(`%${command}%`);
}

  /**
   * BÚSQUEDA DETERMINÍSTICA DE SOLUCIONES CONOCIDAS EN MEMORIA
   */
  findKnownSolution(errorSignature, command = '') {
    const stmt = this.db.prepare(`
      SELECT solution_applied FROM episodic_memory
      WHERE solution_applied IS NOT NULL 
        AND (error_output LIKE ? OR command = ?)
      ORDER BY id DESC LIMIT 1
    `);
    
    const row = stmt.get(`%${errorSignature}%`, command);
    return row ? row.solution_applied : null;
  }
}

module.exports = EpisodicMemory;