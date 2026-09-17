const fs = require('fs');
const path = require('path');

/**
 * Recuperador de contexto relevante. Selecciona un subconjunto de archivos según la consulta
 * para optimizar la ventana de contexto del LLM.
 */
class ContextRetriever {
  constructor(indexer, projectRoot) {
    this.indexer = indexer;
    this.projectRoot = projectRoot;
  }

  retrieveRelevantContext(query, limit = 5) {
    const matchingPaths = this.indexer.searchSymbols(query).slice(0, limit);
    let bundledContext = '';

    for (const relPath of matchingPaths) {
      const absPath = path.resolve(this.projectRoot, relPath);
      if (fs.existsSync(absPath)) {
        const content = fs.readFileSync(absPath, 'utf-8');
        bundledContext += `\n<<<FILE_START: ${relPath}>>>\n${content}\n<<<FILE_END: ${relPath}>>>\n`;
      }
    }

    return {
      fileCount: matchingPaths.length,
      files: matchingPaths,
      contextText: bundledContext
    };
  }
}

module.exports = ContextRetriever;