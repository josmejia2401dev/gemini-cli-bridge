const path = require('path');

/**
 * Validador Pre y Post ejecución para prevenir alucinaciones sintácticas,
 * path traversal y comandos mal estructurados antes de tocar la consola.
 */
class Verifier {
  static preExecuteCommand(command) {
    const parts = command.trim().split(/\s+/);
    const executable = parts[0];

    // Detección de sintaxis invertida en Windows/Gradle/NPM (ej. 'build clean gradlew.bat')
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

  static isSafePath(targetPath, projectRoot) {
    const resolvedTarget = path.resolve(projectRoot, targetPath);
    const resolvedRoot = path.resolve(projectRoot);
    return resolvedTarget.startsWith(resolvedRoot);
  }

  static postExecute(output, stderr) {
    if (stderr && stderr.trim().length > 0 && !output) {
      return { success: false, error: stderr };
    }
    return { success: true };
  }
}

module.exports = Verifier;