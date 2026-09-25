const {
  executeCommandSchema,
  readFilesSchema,
  searchCodeSchema,
  writeFileSchema,
  taskCompleteSchema
} = require('../../shared/schemas/toolSchemas');

const { spawn } = require('child_process');

const PolicyEngine = require('./policyEngine');
const FileSystemUtils = require('../../shared/utils/fileSystemUtils');
const { searchProject } = require('../../shared/utils/fileScanner');
const ToolDefinition = require('../../domain/agent/models/ToolDefinition');
const ToolExecutionRequest = require('../../domain/agent/models/ToolExecutionRequest');

class ToolRegistry {
  /**
  * @param {Object} [options={}] - Opciones de configuración.
  * @param {PolicyEngine|null} [options.policyEngine=null] - Motor de políticas opcional.
  */
  constructor({ policyEngine = null } = {}) {
    /** 
     * Instancia del motor de políticas activa.
     * @type {PolicyEngine} 
     */
    this.policyEngine = policyEngine;
    /**
 * Mapa que almacena las herramientas registradas.
 *
 * @type {Map<string, ToolDefinition>}
 */
    this.tools = new Map();
    this.registerDefaultTools();
  }

  registerDefaultTools() {
    this.registerTool({
      name: 'execute_command',
      description: 'Ejecuta un comando en la terminal con salida en tiempo real',
      riskLevel: 'LOW',
      schema: executeCommandSchema,
      execute: async (
        args = { command: '' },
        context = {
          projectRoot: '',
          repl: null,
          streamOutput: true
        }
      ) => {
        const command = String(args.command || '');
        const workingDirectory = context.projectRoot || process.cwd();
        const streamOutput = context.streamOutput !== false;

        if (!command.trim()) {
          throw new Error('[EXECUTE_COMMAND] El comando está vacío.');
        }

        console.log('\n     ┌─ [COMMAND START]');
        console.log(`     │ ${command}`);
        console.log(`     │ cwd: ${workingDirectory}`);
        console.log('     └─ [COMMAND OUTPUT]\n');

        return await this._executeCommandLive({
          command,
          workingDirectory,
          streamOutput
        });
      }
    });

    this.registerTool({
      name: 'read_files',
      description: 'Lee uno o varios archivos del proyecto',
      riskLevel: 'LOW',
      schema: readFilesSchema,
      execute: async (
        args = { paths: [] },
        context = { projectRoot: '', repl: null }
      ) => {
        const results = {};
        for (const relPath of args.paths) {
          const content = FileSystemUtils.safeReadFile(context.projectRoot, relPath);
          if (content !== null) {
            results[relPath] = content;
          }
        }
        return results;
      }
    });

    this.registerTool({
      name: 'search_code',
      description: 'Busca texto directamente en archivos del proyecto sin construir ni mantener un índice del repositorio',
      riskLevel: 'LOW',
      schema: searchCodeSchema,
      execute: async (
        args = { query: '' },
        context = { projectRoot: '', repl: null }
      ) => ({
        query: args.query,
        matches: searchProject({
          projectRoot: context.projectRoot,
          query: args.query,
          caseSensitive: false,
          maxMatches: 200
        })
      })
    });

    this.registerTool({
      name: 'write_file',
      description: 'Crea o reemplaza un archivo dentro del proyecto vinculado',
      riskLevel: 'HIGH',
      schema: writeFileSchema,
      execute: async (
        args = { filePath: '', content: '', createDirs: true },
        context = { projectRoot: '', repl: null }
      ) => {
        const absPath = FileSystemUtils.resolveSafePath(context.projectRoot, args.filePath);
        if (args.createDirs) FileSystemUtils.ensureDirForFile(absPath);
        FileSystemUtils.writeFile(absPath, args.content);
        return {
          written: true,
          filePath: args.filePath,
          bytes: Buffer.byteLength(args.content, 'utf8')
        };
      }
    });

    this.registerTool({
      name: 'task_complete',
      description: 'Confirma formalmente la finalización (exitosa o fallida) de la subtarea activa.',
      riskLevel: 'LOW',
      schema: taskCompleteSchema,
      execute: async (
        args = {
          status: 'SUCCESS',
          summary: '',
          reason: ''
        },
        context = { projectRoot: '', repl: null }
      ) => ({
        completed: true,
        status: args.status,
        summary: args.summary,
        reason: args.reason
      })
    });
  }

