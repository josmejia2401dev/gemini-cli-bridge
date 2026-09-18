const Database = require('better-sqlite3');
const paths = require('../../shared/config/paths');

class MemoryDatabase {
  constructor(dbPath = null) {
    const finalPath = dbPath || paths.SQLITE_DB;
    this.db = new Database(finalPath);
    this.initTables();
  }

  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operational_memory (
        task_id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        current_step INTEGER DEFAULT 1,
        status TEXT DEFAULT 'active',
        files_changed TEXT DEFAULT '[]',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS episodic_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command TEXT NOT NULL,
        error_output TEXT,
        user_feedback TEXT,
        solution_applied TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS procedural_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_type TEXT NOT NULL UNIQUE,
        steps_json TEXT NOT NULL,
        success_count INTEGER DEFAULT 1,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS agent_runs (
        run_id TEXT PRIMARY KEY,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS agent_checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        step_number INTEGER NOT NULL,
        status TEXT NOT NULL,
        state_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE
      );
    `);
  }

  getDb() {
    return this.db;
  }
}

module.exports = MemoryDatabase;