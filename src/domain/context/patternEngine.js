const path = require('path');

/**
 * Motor de patrones para filtrado fino de archivos, exclusiones de seguridad,
 * ignorado de binarios y análisis de sintaxis de extensión.
 */
class PatternEngine {
  constructor() {
    this.ignoredDirs = new Set([
      'node_modules', '.git', 'dist', 'build', '.session', '.lancedb', 'coverage'
    ]);
    this.sensitivePatterns = [
      /\.env.*/i,
      /.*secret.*/i,
      /.*key.*/i,
      /id_rsa/i
    ];
    this.binaryExtensions = new Set([
      '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.exe', '.dll', '.so', '.tar', '.gz'
    ]);
  }

  isDirIgnored(dirName) {
    return this.ignoredDirs.has(dirName);
  }

  isBinary(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.binaryExtensions.has(ext);
  }

  isSensitive(filePath) {
    const baseName = path.basename(filePath);
    return this.sensitivePatterns.some(pattern => pattern.test(baseName));
  }

  shouldProcessFile(filePath) {
    if (this.isBinary(filePath)) return false;
    if (this.isSensitive(filePath)) return false;
    return true;
  }
}

module.exports = PatternEngine;