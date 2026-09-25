/**
 * Contrato estandarizado para los resultados devueltos por el subflujo de ejecución.
 */
class ExecutionResult {
  constructor({
    success = false,
    output = null,
    error = null,
    stdout = '',
    stderr = '',
    filesModified = [],
    filesRead = []
  } = {}) {
    if (typeof success !== 'boolean') {
      throw new Error('[ExecutionResult] El parámetro "success" debe ser booleano.');
    }

    this.success = success;
    this.output = output;
    this.error = error ? String(error) : null;
    this.stdout = String(stdout || '');
    this.stderr = String(stderr || '');
    this.filesModified = Object.freeze([...(Array.isArray(filesModified) ? filesModified : [])]);
    this.filesRead = Object.freeze([...(Array.isArray(filesRead) ? filesRead : [])]);

    Object.freeze(this);
  }

  static ok({
    output = null,
    filesModified = [],
    filesRead = []
  } = {}) {
    return new ExecutionResult({
      success: true,
      output,
      filesModified,
      filesRead
    });
  }

  static fail({
    error = 'Fallo no especificado',
    stdout = '',
    stderr = ''
  } = {}) {
    return new ExecutionResult({
      success: false,
      error,
      stdout,
      stderr
    });
  }

  toJSON() {
    return {
      success: this.success,
      output: this.output,
      error: this.error,
      stdout: this.stdout,
      stderr: this.stderr,
      filesModified: [...this.filesModified],
      filesRead: [...this.filesRead]
    };
  }
}

module.exports = ExecutionResult;
