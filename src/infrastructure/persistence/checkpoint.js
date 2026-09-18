const AgentState = require('../../domain/agent/state');

class CheckpointManager {
  constructor(dbConnection) {
    this.db = dbConnection.getDb();
  }

  createRun(runId, objective) {
    const stmt = this.db.prepare(`
      INSERT INTO agent_runs (run_id, objective, status, updated_at)
      VALUES (?, ?, 'IDLE', CURRENT_TIMESTAMP)
      ON CONFLICT(run_id)
      DO UPDATE SET objective = excluded.objective, updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(runId, objective);
  }

  saveCheckpoint(state) {
    const runStmt = this.db.prepare(`
      UPDATE agent_runs
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE run_id = ?
    `);
    runStmt.run(state.status, state.runId);

    const checkpointStmt = this.db.prepare(`
      INSERT INTO agent_checkpoints (run_id, step_number, status, state_json)
      VALUES (?, ?, ?, ?)
    `);
    checkpointStmt.run(
      state.runId,
      state.currentStep,
      state.status,
      JSON.stringify(state.toJSON())
    );
  }

  getLatestCheckpoint(runId) {
    const stmt = this.db.prepare(`
      SELECT state_json FROM agent_checkpoints
      WHERE run_id = ?
      ORDER BY step_number DESC, id DESC
      LIMIT 1
    `);
    const row = stmt.get(runId);
    return row ? AgentState.fromJSON(row.state_json) : null;
  }

  hasPendingRun() {
    const stmt = this.db.prepare(`
      SELECT run_id FROM agent_runs
      WHERE status NOT IN ('SUCCESS', 'CANCELLED')
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    return stmt.get();
  }

  getPendingRun() {
    const run = this.hasPendingRun();
    if (!run) return null;
    return this.getLatestCheckpoint(run.run_id);
  }

  markRunCompleted(runId, status = 'SUCCESS') {
    const stmt = this.db.prepare(`
      UPDATE agent_runs
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE run_id = ?
    `);
    stmt.run(status, runId);
  }
}

module.exports = CheckpointManager;