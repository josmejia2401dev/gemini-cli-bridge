const Database = require('better-sqlite3');
const paths = require('../../config/paths');

/**
 * Inicialización y gestión de la conexión SQLite local.
 * Crea las tablas necesarias para las memorias Operacional, Episódica y Procedural.
 */
class MemoryDatabase {
  constructor(dbPath = null) {
    const finalPath = dbPath || paths.SQLITE_DB;
    this.db = new Database(finalPath);
    this.initTables();
  }

  initTables() {
    // Memoria Operacional (Estado activo de la tarea)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operational_memory (
        task_id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        current_step INTEGER DEFAULT 1,
        status TEXT DEFAULT 'active',
        files_changed TEXT DEFAULT '[]',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Memoria Episódica (Historial de errores y soluciones aplicadas)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodic_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command TEXT NOT NULL,
        error_output TEXT,
        user_feedback TEXT,
        solution_applied TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Memoria Procedural (Recetas y secuencias de pasos exitosos)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS procedural_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_type TEXT NOT NULL UNIQUE,
        steps_json TEXT NOT NULL,
        success_count INTEGER DEFAULT 1,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  getDb() {
    return this.db;
  }
}

module.exports = MemoryDatabase;