/**
 * ErrorAnalyzer
 * Limpia y sanitiza salidas de terminal, extrae firmas de error
 * y determina si un fallo es conocido (con solución en memoria) o inédito.
 */
class ErrorAnalyzer {
  /**
   * Elimina ruido del stacktrace (ruido de SO, banderas de formato).
   */
  static cleanStackTrace(rawError) {
    if (!rawError || typeof rawError !== 'string') return '';
    
    return rawError
      .split('\n')
      .filter(line => {
        const lower = line.toLowerCase();
        // Filtrar ruido irrelevante estricto
        if (line.includes('internal/modules/cjs')) return false;
        if (line.includes('node:internal')) return false;
        if (lower.includes('npm err! a complete log of this run can be found in')) return false;
        return line.trim().length > 0;
      })
      .slice(0, 40) // Aumentamos a 40 líneas para abarcar bien los logs completos de Maven/Spring
      .join('\n');
  }

  /**
   * Extrae la firma principal del error.
   */
  static extractSignature(cleanedError) {
    const lines = cleanedError.split('\n');
    const mainErrorLine = lines.find(line => 
       line.includes('Error:') || 
       line.includes('EXCEPTION') || 
       line.includes('FAILED') ||
       line.includes('[ERROR]') ||
       line.includes('SyntaxError') ||
       line.includes('TypeError')
    );
    return mainErrorLine ? mainErrorLine.trim() : lines[0]?.trim() || 'Unknown Error';
  }

  /**
   * Analiza un error de consola consultando la memoria episódica.
   */
  static analyze(command, rawError, episodicMemory) {
    const cleanedError = this.cleanStackTrace(rawError);
    const signature = this.extractSignature(cleanedError);
    let knownSolution = null;

    if (episodicMemory && typeof episodicMemory.findKnownSolution === 'function') {
      knownSolution = episodicMemory.findKnownSolution(signature, command);
    }

    if (knownSolution) {
      return {
        isKnown: true,
        signature,
        cleanedError,
        solution: knownSolution
      };
    }

    return {
      isKnown: false,
      signature,
      cleanedError,
      solution: null
    };
  }
}

module.exports = ErrorAnalyzer;