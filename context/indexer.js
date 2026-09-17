const fs = require('fs');
const path = require('path');
const PatternEngine = require('./patternEngine');

/**
 * Indexador de repositorio. Genera un mapa de estructura y símbolos (clases, funciones, exportaciones)
 * para permitir búsquedas puntuales sin empaquetar el repositorio entero.
 */
class RepositoryIndexer {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.patternEngine = new PatternEngine();
    this.symbolIndex = new Map();
  }

  buildIndex(dir = this.projectRoot) {
    if (!fs.existsSync(dir)) return this.symbolIndex;

    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      const relPath = path.relative(this.projectRoot, fullPath).replace(/\\/g, '/');

      if (item.isDirectory()) {
        if (!this.patternEngine.isDirIgnored(item.name)) {
          this.buildIndex(fullPath);
        }
      } else if (this.patternEngine.shouldProcessFile(fullPath)) {
        this.extractSymbols(relPath, fullPath);
      }
    }
    return this.symbolIndex;
  }

  extractSymbols(relPath, fullPath) {
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const symbols = [];

      // Extracción rápida de símbolos (funciones, clases, exportaciones)
      const functionMatches = content.match(/function\s+([a-zA-Z0-9_$]+)|class\s+([a-zA-Z0-9_$]+)|const\s+([a-zA-Z0-9_$]+)\s*=\s*\(/g);
      if (functionMatches) {
        functionMatches.forEach(m => symbols.push(m.trim()));
      }

      this.symbolIndex.set(relPath, {
        path: relPath,
        size: content.length,
        symbols
      });
    } catch (e) {
      // Omisión silenciosa de archivos no legibles
    }
  }

  searchSymbols(query) {
    const results = [];
    const lowerQuery = query.toLowerCase();

    for (const [filePath, fileData] of this.symbolIndex.entries()) {
      const matchesSymbol = fileData.symbols.some(s => s.toLowerCase().includes(lowerQuery));
      const matchesPath = filePath.toLowerCase().includes(lowerQuery);

      if (matchesSymbol || matchesPath) {
        results.push(filePath);
      }
    }
    return results;
  }
}

module.exports = RepositoryIndexer;