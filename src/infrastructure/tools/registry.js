const {
  executeCommandSchema,
  readFilesSchema,
  searchCodeSchema,
  whoImportsSchema,
  getDependenciesSchema,
  findSymbolSchema,
  analyzeImpactSchema,
  taskCompleteSchema
} = require('../../shared/schemas/toolSchemas');
const { execSync } = require('child_process');
const PolicyEngine = require('./policyEngine');
const RepositoryIndexer = require('../../domain/context/indexer');
const RepositoryIntelligence = require('../../domain/context/repositoryIntel');
const ImpactAnalysis = require('../../domain/context/impactAnalysis');
const FileSystemUtils = require('../../shared/utils/fileSystemUtils');

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.intelCache = new Map();
    this.policyEngine = new PolicyEngine();
    this.registerDefaultTools();
  }

  getSharedIntel(projectRoot) {
    if (!this.intelCache.has(projectRoot)) {
      this.intelCache.set(projectRoot, new RepositoryIntelligence(projectRoot));
    }
    return this.intelCache.get(projectRoot);
  }

  registerDefaultTools() {
    this.registerTool({
      name: 'execute_command',
      description: 'Ejecuta un comando en la terminal',
      riskLevel: 'LOW',
      schema: executeCommandSchema,
      execute: async (args, context) => {
        try {
          const output = execSync(args.command, { cwd: context.projectRoot, encoding: 'utf-8', stdio: 'pipe' });
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
      execute: async (args, context) => {
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
      description: 'Busca símbolos o texto en el repositorio local sin usar la IA',
      riskLevel: 'LOW',
      schema: searchCodeSchema,
      execute: async (args, context) => {
        const indexer = new RepositoryIndexer(context.projectRoot);
        indexer.buildIndex();
        const matches = indexer.searchSymbols(args.query);
        return { query: args.query, matchesCount: matches.length, matches };
      }
    });

    this.registerTool({
      name: 'who_imports',
      description: 'Consulta de forma determinística qué archivos importan una clase, módulo o archivo',
      riskLevel: 'LOW',
      schema: whoImportsSchema,
      execute: async (args, context) => {
        const intel = this.getSharedIntel(context.projectRoot);
        return intel.whoImports(args.target);
      }
    });

    this.registerTool({
      name: 'get_dependencies',
      description: 'Consulta las dependencias e importaciones de un archivo específico',
      riskLevel: 'LOW',
      schema: getDependenciesSchema,
      execute: async (args, context) => {
        const intel = this.getSharedIntel(context.projectRoot);
        return intel.getDependencies(args.filePath);
      }
    });

    this.registerTool({
      name: 'find_symbol',
      description: 'Localiza en qué archivos está definido o exportado un símbolo específico',
      riskLevel: 'LOW',
      schema: findSymbolSchema,
      execute: async (args, context) => {
        const intel = this.getSharedIntel(context.projectRoot);
        return intel.findSymbolDefinition(args.symbol);
      }
    });

    this.registerTool({
      name: 'analyze_impact',
      description: 'Determina qué módulos y pruebas podrían verse afectados antes de editar un archivo',
      riskLevel: 'LOW',
      schema: analyzeImpactSchema,
      execute: async (args, context) => {
        const analyzer = new ImpactAnalysis(context.projectRoot);
        return analyzer.analyze(args.filePath);
      }
    });

    this.registerTool({
      name: 'task_complete',
      description: 'Confirma formalmente la finalización (exitosa o fallida) de la subtarea activa.',
      riskLevel: 'LOW',
      schema: taskCompleteSchema,
      execute: async (args) => {
        return {
          completed: true,
          status: args.status,
          summary: args.summary,
          reason: args.reason
        };
      }
    });
  }

  registerTool({ name, description, riskLevel, schema, execute }) {
    this.tools.set(name, { name, description, riskLevel, schema, execute });
  }

  getTool(name) {
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
  async executeTool(name, args, context = {}) {
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