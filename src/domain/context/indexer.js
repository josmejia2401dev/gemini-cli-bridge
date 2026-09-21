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
      const ext = path.extname(fullPath).toLowerCase();

      // ENRUTAMIENTO POR LENGUAJE (Estrategia)
      if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
        this.parseJavaScript(content, symbols, imports, exports);
      } else if (ext === '.java') {
        this.parseJava(content, symbols, imports, exports);
      }

      // Guardamos en el índice sin importar el lenguaje procesado
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

  /**
   * Extractor específico para ecosistema JavaScript / TypeScript
   */
  parseJavaScript(content, symbols, imports, exports) {
    // 1. Clases e Interfaces
    const classMatches = content.matchAll(/(?:class|interface|type)\s+([a-zA-Z0-9_$]+)/g);
    for (const m of classMatches) symbols.add(m[1]);

    // 2. Funciones
    const funcMatches = content.matchAll(/(?:function\s+([a-zA-Z0-9_$]+)|const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(|let\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\()/g);
    for (const m of funcMatches) {
      const name = m[1] || m[2] || m[3];
      if (name) symbols.add(name);
    }

    // 3. Importaciones
    const requireMatches = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const m of requireMatches) imports.add(m[1]);

    const importFromMatches = content.matchAll(/from\s+['"]([^'"]+)['"]/g);
    for (const m of importFromMatches) imports.add(m[1]);

    // 4. Exportaciones
    const moduleExportMatches = content.matchAll(/module\.exports\s*=\s*([a-zA-Z0-9_$]+)/g);
    for (const m of moduleExportMatches) exports.add(m[1]);

    const exportsDotMatches = content.matchAll(/exports\.([a-zA-Z0-9_$]+)\s*=/g);
    for (const m of exportsDotMatches) exports.add(m[1]);

    const exportNamedMatches = content.matchAll(/export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type)\s+([a-zA-Z0-9_$]+)/g);
    for (const m of exportNamedMatches) exports.add(m[1]);
  }

  /**
   * Extractor específico para ecosistema Java (Spring, J2EE, etc)
   */
  parseJava(content, symbols, imports, exports) {
    // 1. Clases, Interfaces, Enums y Records
    const classMatches = content.matchAll(/(?:class|interface|enum|record)\s+([a-zA-Z0-9_$]+)/g);
    for (const m of classMatches) symbols.add(m[1]);

    // 2. Métodos (ignora palabras reservadas usadas como firmas accidentalmente)
    const methodMatches = content.matchAll(/(?:public|private|protected|static|final|\s)*\s+[A-Za-z0-9_<>,\[\]]+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?:throws\s+[A-Za-z0-9_,\s]+)?\s*\{/g);
    for (const m of methodMatches) {
      if (!['catch', 'if', 'while', 'for', 'switch', 'return', 'else'].includes(m[1])) {
        symbols.add(m[1]);
      }
    }

    // 3. Importaciones
    const importMatches = content.matchAll(/import\s+(?:static\s+)?([a-zA-Z0-9_$.*]+)\s*;/g);
    for (const m of importMatches) imports.add(m[1]);

    // 4. Exportaciones conceptuales (Paquete y clase principal pública)
    const packageMatches = content.matchAll(/package\s+([a-zA-Z0-9_$.]+)\s*;/g);
    for (const m of packageMatches) exports.add(m[1]); // Agregamos el paquete para saber su dominio

    const publicClassMatches = content.matchAll(/public\s+(?:abstract\s+)?(?:class|interface|enum|record)\s+([a-zA-Z0-9_$]+)/g);
    for (const m of publicClassMatches) exports.add(m[1]);
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