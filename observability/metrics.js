/**
 * Medidor de rendimiento, latencias y tasa de éxito del agente.
 */
class MetricsCollector {
  constructor() {
    this.metrics = {
      totalToolCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      latencies: []
    };
  }

  recordToolCall(toolName, durationMs, success) {
    this.metrics.totalToolCalls++;
    if (success) {
      this.metrics.successfulCalls++;
    } else {
      this.metrics.failedCalls++;
    }
    this.metrics.latencies.push({ toolName, durationMs, success });
  }

  getSummary() {
    const avgLatency = this.metrics.latencies.length > 0
      ? (this.metrics.latencies.reduce((acc, l) => acc + l.durationMs, 0) / this.metrics.latencies.length).toFixed(2)
      : 0;

    return {
      totalToolCalls: this.metrics.totalToolCalls,
      successfulCalls: this.metrics.successfulCalls,
      failedCalls: this.metrics.failedCalls,
      averageLatencyMs: avgLatency
    };
  }
}

module.exports = MetricsCollector;