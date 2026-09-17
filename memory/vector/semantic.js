const lancedb = require('@lancedb/lancedb');
const paths = require('../../config/paths');
/**
 * Gestor de Memoria Semántica basado en LanceDB.
 * Permite almacenar y buscar experiencias complejas utilizando similitud semántica.
 */
class SemanticMemory {
  constructor(dbDir = null) {
    this.dbDir = dbDir || paths.LANCEDB_DIR;
    this.db = null;
    this.table = null;
    this.tableName = 'error_experiences';
  }

  async init() {
    this.db = await lancedb.connect(this.dbDir);
    const tables = await this.db.tableNames();

    if (tables.includes(this.tableName)) {
      this.table = await this.db.openTable(this.tableName);
    }
  }

  async storeExperience(command, error, solution) {
    if (!this.db) await this.init();

    const data = [{
      command,
      error,
      solution,
      created_at: new Date().toISOString()
    }];

    if (!this.table) {
      this.table = await this.db.createTable(this.tableName, data);
    } else {
      await this.table.add(data);
    }
  }

  async searchSimilar(queryText, limit = 3) {
    if (!this.table) await this.init();
    if (!this.table) return [];

    try {
      // Búsqueda por coincidencia de texto dentro de LanceDB
      const results = await this.table
        .search(queryText)
        .limit(limit)
        .toArray();
      return results;
    } catch (e) {
      return [];
    }
  }
}

module.exports = SemanticMemory;