  /**
   * Ejecuta un comando y transmite stdout/stderr en tiempo real,
   * conservando simultáneamente la salida completa para diagnóstico y recovery.
   */
  _executeCommandLive({
    command = '',
    workingDirectory = process.cwd(),
    streamOutput = true
  } = {}) {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const child = spawn(command, {
        cwd: workingDirectory,
        shell: true,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const appendChunk = (target, chunk) => {
        const text = chunk instanceof Buffer
          ? chunk.toString('utf8')
          : String(chunk || '');

        if (target === 'stdout') {
          stdout += text;
        } else {
          stderr += text;
        }

        if (streamOutput && text) {
          const prefix = target === 'stdout'
            ? '     │ '
            : '     │ [stderr] ';

          process.stdout.write(`${prefix}${text}`);

          if (!text.endsWith('\n')) {
            process.stdout.write('\n');
          }
        }
      };

      child.stdout.on('data', chunk => {
        appendChunk('stdout', chunk);
      });

      child.stderr.on('data', chunk => {
        appendChunk('stderr', chunk);
      });

      child.on('error', error => {
        if (settled) return;
        settled = true;

        const executionError = new Error(
          error.message || `No se pudo iniciar el comando: ${command}`
        );

        executionError.command = command;
        executionError.exitCode = null;
        executionError.signal = null;
        executionError.errorCode = error.code || null;
        executionError.stdout = stdout;
        executionError.stderr = stderr;

        console.error(
          `\n     ❌ [COMMAND START ERROR] ${executionError.message}`
        );

        reject(executionError);
      });

      child.on('close', (exitCode, signal) => {
        if (settled) return;
        settled = true;

        const normalizedStdout = stdout;
        const normalizedStderr = stderr;

        console.log(
          `\n     ${exitCode === 0
            ? '✅'
            : '❌'} [COMMAND FINISHED] exitCode=${exitCode ?? 'null'}${signal ? ` signal=${signal}` : ''}`
        );

        if (exitCode === 0) {
          resolve({
            output: normalizedStdout,
            stdout: normalizedStdout,
            stderr: normalizedStderr,
            exitCode,
            signal
          });
          return;
        }

        const executionError = new Error(
          `El comando terminó con código de salida ${exitCode ?? 'desconocido'}.`
        );

        executionError.command = command;
        executionError.exitCode = exitCode;
        executionError.signal = signal;
        executionError.errorCode = null;
        executionError.stdout = normalizedStdout;
        executionError.stderr = normalizedStderr;

        reject(executionError);
      });
    });
  }

  /**
 * Registra una herramienta en el registry.
 *
 * @param {Object} toolDefinition
 * @param {string} toolDefinition.name
 * @param {string} toolDefinition.description
 * @param {'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'} toolDefinition.riskLevel
 * @param {import('zod').ZodType} toolDefinition.schema
 * @param {ToolDefinition.ToolExecutor} toolDefinition.execute
 * @returns {void}
 */
  registerTool(toolDefinition) {
    const definition = new ToolDefinition(toolDefinition);

    this.tools.set(definition.name, definition);
  }

  /**
 * Obtiene una herramienta registrada por su nombre.
 *
 * @param {string} [name=''] - Nombre de la herramienta.
 * @returns {ToolDefinition} Definición de la herramienta registrada.
 * @throws {Error} Si la herramienta no está registrada.
 */
  getTool(name = '') {
    const tool = this.tools.get(name);

    if (!tool) {
      throw new Error(`Herramienta '${name}' no registrada.`);
    }

    return tool;
  }

  /**
  * Lista las herramientas registradas.
  *
  * @returns {Array<{
  *   name: string,
  *   description: string,
  *   riskLevel: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'
  * }>} Herramientas registradas con su información básica.
  */
  listTools() {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      riskLevel: tool.riskLevel
    }));
  }

  /**
 * Único punto de entrada para ejecutar una herramienta.
 * Aplica validación Zod, evaluación de políticas de seguridad y confirmación interactiva.
 *
 * @param {ToolExecutionRequest} request - Solicitud de ejecución de la herramienta.
 * @returns {Promise<Object>} Resultado de la ejecución.
 */
  async executeTool(request) {
    const { name, args, context } = request;
    const tool = this.getTool(name);
    const parsedArgs = tool.schema.parse(args);
    const policy = this.policyEngine.evaluate(tool);

    if (policy.decision === 'ASK') {
      if (!context.repl) {
        throw new Error(
          `[RESTRICCIÓN DE SEGURIDAD] La herramienta "${name}" requiere confirmación pero no se proporcionó REPL.`
        );
      }

      console.log(
        `\n  ⚠️ [POLÍTICA DE SEGURIDAD] La herramienta "${name}" requiere confirmación [Riesgo: ${policy.riskLevel}].`
      );

      if (parsedArgs.command) {
        console.log(`     Comando: "${parsedArgs.command}"`);
      }

      if (parsedArgs.filePath) {
        console.log(`     Archivo: "${parsedArgs.filePath}"`);
      }

      const answer = await context.repl.askQuestion(
        '  ¿Autorizas esta ejecución? (y/N): '
      );

      if (!['y', 's'].includes(answer.trim().toLowerCase())) {
        throw new Error(
          `[USER_DENIED] El usuario rechazó la ejecución de la herramienta "${name}".`
        );
      }
    } else if (policy.decision === 'DENY') {
      throw new Error(
        `[ACCIÓN BLOQUEADA POR POLÍTICA] ${policy.reason}`
      );
    }

    return await tool.execute(parsedArgs, context);
  }
}

module.exports = ToolRegistry;
