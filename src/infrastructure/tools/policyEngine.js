/**
 * PolicyEngine
 * Evalúa el nivel de riesgo de la ejecución de una herramienta.
 * Componente puro sin dependencias directas de I/O (REPL).
 */
class PolicyEngine {
  /**
   * Evalúa la política de seguridad para una herramienta y sus argumentos.
   * @param {Object} params - { toolName, args, toolDef }
   * @returns {{ decision: 'ALLOW' | 'ASK' | 'DENY', riskLevel: string, reason: string }}
   */
  evaluate({ toolName, args, toolDef }) {
    const riskLevel = toolDef?.riskLevel || 'LOW';

    if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') {
      return {
        decision: 'ASK',
        riskLevel,
        reason: `La herramienta "${toolName}" requiere autorización interactiva por tener un nivel de riesgo [${riskLevel}].`
      };
    }

    return {
      decision: 'ALLOW',
      riskLevel,
      reason: 'Ejecución autorizada automáticamente.'
    };
  }
}

module.exports = PolicyEngine;