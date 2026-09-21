class PolicyEngine {
  /**
   * Evalúa si una herramienta requiere autorización interactiva del usuario.
   */
  async evaluateAndConfirm({ toolName, args, toolDef, repl }) {
    const riskLevel = toolDef?.riskLevel || 'LOW';

    // Si el riesgo es HIGH o CRITICAL, pedimos confirmación explícita
    if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') {
      console.log(`\n  ⚠️ [POLÍTICA DE SEGURIDAD] La herramienta "${toolName}" tiene riesgo [${riskLevel}].`);
      
      if (args.command) console.log(`     Comando a ejecutar: "${args.command}"`);
      if (args.filePath) console.log(`     Archivo a modificar: "${args.filePath}"`);

      const answer = await repl.askQuestion('  ¿Autorizas esta ejecución? (y/N): ');

      if (answer.trim().toLowerCase() !== 'y' && answer.trim().toLowerCase() !== 's') {
        return {
          allowed: false,
          reason: `El usuario rechazó la ejecución de la herramienta "${toolName}" por motivos de seguridad.`
        };
      }
    }

    return { allowed: true };
  }
}

module.exports = PolicyEngine;