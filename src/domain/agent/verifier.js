const FileSystemUtils = require("../../shared/utils/fileSystemUtils");

/**
 * Validador Pre y Post ejecución para prevenir alucinaciones sintácticas,
 * path traversal y comandos mal estructurados antes de tocar la consola.
 */
class Verifier {
  static preExecuteCommand(command) {
    const parts = command.trim().split(/\s+/);
    const executable = parts[0];

    const knownActions = ['build', 'clean', 'test', 'run', 'start', 'compile'];
    const hasScriptLater = parts.slice(1).some(p => p.endsWith('.bat') || p.endsWith('.sh') || p.endsWith('.js'));

    if (knownActions.includes(executable.toLowerCase()) && hasScriptLater) {
      const correctScript = parts.find(p => p.endsWith('.bat') || p.endsWith('.sh') || p.endsWith('.js'));
      return {
        valid: false,
        reason: `Sintaxis invertida detectada. El ejecutable ('${correctScript}') debe ir al INICIO del comando.`
      };
    }

    return { valid: true };
  }

  static postExecute(output, stderr) {
    if (stderr && stderr.trim().length > 0 && !output) {
      return { success: false, error: stderr };
    }
    return { success: true };
  }

  static verifyModifiedFiles(projectRoot, filesModified) {
    const missing = [];
    for (const relPath of filesModified) {
      const content = FileSystemUtils.safeReadFile(projectRoot, relPath);
      if (content === null) {
        missing.push(relPath);
      }
    }
    if (missing.length > 0) {
      return {
        valid: false,
        reason: `Los siguientes archivos marcados como modificados no existen en disco: ${missing.join(', ')}`
      };
    }
    return { valid: true };
  }
}

module.exports = Verifier;