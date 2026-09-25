const Database = require('better-sqlite3');

class MemoryDatabase {
  /**
   * @param {Object} [options={}] - Opciones de configuración.
   * @param {string|null} [options.dbPath=null] - Ruta personalizada para la base de datos SQLite.
   */
  constructor({ dbPath = null } = {}) {
    const finalPath = dbPath;
    /** 
    * Instancia de la base de datos SQLite.
    * @type {import('better-sqlite3').Database} 
    */
    this.db = new Database(finalPath);
    this.db.pragma('foreign_keys = ON');
    this.initTables();
  }

  initTables() {
    this.db.exec(`

      CREATE TABLE IF NOT EXISTS episodic_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command TEXT NOT NULL,
        error_output TEXT,
        user_feedback TEXT,
        solution_applied TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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