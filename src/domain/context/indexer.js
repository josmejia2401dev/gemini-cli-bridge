const FileSystemUtils = require('../../shared/utils/fileSystemUtils');
const PatternEngine = require('./patternEngine');

/**
 * Indexador de repositorio. Escanea archivos y extrae símbolos,
 * importaciones y exportaciones para construir el grafo de dependencias
 * con una estructura unificada e independiente del lenguaje.
 */
class RepositoryIndexer {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.patternEngine = new PatternEngine();
    this.fileIndex = new Map(); // relPath -> { path, language, size, symbols, imports, exports }
  }

  buildIndex(dir = this.projectRoot) {
    if (!FileSystemUtils.fileExists(dir)) return this.fileIndex;

    const items = FileSystemUtils.readDir(dir);
    for (const item of items) {
      const relPath = FileSystemUtils.getRelativePath(this.projectRoot, item.fullPath);

      if (item.isDirectory) {
        if (!this.patternEngine.isDirIgnored(item.name)) {
          this.buildIndex(item.fullPath);
        }
      } else if (this.patternEngine.shouldProcessFile(item.fullPath)) {
        this.analyzeFile(relPath, item.fullPath);
      }
    }
    return this.fileIndex;
  }

  analyzeFile(relPath, fullPath) {
    try {
      const content = FileSystemUtils.readFile(fullPath);
      if (content === null) return;

      const symbols = new Set();
      const imports = new Set();
      const exports = new Set();
      const ext = FileSystemUtils.getFileExtension(fullPath);
      let language = 'other';

      // ENRUTAMIENTO POR LENGUAJE CON ESTRUCTURA NORMALIZADA
      if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
        language = ['.ts', '.tsx'].includes(ext) ? 'typescript' : 'javascript';
        this.parseJavaScript(content, symbols, imports, exports);
      } else if (ext === '.java') {
        language = 'java';
        this.parseJava(content, symbols, imports, exports);
      }

      this.fileIndex.set(relPath, {
        path: relPath,
        language,
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
   * Extractor específico para ecosistema Java (Spring, J2EE, etc.)
   */
  parseJava(content, symbols, imports, exports) {
    // 1. Clases, Interfaces, Enums y Records
    const classMatches = content.matchAll(/(?:class|interface|enum|record)\s+([a-zA-Z0-9_$]+)/g);
    for (const m of classMatches) symbols.add(m[1]);

    // 2. Métodos
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
    for (const m of packageMatches) exports.add(m[1]);

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