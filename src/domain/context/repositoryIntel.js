const RepositoryIndexer = require('./indexer');

/**
 * RepositoryIntelligence
 * Administra el mapa relacional del proyecto y responde consultas de estructura,
 * importaciones y dependencias en milisegundos.
 */
class RepositoryIntelligence {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.indexer = new RepositoryIndexer(projectRoot);
    this.isIndexed = false;
  }

  ensureIndex() {
    if (!this.isIndexed) {
      this.indexer.buildIndex();
      this.isIndexed = true;
    }
  }

  /**
   * Consulta en milisegundos qué archivos importan una clase, módulo o archivo.
   * @param {string} target - Nombre de la clase, archivo o módulo.
   */
  whoImports(target) {
    this.ensureIndex();
    const importers = [];
    const normalizedTarget = target.toLowerCase().replace(/\\/g, '/');

    for (const [filePath, data] of this.indexer.fileIndex.entries()) {
      const match = data.imports.some(imp => {
        const normalizedImp = imp.toLowerCase().replace(/\\/g, '/');
        const segments = normalizedImp.split('/');
        const lastSegment = segments[segments.length - 1].replace(/\.(js|ts|jsx|tsx|java)$/i, '');
        return lastSegment === normalizedTarget || normalizedImp.endsWith(`/${normalizedTarget}`);
      });

      if (match) {
        importers.push(filePath);
      }
    }

    return {
      target,
      count: importers.length,
      importers
    };
  }

  /**
   * Obtiene las dependencias directas que requiere un archivo específico.
   * @param {string} filePath - Ruta relativa del archivo.
   */
  getDependencies(filePath) {
    this.ensureIndex();
    const normalizedPath = filePath.toLowerCase().replace(/\\/g, '/');

    for (const [relPath, data] of this.indexer.fileIndex.entries()) {
      if (relPath.toLowerCase() === normalizedPath || relPath.toLowerCase().endsWith(normalizedPath)) {
        return {
          file: relPath,
          importsCount: data.imports.length,
          imports: data.imports,
          exports: data.exports
        };
      }
    }

    return { file: filePath, importsCount: 0, imports: [], exports: [] };
  }

  /**
   * Localiza dónde está definido y/o exportado un símbolo (clase, función).
   * @param {string} symbol - Nombre del símbolo.
   */
  findSymbolDefinition(symbol) {
    this.ensureIndex();
    const lowerSymbol = symbol.toLowerCase();
    const definitions = [];

    for (const [filePath, data] of this.indexer.fileIndex.entries()) {
      const isExported = data.exports.some(e => e.toLowerCase() === lowerSymbol);
      const isSymbol = data.symbols.some(s => s.toLowerCase() === lowerSymbol);

      if (isExported || isSymbol) {
        definitions.push({
          file: filePath,
          isExported,
          symbols: data.symbols,
          exports: data.exports
        });
      }
    }

    return {
      symbol,
      count: definitions.length,
      definitions
    };
  }
}

module.exports = RepositoryIntelligence;