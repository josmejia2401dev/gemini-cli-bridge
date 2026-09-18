/**
 * Motor de políticas de seguridad. Clasifica el riesgo de las herramientas 
 * y determina si requieren confirmación previa del usuario.
 */
class PolicyEngine {
  constructor() {
    this.riskMap = {
      read_file: 'LOW',
      list_files: 'LOW',
      search_code: 'LOW',
      write_file: 'MEDIUM',
      move_file: 'MEDIUM',
      delete_file: 'HIGH',
      execute_command: 'HIGH'
    };
  }

  getRiskLevel(toolName, args = {}) {
    if (toolName === 'execute_command') {
      const cmd = (args.command || '').trim().toLowerCase();
      // Comandos seguros de consulta rápida
      if (cmd.startsWith('npm test') || cmd.startsWith('git status') || cmd.startsWith('node -v')) {
        return 'LOW';
      }
      return 'HIGH';
    }
    return this.riskMap[toolName] || 'MEDIUM';
  }

  requiresApproval(toolName, args = {}) {
    const risk = this.getRiskLevel(toolName, args);
    return risk === 'HIGH' || risk === 'MEDIUM';
  }
}

module.exports = PolicyEngine;