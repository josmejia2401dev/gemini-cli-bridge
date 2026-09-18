/**
 * Tracer
 * Módulo de telemetría determinístico para medir intervalos de tiempo (spans)
 * de cada componente del agente (LLM, herramientas, evidencias, replanning).
 */
class Tracer {
  constructor() {
    this.spans = [];
    this.activeSpans = new Map();
  }

  /**
   * Inicia la medición de un span de telemetría.
   * @param {string} component - Nombre del componente (ej. 'LLM_GENERATE', 'ATOMIC_WRITE', 'EVIDENCE_CHECK').
   * @param {Object} metadata - Información adicional del contexto.
   * @returns {string} ID único del span.
   */
  startSpan(component, metadata = {}) {
    const spanId = `${component}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const span = {
      spanId,
      component,
      startTime: Date.now(),
      metadata
    };
    this.activeSpans.set(spanId, span);
    return spanId;
  }

  /**
   * Finaliza la medición de un span y registra su duración exacta.
   * @param {string} spanId - Identificador del span iniciado.
   * @param {Object} extraMetadata - Metadatos adicionales de cierre.
   * @returns {Object|null}
   */
  endSpan(spanId, extraMetadata = {}) {
    const span = this.activeSpans.get(spanId);
    if (!span) return null;

    const durationMs = Date.now() - span.startTime;
    const completedSpan = {
      ...span,
      durationMs,
      metadata: { ...span.metadata, ...extraMetadata },
      endTime: Date.now()
    };

    this.spans.push(completedSpan);
    this.activeSpans.delete(spanId);
    return completedSpan;
  }

  /**
   * Obtiene el resumen de latencias agregadas por componente.
   */
  getSummary() {
    const summary = {};
    for (const span of this.spans) {
      if (!summary[span.component]) {
        summary[span.component] = { count: 0, totalDurationMs: 0, avgDurationMs: 0 };
      }
      summary[span.component].count++;
      summary[span.component].totalDurationMs += span.durationMs;
    }

    for (const comp in summary) {
      summary[comp].avgDurationMs = Math.round(summary[comp].totalDurationMs / summary[comp].count);
    }

    return {
      totalSpans: this.spans.length,
      byComponent: summary,
      spans: this.spans
    };
  }

  reset() {
    this.spans = [];
    this.activeSpans.clear();
  }
}

module.exports = Tracer;