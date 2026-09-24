const fs = require('fs');
const path = require('path');
const PathSecurity = require('./pathSecurity');

class FileSystemUtils {
  /**
   * Resuelve y valida una ruta segura garantizando el confinamiento en projectRoot.
   */
  static resolveSafePath(projectRoot, relativePath) {
    if (!PathSecurity.isSafePath(projectRoot, relativePath)) {
      throw new Error(`[VIOLACIÓN DE SEGURIDAD] Intento de Path Traversal bloqueado: '${relativePath}' está fuera de la raíz del proyecto.`);
    }
    return path.resolve(projectRoot, relativePath);
  }

  /**
   * Resuelve una ruta arbitraria a su representación absoluta en el sistema
   * (sin restricción de Path Traversal para vinculación global de proyectos).
   */
  static resolveAbsolutePath(targetPath) {
    return path.resolve(targetPath);
  }

  /**
   * Obtiene la extensión de un archivo normalizada en minúsculas (ej: '.js', '.json').
   */
  static getExtension(filePath) {
    return path.extname(filePath).toLowerCase();
  }

  /**
   * Alias de getExtension para compatibilidad.
   */
  static getFileExtension(filePath) {
    return this.getExtension(filePath);
  }

  /**
   * Escribe contenido en un archivo de forma síncrona.
   */
  static writeFile(absFilePath, content, encoding = 'utf-8') {
    fs.writeFileSync(absFilePath, content, encoding);
  }

  /**
   * Asegura que el directorio padre de una ruta de archivo exista.
   */
  static ensureDirForFile(absFilePath) {
    const dir = path.dirname(absFilePath);
    fs.mkdirSync(dir, { recursive: true });
  }

  /**
   * Elimina un archivo en disco si existe, de forma silenciosa.
   */
  static removeIfExists(absFilePath) {
    if (fs.existsSync(absFilePath)) {
      try {
        fs.unlinkSync(absFilePath);
      } catch (e) { }
    }
  }

  /**
   * Lee el contenido de un archivo de forma segura dentro del directorio del proyecto.
   */
  static safeReadFile(projectRoot, relativePath) {
    const absPath = this.resolveSafePath(projectRoot, relativePath);
    if (fs.existsSync(absPath)) {
      return fs.readFileSync(absPath, 'utf-8');
    }
    return null;
  }

  /**
   * Reemplaza de forma atómica el archivo temporal por el de destino.
   */
  static atomicSwap(tmpPath, targetPath) {
    fs.renameSync(tmpPath, targetPath);
  }

  static fileExists(filePath) {
    return fs.existsSync(filePath);
  }

  static isFile(filePath) {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  }

  static readFile(filePath) {
    return fs.readFileSync(filePath, 'utf-8');
  }

  static readTruncatedFile(filePath, maxBytes = 102400) {
    if (!this.fileExists(filePath)) return null;
    const stats = fs.statSync(filePath);
    if (stats.size <= maxBytes) {
      return this.readFile(filePath);
    }

    const buffer = Buffer.alloc(maxBytes);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, maxBytes, 0);
    fs.closeSync(fd);

    return buffer.toString('utf-8') + `\n\n... [TRUNCADO: El archivo excede ${Math.round(maxBytes / 1024)} KB]`;
  }

  static readDir(dirPath) {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath, { withFileTypes: true }).map(item => ({
      name: item.name,
      isDirectory: item.isDirectory(),
      fullPath: path.join(dirPath, item.name)
    }));
  }

  static getRelativePath(from, to) {
    return path.relative(from, to).replace(/\\/g, '/');
  }

  static getFileName(filePath) {
    return path.basename(filePath).toLowerCase();
  }

  /**
   * Obtiene el nombre del archivo sin su extensión (ej. 'user.service.js' -> 'user.service').
   */
  static getFileNameWithoutExt(filePath) {
    const ext = path.extname(filePath);
    return path.basename(filePath, ext);
  }
}

module.exports = FileSystemUtils;