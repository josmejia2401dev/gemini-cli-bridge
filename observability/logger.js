const fs = require('fs');
const crypto = require('crypto');
const paths = require('../config/paths');

/**
 * Logger estructurado para auditoría y trazabilidad.
 * Genera un executionId único por cada tarea y registra trazas en disco.
 */
class ExecutionLogger {
  constructor(logFilePath = null) {
    this.logFilePath = logFilePath || paths.LOG_FILE;
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
}

module.exports = ExecutionLogger;