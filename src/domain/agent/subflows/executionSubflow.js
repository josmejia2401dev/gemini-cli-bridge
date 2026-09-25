const ExecutionTask = require('../contracts/executionTask');
const ExecutionResult = require('../contracts/executionResult');
const Verifier = require('../verifier');

/**
 * Subflujo de Ejecución.
 * Centraliza la ejecución de herramientas del sistema de forma segura, determinística 
 * y con validaciones (Pre-Execution y Post-Execution).
 */
class ExecutionSubflow {
  /**
   * @param {Object} dependencies - Dependencias inyectadas.
   * @param {Object} dependencies.toolRegistry - Registro de herramientas (`ToolRegistry`).
   * @param {string} dependencies.projectRoot - Ruta raíz absoluta del proyecto.
   * @param {Object} [dependencies.repl=null] - Instancia de REPL para interacciones de consola (Opcional).
   * @param {Object} [dependencies.verifier=Verifier] - Motor de validación estática de código y comandos.
   */
  constructor({ toolRegistry = null, projectRoot = '', repl = null, verifier = Verifier } = {}) {
    if (!toolRegistry) throw new Error('[ExecutionSubflow] toolRegistry es obligatorio.');
    if (!projectRoot) throw new Error('[ExecutionSubflow] projectRoot es obligatorio.');

    this.toolRegistry = toolRegistry;
    this.projectRoot = projectRoot;
    this.repl = repl;
    this.verifier = verifier;
  }

  /**
   * Ejecuta una tarea estructurada de forma aislada.
   * 
   * @param {ExecutionTask} task - Contrato de tarea con la herramienta y argumentos a ejecutar.
   * @returns {Promise<ExecutionResult>} Contrato de resultado con el éxito o fallo de la operación.
   */
  async execute(task = null) {
    if (!(task instanceof ExecutionTask)) {
      return ExecutionResult.fail({ error: 'La entrada no es una instancia válida de ExecutionTask.' });
    }

    if (!task.hasExplicitTool()) {
      return ExecutionResult.fail({ 
        error: 'La tarea no define una herramienta ejecutable explícita.',
        stdout: `Tarea: ${task.description}`
      });
    }

    const { tool, args } = task;

    try {
      // 1. Validaciones Pre-Ejecución (Ej: Comandos destructivos)
      if (tool === 'execute_command') {
        const preCheck = this.verifier.preExecuteCommand(args.command || '');
        if (!preCheck.valid) {
          return ExecutionResult.fail({ error: `Bloqueado por validación de seguridad previa: ${preCheck.reason}` });
        }
      }

      // 2. Ejecución física de la herramienta
      const toolOutput = await this.toolRegistry.executeTool(tool, args, {
        projectRoot: this.projectRoot,
        repl: this.repl
      });

      // 3. Extracción de metadatos (Archivos afectados)
      const filesModified = [];
      const filesRead = [];
      
      if (tool === 'write_file' && args.filePath) {
        filesModified.push(args.filePath);
      } else if (tool === 'read_files' && Array.isArray(args.paths)) {
        filesRead.push(...args.paths);
      }

      // 4. Validaciones Post-Ejecución (Ej: Verificación de sintaxis de código escrito)
      if (filesModified.length > 0) {
        const postCheck = this.verifier.verifyModifiedFiles({ projectRoot: this.projectRoot, filesModified });
        if (!postCheck.valid) {
          return ExecutionResult.fail({ error: `La verificación de sintaxis post-escritura falló: ${postCheck.reason}` });
        }
      }

      // 5. Retorno Exitoso
      return ExecutionResult.ok({
        output: toolOutput,
        filesModified,
        filesRead
      });

    } catch (err) {
      // Manejo de rechazos de usuario explícitos
      if (err.message && err.message.includes('[USER_DENIED]')) {
        return ExecutionResult.fail({ error: 'ACCIÓN CANCELADA: El usuario denegó la ejecución de la herramienta.' });
      }

      // Empaquetado estandarizado del error de sistema
      return ExecutionResult.fail({
        error: err.message || String(err),
        stdout: err.stdout ? err.stdout.toString().trim() : '',
        stderr: err.stderr ? err.stderr.toString().trim() : ''
      });
    }
  }
}

module.exports = ExecutionSubflow;