const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * AtomicWriter
 * Garantiza escrituras atómicas de archivos en disco bajo el paradigma Zero-Git.
 * Protege el repositorio contra Path Traversal y corrupción por errores sintácticos.
 */
class AtomicWriter {
  /**
   * Valida que la ruta de destino no rompa los límites del repositorio (Path Traversal Protection).
   * @param {string} projectRoot - Ruta raíz del proyecto.
   * @param {string} targetPath - Ruta relativa o absoluta del archivo a escribir.
   * @returns {boolean}
   */
  static isSafePath(projectRoot, targetPath) {
    const resolvedTarget = path.resolve(projectRoot, targetPath);
    const resolvedRoot = path.resolve(projectRoot);
    return resolvedTarget.startsWith(resolvedRoot);
  }

  /**
   * Escribe el contenido en un archivo temporal (.tmp), valida la sintaxis
   * y realiza el reemplazo atómico en disco si es correcto.
   * @param {string} projectRoot - Ruta raíz del proyecto.
   * @param {string} filePath - Ruta relativa del archivo.
   * @param {string} content - Contenido completo en código.
   * @returns {Object} { success: true, filePath, integrity: 'VALIDATED' }
   */
  static writeFile(projectRoot, filePath, content) {
    // 1. Protección contra Path Traversal
    if (!this.isSafePath(projectRoot, filePath)) {
      throw new Error(`[VIOLACIÓN DE SEGURIDAD] Intento de Path Traversal bloqueado: '${filePath}' está fuera de la raíz del proyecto.`);
    }

    const absPath = path.resolve(projectRoot, filePath);
    const tmpPath = `${absPath}.tmp`;

    // 2. Asegurar directorio de destino y escribir en archivo temporal (.tmp)
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(tmpPath, content, 'utf-8');

    // 3. Validación sintáctica determinística por extensión
    const ext = path.extname(filePath).toLowerCase();
    try {
      if (ext === '.js' || ext === '.cjs' || ext === '.mjs') {
        execSync(`node --check "${tmpPath}"`, { stdio: 'pipe' });
      } else if (ext === '.json') {
        JSON.parse(content);
      }

      // 4. Swap Atómico (Reemplazo transparente únicamente tras pasar la validación)
      fs.renameSync(tmpPath, absPath);
      return { success: true, filePath, integrity: 'VALIDATED' };
    } catch (syntaxError) {
      // 5. Destrucción del archivo temporal si falla la sintaxis. El archivo original JAMÁS se modifica.
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }

      const details = syntaxError.stderr 
        ? syntaxError.stderr.toString().trim() 
        : syntaxError.message;

      throw new Error(`[ERROR DE SINTAXIS EN CÓDIGO GENERADO] El archivo '${filePath}' NO se modificó en disco para evitar corrupción. Motivo: ${details}`);
    }
  }
}

module.exports = AtomicWriter;