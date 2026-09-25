class EpisodicMemory {
  constructor({ dbConnection = null } = {}) {
    if (!dbConnection) throw new Error('[EpisodicMemory] dbConnection es obligatorio.');
    this.db = dbConnection.getDb();
  }
  recordFailure(command = '', errorOutput = '', userFeedback = null) {
    const stmt = this.db.prepare('INSERT INTO episodic_memory (command, error_output, user_feedback) VALUES (?, ?, ?)');
    return stmt.run(command, errorOutput, userFeedback).lastInsertRowid;
  }
  recordSolution(failureId = null, solutionApplied = '') {
    if (!failureId) return;
    this.db.prepare('UPDATE episodic_memory SET solution_applied = ? WHERE id = ?').run(solutionApplied, failureId);
  }
  recordSuccess(command = '', solutionApplied = '') {
    const id = this.recordFailure(command, '', null);
    this.recordSolution(id, solutionApplied);
    return id;
  }
  findPastExperience(command = '') {
    const stmt = this.db.prepare('SELECT * FROM episodic_memory WHERE command LIKE ? ORDER BY created_at DESC LIMIT 10');
    return stmt.all(`%${String(command).replace(/[%_]/g, ' ').trim()}%`);
  }
  findKnownSolution({ errorSignature = '', command = '' } = {}) {
    const row = this.db.prepare('SELECT solution_applied FROM episodic_memory WHERE solution_applied IS NOT NULL AND (error_output LIKE ? OR command = ?) ORDER BY id DESC LIMIT 1').get(`%${errorSignature}%`, command);
    return row ? row.solution_applied : null;
  }
}
module.exports = EpisodicMemory;
