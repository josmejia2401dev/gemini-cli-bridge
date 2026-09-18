const ErrorAnalyzer = require('./errorAnalyzer');

/**
 * Módulo de reflexión encargado de construir feedback inteligente y reportes RCA.
 */
class Reflector {
  static createFeedback({ command, error, userReason, isRejected, episodicMemory }) {
    if (isRejected) {
      if (userReason) {
        return `[SISTEMA: El usuario denegó el comando '${command}'. Motivo: "${userReason}". Reajusta tu estrategia sin repetir este comando.]`;
      }
      return `[SISTEMA: El usuario denegó la ejecución del comando '${command}'. Bucle autónomo pausado.]`;
    }

    if (error) {
      const analysis = ErrorAnalyzer.analyze(command, error, episodicMemory);

      if (analysis.isKnown) {
        return `[SISTEMA - SOLUCIÓN EN MEMORIA ENCONTRADA]:
El fallo en '${command}' es un ERROR CONOCIDO registrado previamente.
Firma: "${analysis.signature}"
Solución histórica aplicada: "${analysis.solution}"`;
      }

      return `[SISTEMA - ANÁLISIS DE CAUSA RAÍZ (RCA)]:
Falló la ejecución del comando '${command}'.
Firma del Error: "${analysis.signature}"

STACKTRACE DEPURADO:
${analysis.cleanedError}

INSTRUCCIÓN: Analiza la causa raíz de este error inédito y propone la corrección en tu siguiente respuesta.`;
    }

    return null;
  }
}

module.exports = Reflector;