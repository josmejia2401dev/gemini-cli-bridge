const fs = require('fs');
const path = require('path');
const PatternEngine = require('./patternEngine');

/**
 * Indexador de repositorio. Escanea archivos y extrae símbolos,
 * importaciones y exportaciones para construir el grafo de dependencias.
 */
class RepositoryIndexer {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.patternEngine = new PatternEngine();
    this.fileIndex = new Map(); // relPath -> { path, size, symbols, imports, exports }
  }

  buildIndex(dir = this.projectRoot) {
    if (!fs.existsSync(dir)) return this.fileIndex;

    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      const relPath = path.relative(this.projectRoot, fullPath).replace(/\\/g, '/');

      if (item.isDirectory()) {
        if (!this.patternEngine.isDirIgnored(item.name)) {
          this.buildIndex(fullPath);
        }
      } else if (this.patternEngine.shouldProcessFile(fullPath)) {
        this.analyzeFile(relPath, fullPath);
      }
    }
    return this.fileIndex;
  }

  analyzeFile(relPath, fullPath) {
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const symbols = new Set();
      const imports = new Set();
      const exports = new Set();

      // 1. Clases y Funciones
      const classMatches = content.matchAll(/class\s+([a-zA-Z0-9_$]+)/g);
      for (const m of classMatches) symbols.add(m[1]);

      const funcMatches = content.matchAll(/(?:function\s+([a-zA-Z0-9_$]+)|const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(|let\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\()/g);
      for (const m of funcMatches) {
        const name = m[1] || m[2] || m[3];
        if (name) symbols.add(name);
      }

      // 2. Importaciones (require / import)
      const requireMatches = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
      for (const m of requireMatches) imports.add(m[1]);

      const importFromMatches = content.matchAll(/from\s+['"]([^'"]+)['"]/g);
      for (const m of importFromMatches) imports.add(m[1]);

      // 3. Exportaciones (module.exports / export / exports.x)
      const moduleExportMatches = content.matchAll(/module\.exports\s*=\s*([a-zA-Z0-9_$]+)/g);
      for (const m of moduleExportMatches) exports.add(m[1]);

      const exportsDotMatches = content.matchAll(/exports\.([a-zA-Z0-9_$]+)\s*=/g);
      for (const m of exportsDotMatches) exports.add(m[1]);

      const exportNamedMatches = content.matchAll(/export\s+(?:default\s+)?(?:class|function|const|let|var)\s+([a-zA-Z0-9_$]+)/g);
      for (const m of exportNamedMatches) exports.add(m[1]);

      this.fileIndex.set(relPath, {
        path: relPath,
        size: content.length,
        symbols: Array.from(symbols),
        imports: Array.from(imports),
        exports: Array.from(exports)
      });
    } catch (e) {
      // Omisión silenciosa de archivos no legibles
    }
  }

  searchSymbols(query) {
    const results = [];
    const lowerQuery = query.toLowerCase();

    for (const [filePath, fileData] of this.fileIndex.entries()) {
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