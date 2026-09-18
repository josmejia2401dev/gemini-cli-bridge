/**
 * ErrorAnalyzer
 * Limpia y sanitiza salidas de terminal, extrae firmas de error
 * y determina si un fallo es conocido (con solución en memoria) o inédito.
 */
class ErrorAnalyzer {
  /**
   * Elimina ruido del stacktrace (ruido de node_modules, trazas internas del SO, banderas de formato).
   * @param {string} rawError - Texto crudo del error o stderr.
   * @returns {string} Stacktrace depurado con la información esencial.
   */
  static cleanStackTrace(rawError) {
    if (!rawError || typeof rawError !== 'string') return '';

    return rawError
      .split('\n')
      .filter(line => {
        const lower = line.toLowerCase();
        // Filtrar ruido irrelevante de entorno y librerías de terceros
        if (line.includes('node_modules')) return false;
        if (line.includes('internal/modules/cjs')) return false;
        if (line.includes('node:internal')) return false;
        if (lower.includes('npm err! a complete log of this run can be found in')) return false;
        return line.trim().length > 0;
      })
      .slice(0, 15) // Mantener únicamente las 15 líneas más relevantes del núcleo del error
      .join('\n');
  }

  /**
   * Extrae la firma principal del error (ej. "Error: Cannot find module 'x'").
   * @param {string} cleanedError 
   * @returns {string}
   */
  static extractSignature(cleanedError) {
    const lines = cleanedError.split('\n');
    const mainErrorLine = lines.find(line => 
      line.includes('Error:') || 
      line.includes('EXCEPTION') || 
      line.includes('FAILED') ||
      line.includes('SyntaxError') ||
      line.includes('TypeError')
    );

    return mainErrorLine ? mainErrorLine.trim() : lines[0]?.trim() || 'Unknown Error';
  }

  /**
   * Analiza un error de consola consultando la memoria episódica.
   * @param {string} command - Comando ejecutado.
   * @param {string} rawError - Error original de consola.
   * @param {Object} episodicMemory - Instancia de EpisodicMemory.
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