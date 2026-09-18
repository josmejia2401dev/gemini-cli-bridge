const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const paths = require('../config/paths');

/**
 * Logger estructurado para auditoría, trazabilidad y recopilación de dataset.
 */
class ExecutionLogger {
  constructor(logFilePath = null) {
    this.logFilePath = logFilePath || paths.LOG_FILE;
    this.datasetFilePath = path.join(paths.DATA_DIR, 'dataset.jsonl');
    this.currentExecutionId = null;
  }

  startExecution() {
    this.currentExecutionId = crypto.randomUUID().substring(0, 8);
    this.info(`[START_EXECUTION] ID: ${this.currentExecutionId}`);
    return this.currentExecutionId;
  }

  info(message, meta = {}) {
    this.writeLog('INFO', message, meta);
  }

  warn(message, meta = {}) {
    this.writeLog('WARN', message, meta);
  }

  error(message, meta = {}) {
    this.writeLog('ERROR', message, meta);
  }

  writeLog(level, message, meta) {
    const timestamp = new Date().toISOString();
    const execId = this.currentExecutionId || 'system';
    const logEntry = JSON.stringify({
      timestamp,
      execId,
      level,
      message,
      meta
    });

    try {
      fs.appendFileSync(this.logFilePath, logEntry + '\n', 'utf-8');
    } catch (e) {
      console.error('Error escribiendo en log:', e.message);
    }
  }

  /**
   * ⚡ BUCLE DE APRENDIZAJE: Guarda trazas limpias de ejecuciones exitosas
   * para estructurar conjuntos de datos de Fine-Tuning futuro.
   */
  saveDatasetTrace(state, tracerSummary) {
    if (!state || state.status !== 'SUCCESS') return;

    const traceEntry = JSON.stringify({
      runId: state.runId,
      objective: state.objective,
      iterations: state.iterations,
      dagSteps: state.dag ? state.dag.toJSON() : [],
      toolCalls: state.toolCalls,
      filesModified: state.filesModified,
      evidences: state.evidence,
      metricsSummary: tracerSummary,
      timestamp: new Date().toISOString()
    });

    try {
      fs.appendFileSync(this.datasetFilePath, traceEntry + '\n', 'utf-8');
      console.log(`  📦 [DATASET APRENDIZAJE] Traza limpia registrada en '${path.basename(this.datasetFilePath)}'`);
    } catch (e) {
      console.error('Error guardando traza en dataset:', e.message);
    }
  }
}

module.exports = ExecutionLogger;