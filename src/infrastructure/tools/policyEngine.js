const ToolDefinition = require("../../domain/agent/models/ToolDefinition");

/**
 * PolicyEngine
 * Evalúa el nivel de riesgo de la ejecución de una herramienta.
 * Componente puro sin dependencias directas de I/O (REPL).
 */
class PolicyEngine {
  /**
   * Evalúa la política de seguridad para una herramienta.
   *
   * @param {Object} params
   * @param {ToolDefinition} params.toolDef
   * @returns {{
   *   decision: 'ALLOW' | 'ASK' | 'DENY',
   *   riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
   *   reason: string
   * }}
   */
  evaluate({ toolDef }) {
    const { name, riskLevel } = toolDef;

    if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') {
      return {
        decision: 'ASK',
        riskLevel,
        reason: `La herramienta "${name}" requiere autorización interactiva por tener un nivel de riesgo [${riskLevel}].`
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