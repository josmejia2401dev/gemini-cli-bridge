const {
  executeCommandSchema,
  readFilesSchema,
  searchCodeSchema,
  writeFileSchema,
  taskCompleteSchema
} = require('../../shared/schemas/toolSchemas');
const { execSync } = require('child_process');
const PolicyEngine = require('./policyEngine');
const FileSystemUtils = require('../../shared/utils/fileSystemUtils');
const { searchProject } = require('../../shared/utils/fileScanner');

class ToolRegistry {
  constructor({ policyEngine = null } = {}) {
    this.tools = new Map();
    this.policyEngine = policyEngine || new PolicyEngine();
    this.registerDefaultTools();
  }


  registerDefaultTools() {
    this.registerTool({
      name: 'execute_command',
      description: 'Ejecuta un comando en la terminal',
      riskLevel: 'LOW',
      schema: executeCommandSchema,
      execute: async (args = { command: '' }, context = { projectRoot: '', repl: null }) => {
        try {
          const output = execSync(args.command || '', { cwd: context.projectRoot, encoding: 'utf-8', stdio: 'pipe' });
          return { output };
        } catch (err) {
          let fullError = err.message;
          if (err.stdout && err.stdout.toString().trim()) {
            fullError += `\n[STDOUT]:\n${err.stdout.toString().trim()}`;
          }
          if (err.stderr && err.stderr.toString().trim()) {
            fullError += `\n[STDERR]:\n${err.stderr.toString().trim()}`;
          }
          throw new Error(fullError);
        }
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
        matches: searchProject({ projectRoot: context.projectRoot, query: args.query, caseSensitive: false, maxMatches: 200 })
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
        return { written: true, filePath: args.filePath, bytes: Buffer.byteLength(args.content, 'utf8') };
      }
    });

    this.registerTool({
      name: 'task_complete',
      description: 'Confirma formalmente la finalización (exitosa o fallida) de la subtarea activa.',
      riskLevel: 'LOW',
      schema: taskCompleteSchema,
      execute: async (args = { status: 'SUCCESS', summary: '', reason: '' }, context = { projectRoot: '', repl: null }) => {
        return {
          completed: true,
          status: args.status,
          summary: args.summary,
          reason: args.reason
        };
      }
    });
  }

  registerTool({
    name = '',
    description = '',
    riskLevel = 'LOW',
    schema = null,
    execute = async (args = {}, context = {}) => null
  } = {}) {
    this.tools.set(name, { name, description, riskLevel, schema, execute });
  }

  getTool(name = '') {
    return this.tools.get(name);
  }

  listTools() {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      riskLevel: t.riskLevel
    }));
  }

  /**
   * Único punto de entrada para ejecutar una herramienta.
   * Aplica validación Zod, evaluación de políticas de seguridad y confirmación interactiva.
   */
  async executeTool(
    name = '',
    args = { path: '', filePath: '', content: '', command: '', query: '', target: '', symbol: '', paths: [], createDirs: true, status: 'SUCCESS', summary: '', reason: '', task_id: '' },
    context = { projectRoot: '', repl: null }
  ) {
    const tool = this.getTool(name);
    if (!tool) {
      throw new Error(`Herramienta '${name}' no registrada.`);
    }

    // 1. VALIDACIÓN ESTRUCTURAL DE ARGUMENTOS CON ZOD
    const parsedArgs = tool.schema.parse(args);

    // 2. EVALUACIÓN DE POLÍTICAS DE SEGURIDAD
    const policy = this.policyEngine.evaluate({
      toolName: name,
      args: parsedArgs,
      toolDef: tool
    });

    // 3. INTERVENCIÓN INTERACTIVA HUMAN-IN-THE-LOOP (SI SE REQUIERE CONFIRMACIÓN)
    if (policy.decision === 'ASK') {
      if (!context.repl) {
        throw new Error(`[RESTRICCIÓN DE SEGURIDAD] La herramienta "${name}" requiere confirmación pero no se proporcionó REPL.`);
      }

      console.log(`\n  ⚠️ [POLÍTICA DE SEGURIDAD] La herramienta "${name}" requiere confirmación [Riesgo: ${policy.riskLevel}].`);
      if (parsedArgs.command) console.log(`     Comando: "${parsedArgs.command}"`);
      if (parsedArgs.filePath) console.log(`     Archivo: "${parsedArgs.filePath}"`);

      const answer = await context.repl.askQuestion('  ¿Autorizas esta ejecución? (y/N): ');

      if (!['y', 's'].includes(answer.trim().toLowerCase())) {
        // Lanzamos una marca explícita para que AgentRuntime la identifique fácilmente
        throw new Error(`[USER_DENIED] El usuario rechazó la ejecución de la herramienta "${name}".`);
      }
    } else if (policy.decision === 'DENY') {
      throw new Error(`[ACCIÓN BLOQUEADA POR POLÍTICA] ${policy.reason}`);
    }

    // 4. EJECUCIÓN DIRECTA DE LA HERRAMIENTA
    return await tool.execute(parsedArgs, context);
  }
}

module.exports = ToolRegistry;
