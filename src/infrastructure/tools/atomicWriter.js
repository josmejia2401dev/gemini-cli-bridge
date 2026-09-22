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
   * según la extensión del archivo y realiza el reemplazo atómico en disco.
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

    // 3. Validación sintáctica determinística según extensión
    const ext = path.extname(filePath).toLowerCase();
    try {
      if (['.js', '.cjs', '.mjs'].includes(ext)) {
        execSync(`node --check "${tmpPath}"`, { stdio: 'pipe' });
      } else if (ext === '.json') {
        JSON.parse(content);
      } else if (['.ts', '.tsx'].includes(ext)) {
        // Para TypeScript, intentamos validación con tsc sin emitir JS si existe en el entorno local
        try {
          execSync(`npx --no-install tsc --noEmit "${tmpPath}"`, { cwd: projectRoot, stdio: 'pipe' });
        } catch (tscErr) {
          // Si tsc no está disponible o falla por falta de config, aplicamos verificación estructural básica
          if (tscErr.code === 'ENOENT' || tscErr.message.includes('not found')) {
            this.validateBasicStructure(content);
          } else {
            throw tscErr;
          }
        }
      } else {
        // Archivos de texto plano / estilos / plantillas: verificación de estructura básica
        this.validateBasicStructure(content);
      }

      // 4. Swap Atómico (Reemplazo transparente únicamente tras pasar la validación)
      fs.renameSync(tmpPath, absPath);
      return { success: true, filePath, integrity: 'VALIDATED' };
    } catch (syntaxError) {
      // 5. Destrucción del archivo temporal si falla la sintaxis
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }

      const details = syntaxError.stderr 
        ? syntaxError.stderr.toString().trim() 
        : syntaxError.message;

      throw new Error(`[ERROR DE SINTAXIS EN CÓDIGO GENERADO] El archivo '${filePath}' NO se modificó en disco para evitar corrupción. Motivo: ${details}`);
    }
  }

  /**
   * Validación básica estructural para archivos sin linter/compilador nativo directo.
   * Evita guardar contenidos nulos o no textuales.
   */
  static validateBasicStructure(content) {
    if (typeof content !== 'string') {
      throw new Error('El contenido del archivo no es una cadena de texto válida.');
    }
  }
}

module.exports = AtomicWriter;