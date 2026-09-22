const ErrorAnalyzer = require('./errorAnalyzer');
const SYSTEM_PROMPTS = require('../../shared/config/prompts');

class Reflector {
  static createFeedback({ command, error, userReason, isRejected, episodicMemory }) {
    if (isRejected) {
      return SYSTEM_PROMPTS.REFLECTOR_FEEDBACK(command, userReason || "Acción cancelada por política de usuario");
    }

    if (error) {
      const analysis = ErrorAnalyzer.analyze(command, error, episodicMemory);

      if (analysis.isKnown) {
        return SYSTEM_PROMPTS.REFLECTOR_KNOWN_ERROR(command, analysis.signature, analysis.solution);
      }

      return SYSTEM_PROMPTS.REFLECTOR_RCA(command, analysis.signature, analysis.cleanedError);
    }

    return null;
  }
}

module.exports = Reflector;