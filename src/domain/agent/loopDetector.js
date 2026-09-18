/**
 * LoopDetector
 * Evalúa determinísticamente si el agente ha entrado en un bucle infinito
 * o en un estado de estancamiento sin progreso (NO_PROGRESS).
 */
class LoopDetector {
  constructor() {
    this.history = [];
    this.snapshots = [];
  }

  /**
   * Registra una acción y el estado actual del runtime para auditar avances.
   * @param {string} actionSignature - Firma de la acción (ej. "write_file:src/app.js").
   * @param {Object} snapshot - { errorCount, evidencePassedCount, filesModifiedCount }
   */
  registerStep(actionSignature, snapshot = {}) {
    this.history.push(actionSignature);
    this.snapshots.push(snapshot);

    // 1. Detección de repetición directa (A-A-A)
    if (this.checkDirectRepetition(3)) {
      return {
        loopDetected: true,
        reason: 'REPEATED_SAME_ACTION',
        details: `La acción '${actionSignature}' se ejecutó 3 veces consecutivas.`
      };
    }

    // 2. Detección de secuencia alternada (A-B-A-B)
    if (this.checkAlternatingSequence(4)) {
      return {
        loopDetected: true,
        reason: 'REPEATED_ALTERNATING_SEQUENCE',
        details: 'Se detectó un patrón de comandos alternados reiterativos (A-B-A-B).'
      };
    }

    // 3. Detección de Falta de Progreso (NO_PROGRESS)
    if (this.checkNoProgress(3)) {
      return {
        loopDetected: true,
        reason: 'NO_PROGRESS',
        details: 'Se realizaron 3 iteraciones modificando código sin lograr que los tests pasen ni reducir los errores.'
      };
    }

    return { loopDetected: false, reason: null, details: null };
  }

  checkDirectRepetition(limit) {
    if (this.history.length < limit) return false;
    const recent = this.history.slice(-limit);
    return recent.every(act => act === recent[0]);
  }

  checkAlternatingSequence(length) {
    if (this.history.length < length) return false;
    const recent = this.history.slice(-length);
    return recent[0] === recent[2] && recent[1] === recent[3] && recent[0] !== recent[1];
  }

  checkNoProgress(threshold) {
    if (this.snapshots.length < threshold) return false;
    const recent = this.snapshots.slice(-threshold);
    const initial = recent[0];
    const latest = recent[recent.length - 1];

    // Se modificaron archivos en el lapso pero no aumentaron las evidencias pasadas ni bajaron los errores
    const hasModifications = recent.some(s => s.filesModifiedCount > 0);
    const noEvidenceImprovement = latest.evidencePassedCount <= initial.evidencePassedCount;
    const noErrorReduction = latest.errorCount >= initial.errorCount;

    return hasModifications && noEvidenceImprovement && noErrorReduction;
  }

  reset() {
    this.history = [];
    this.snapshots = [];
  }
}

module.exports = LoopDetector;