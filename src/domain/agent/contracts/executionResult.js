/**
 * Resultado estandarizado de una ejecución.
 * Conserva la evidencia necesaria para diagnóstico y recovery.
 */
class ExecutionResult {
  constructor({
    success = false,
    output = null,
    error = null,
    stdout = '',
    stderr = '',
    exitCode = null,
    signal = null,
    errorCode = null,
    durationMs = null,
    filesModified = [],
    filesRead = []
  } = {}) {
    if (typeof success !== 'boolean') {
      throw new Error('[ExecutionResult] success debe ser booleano.');
    }

    this.success = success;
    this.output = output;
    this.error = error ? String(error) : null;
    this.stdout = String(stdout || '');
    this.stderr = String(stderr || '');
    this.exitCode = exitCode === null || exitCode === undefined ? null : Number(exitCode);
    this.signal = signal ? String(signal) : null;
    this.errorCode = errorCode ? String(errorCode) : null;
    this.durationMs = durationMs === null || durationMs === undefined ? null : Number(durationMs);
    this.filesModified = Object.freeze(Array.isArray(filesModified) ? [...filesModified] : []);
    this.filesRead = Object.freeze(Array.isArray(filesRead) ? [...filesRead] : []);

    Object.freeze(this);
  }

  static ok({
    output = null,
    stdout = '',
    stderr = '',
    exitCode = null,
    signal = null,
    errorCode = null,
    durationMs = null,
    filesModified = [],
    filesRead = []
  } = {}) {
    return new ExecutionResult({
      success: true,
      output,
      stdout,
      stderr,
      exitCode,
      signal,
      errorCode,
      durationMs,
      filesModified,
      filesRead
    });
  }

  static fail({
    error = 'Fallo no especificado',
    stdout = '',
    stderr = '',
    exitCode = null,
    signal = null,
    errorCode = null,
    durationMs = null,
    filesModified = [],
    filesRead = []
  } = {}) {
    return new ExecutionResult({
      success: false,
      error,
      stdout,
      stderr,
      exitCode,
      signal,
      errorCode,
      durationMs,
      filesModified,
      filesRead
    });
  }

  toJSON() {
    return {
      success: this.success,
      output: this.output,
      error: this.error,
      stdout: this.stdout,
      stderr: this.stderr,
      exitCode: this.exitCode,
      signal: this.signal,
      errorCode: this.errorCode,
      durationMs: this.durationMs,
      filesModified: [...this.filesModified],
      filesRead: [...this.filesRead]
    };
  }
}

module.exports = ExecutionResult;
