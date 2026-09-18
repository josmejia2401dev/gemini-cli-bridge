/**
 * ExecutionDecisionEngine
 * Clasifica cada acción para decidir si se resuelve localmente en Node.js (DETERMINISTIC)
 * o si requiere análisis/generación por Gemini (LLM_REQUIRED).
 */
class ExecutionDecisionEngine {
  constructor() {
    this.deterministicPatterns = [
      // 🎯 ESTADO DEL REPOSITORIO (Captura variaciones de lenguaje natural)
      {
        regex: /(?:estado\s+del\s+(?:repo|repositorio|proyecto)|git\s+status|consulta\s+(?:el\s+)?estado)/i,
        tool: 'execute_command',
        extractArgs: () => ({ command: 'git status' })
      },
      {
        regex: /^ejecuta\s+(.+)$/i,
        tool: 'execute_command',
        extractArgs: (m) => ({ command: m[1].trim() })
      },
      {
        regex: /^corr[ee]\s+(.+)$/i,
        tool: 'execute_command',
        extractArgs: (m) => ({ command: m[1].trim() })
      },
      {
        regex: /^busca\s+(?:símbolo|codigo|código|texto|palabra)?\s*(.+)$/i,
        tool: 'search_code',
        extractArgs: (m) => ({ query: m[1].trim() })
      },
      {
        regex: /^lee\s+(?:el\s+archivo\s+)?(.+)$/i,
        tool: 'read_files',
        extractArgs: (m) => ({ paths: [m[1].trim()] })
      },
      {
        regex: /^qui[ée]n\s+importa\s+(.+)$/i,
        tool: 'who_imports',
        extractArgs: (m) => ({ target: m[1].trim() })
      },
      {
        regex: /^dependencias\s+de\s+(.+)$/i,
        tool: 'get_dependencies',
        extractArgs: (m) => ({ filePath: m[1].trim() })
      },
      {
        regex: /^d[óo]nde\s+se\s+(?:define|ubica|encuentra)\s+(.+)$/i,
        tool: 'find_symbol',
        extractArgs: (m) => ({ symbol: m[1].trim() })
      },
      {
        regex: /^analiza\s+(?:el\s+)?impacto\s+de\s+(.+)$/i,
        tool: 'analyze_impact',
        extractArgs: (m) => ({ filePath: m[1].trim() })
      }
    ];

    this.directCliPrefixes = /^(npm\s+|mvn\s+|gradlew?\s+|git\s+|node\s+|python\s+|docker\s+|cargo\s+|go\s+)/i;
  }

  /**
   * Clasifica la instrucción recibida.
   * @param {string} instruction
   * @returns {Object} { mode: 'DETERMINISTIC' | 'LLM_REQUIRED' | 'HYBRID', tool?, args? }
   */
  classify(instruction) {
    if (!instruction || typeof instruction !== 'string') {
      return { mode: 'LLM_REQUIRED' };
    }

    const trimmed = instruction.trim();

    // 1. Sanitización de muletillas y conectores en español
    const cleaned = trimmed
      .replace(/^(por favor|perfecto|podrías|puedes|vuelve a|nuevamente|intenta|modo|gracias|validar|valida|consulta)[,\s]*/gui, '')
      .trim();

    // 2. Evaluación contra patrones determinísticos (evalúa texto crudo y limpio)
    for (const pattern of this.deterministicPatterns) {
      const match = trimmed.match(pattern.regex) || cleaned.match(pattern.regex);
      if (match) {
        return {
          mode: 'DETERMINISTIC',
          tool: pattern.tool,
          args: pattern.extractArgs(match)
        };
      }
    }

    // 3. Prefijos CLI directos
    if (this.directCliPrefixes.test(cleaned) || this.directCliPrefixes.test(trimmed)) {
      return {
        mode: 'DETERMINISTIC',
        tool: 'execute_command',
        args: { command: cleaned }
      };
    }

    return { mode: 'LLM_REQUIRED' };
  }
}

module.exports = ExecutionDecisionEngine;