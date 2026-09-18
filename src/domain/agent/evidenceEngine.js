const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * EvidenceEngine
 * Audita determinísticamente evidencias objetivas (file_exists, command_pass, http_check)
 * para impedir falsos positivos en la finalización de tareas.
 */
class EvidenceEngine {
  /**
   * Evalúa una evidencia individual.
   * @param {string} projectRoot - Ruta raíz del proyecto.
   * @param {Object} item - Objeto de evidencia { type, target, method?, expectedStatus? }.
   */
  static async evaluateItem(projectRoot, item) {
    const { type, target } = item;

    switch (type) {
      case 'file_exists': {
        const absPath = path.resolve(projectRoot, target);
        const exists = fs.existsSync(absPath);
        return {
          type,
          target,
          passed: exists,
          details: exists ? `Archivo confirmado en disco: ${target}` : `Archivo NO encontrado en disco: ${target}`
        };
      }

      case 'command_pass': {
        try {
          const output = execSync(target, { cwd: projectRoot, encoding: 'utf-8', stdio: 'pipe' });
          return {
            type,
            target,
            passed: true,
            details: `Comando completado exitosamente (Código 0). Salida: ${output.trim().substring(0, 200)}`
          };
        } catch (err) {
          const errorMsg = err.stderr ? err.stderr.toString().trim() : err.message;
          return {
            type,
            target,
            passed: false,
            details: `Comando falló. Error: ${errorMsg.substring(0, 300)}`
          };
        }
      }

      case 'http_check': {
        try {
          const expectedStatus = item.expectedStatus || 200;
          const method = item.method || 'GET';
          const response = await fetch(target, { method, signal: AbortSignal.timeout(5000) });
          const passed = response.status === expectedStatus;
          return {
            type,
            target,
            passed,
            details: passed
              ? `Respuesta HTTP ${response.status} OK (Esperado: ${expectedStatus})`
              : `Se recibió HTTP ${response.status}, pero se esperaba ${expectedStatus}`
          };
        } catch (err) {
          return {
            type,
            target,
            passed: false,
            details: `Fallo de solicitud HTTP: ${err.message}`
          };
        }
      }

      default:
        return {
          type,
          target,
          passed: false,
          details: `Tipo de evidencia no soportado: '${type}'`
        };
    }
  }

  /**
   * Evalúa una lista completa de evidencias.
   * @param {string} projectRoot
   * @param {Array} evidenceList
   */
  static async verifyAll(projectRoot, evidenceList = []) {
    if (!Array.isArray(evidenceList) || evidenceList.length === 0) {
      return { success: true, total: 0, passedCount: 0, results: [], failures: [] };
    }

    const results = [];
    for (const item of evidenceList) {
      const res = await EvidenceEngine.evaluateItem(projectRoot, item);
      results.push(res);
    }

    const failures = results.filter(r => !r.passed);
    const success = failures.length === 0;

    return {
      success,
      total: results.length,
      passedCount: results.length - failures.length,
      results,
      failures
    };
  }
}

module.exports = EvidenceEngine;