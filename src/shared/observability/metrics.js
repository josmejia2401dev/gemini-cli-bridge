/**
 * MetricsCollector
 * Agregador determinístico de métricas de rendimiento, latencias y tasa de éxito.
 */
class MetricsCollector {
  constructor() {
    this.reset();
  }

  reset() {
    this.metrics = {
      totalToolCalls: 0,
      successfulToolCalls: 0,
      failedToolCalls: 0,
      llmCalls: 0,
      totalLlmLatencyMs: 0,
      loopRecoveries: 0,
      toolLatencies: []
    };
  }

  recordToolCall(toolName, durationMs, success) {
    this.metrics.totalToolCalls++;
    if (success) {
      this.metrics.successfulToolCalls++;
    } else {
      this.metrics.failedToolCalls++;
    }
    this.metrics.toolLatencies.push({ toolName, durationMs, success });
  }

  recordLlmCall(durationMs) {
    this.metrics.llmCalls++;
    this.metrics.totalLlmLatencyMs += durationMs;
  }

  recordLoopRecovery() {
    this.metrics.loopRecoveries++;
  }

  getSummary() {
    const avgToolLatency = this.metrics.toolLatencies.length > 0
      ? Math.round(this.metrics.toolLatencies.reduce((acc, l) => acc + l.durationMs, 0) / this.metrics.toolLatencies.length)
      : 0;

    const avgLlmLatency = this.metrics.llmCalls > 0
      ? Math.round(this.metrics.totalLlmLatencyMs / this.metrics.llmCalls)
      : 0;

    const toolSuccessRate = this.metrics.totalToolCalls > 0
      ? ((this.metrics.successfulToolCalls / this.metrics.totalToolCalls) * 100).toFixed(1)
      : '100.0';

    return {
      totalToolCalls: this.metrics.totalToolCalls,
      successfulToolCalls: this.metrics.successfulToolCalls,
      failedToolCalls: this.metrics.failedToolCalls,
      toolSuccessRate: `${toolSuccessRate}%`,
      avgToolLatencyMs: avgToolLatency,
      llmCalls: this.metrics.llmCalls,
      avgLlmLatencyMs: avgLlmLatency,
      loopRecoveries: this.metrics.loopRecoveries
    };
  }
}

module.exports = MetricsCollector;