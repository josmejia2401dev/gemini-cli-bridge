const vm = require('vm');

class OutputParser {
  /**
   * Extrae, limpia y evalúa un objeto JS multilínea a partir del texto crudo.
   * @param {string} rawText - Texto crudo generado por el LLM.
   * @returns {Object} Resultado del parseo con la estructura { success, data, error }.
   */
  static parseToolCall(rawText) {
    try {
      const text = rawText.trim();
      let jsCandidate = '';

      // 1. Extraemos desde la primera llave '{' hasta la última '}'
      // Ignora cualquier saludo inicial o explicación final.
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');

      if (firstBrace !== -1 && lastBrace > firstBrace) {
        jsCandidate = text.substring(firstBrace, lastBrace + 1).trim();
      } else {
        jsCandidate = text;
      }

      // 2. LIMPIEZA DE MARKDOWN (Escudo Purificador)
      // Elimina triples comillas huérfanas o bloques de código rotos inyectados por la IA.
      jsCandidate = jsCandidate.replace(/```[a-zA-Z0-9_-]*/g, '');

      // 3. EVALUACIÓN AISLADA
      const parsedObject = vm.runInNewContext(`(${jsCandidate})`);

      // 4. VALIDACIÓN ESTRUCTURAL BÁSICA
      if (parsedObject && typeof parsedObject === 'object' && parsedObject.tool) {
        return { success: true, data: parsedObject };
      } else {
        return { 
          success: false, 
          error: "El objeto se evaluó correctamente pero no contiene la propiedad obligatoria 'tool'." 
        };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

module.exports = OutputParser;