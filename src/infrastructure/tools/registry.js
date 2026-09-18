const { executeCommandSchema, writeFileSchema, readFilesSchema } = require('../../shared/schemas/toolSchemas');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const RepositoryIndexer = require('../../domain/context/indexer');
const RepositoryIntelligence = require('../../domain/context/repositoryIntel');
const ImpactAnalysis = require('../../domain/context/impactAnalysis');
const { z } = require('zod');

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.registerDefaultTools();
  }

  registerDefaultTools() {
    this.registerTool({
      name: 'execute_command',
      description: 'Ejecuta un comando en la terminal',
      riskLevel: 'HIGH',
      schema: executeCommandSchema,
      execute: async (args, context) => {
        const output = execSync(args.command, { cwd: context.projectRoot, encoding: 'utf-8', stdio: 'pipe' });
        return { output };
      }
    });

    this.registerTool({
      name: 'write_file',
      description: 'Escribe el contenido completo de un archivo mediante escritura atómica e inspección de sintaxis',
      riskLevel: 'MEDIUM',
      schema: writeFileSchema,
      execute: async (args, context) => {
        return AtomicWriter.writeFile(context.projectRoot, args.filePath, args.content);
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
          const absPath = path.resolve(context.projectRoot, relPath);
          if (fs.existsSync(absPath)) {
            results[relPath] = fs.readFileSync(absPath, 'utf-8');
          }
        }
        return results;
      }
    });

    this.registerTool({
      name: 'search_code',
      description: 'Busca símbolos o texto en el repositorio local sin usar la IA',
      riskLevel: 'LOW',
      schema: z.object({ query: z.string().min(1) }),
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
      schema: z.object({ target: z.string().min(1) }),
      execute: async (args, context) => {
        const intel = new RepositoryIntelligence(context.projectRoot);
        return intel.whoImports(args.target);
      }
    });

    this.registerTool({
      name: 'get_dependencies',
      description: 'Consulta las dependencias e importaciones de un archivo específico',
      riskLevel: 'LOW',
      schema: z.object({ filePath: z.string().min(1) }),
      execute: async (args, context) => {
        const intel = new RepositoryIntelligence(context.projectRoot);
        return intel.getDependencies(args.filePath);
      }
    });

    this.registerTool({
      name: 'find_symbol',
      description: 'Localiza en qué archivos está definido o exportado un símbolo especifico',
      riskLevel: 'LOW',
      schema: z.object({ symbol: z.string().min(1) }),
      execute: async (args, context) => {
        const intel = new RepositoryIntelligence(context.projectRoot);
        return intel.findSymbolDefinition(args.symbol);
      }
    });

    // ⚡ NUEVA HERRAMIENTA: ANÁLISIS PREDICTIVO DE IMPACTO
    this.registerTool({
      name: 'analyze_impact',
      description: 'Determina qué módulos y pruebas podrían verse afectados antes de editar un archivo',
      riskLevel: 'LOW',
      schema: z.object({ filePath: z.string().min(1) }),
      execute: async (args, context) => {
        const analyzer = new ImpactAnalysis(context.projectRoot);
        return analyzer.analyze(args.filePath);
      }
    });

    // ⚡ HERRAMIENTA DE VERIFICACIÓN DE EVIDENCIAS
    this.registerTool({
      name: 'verify_evidence',
      description: 'Audita determinísticamente evidencias objetivas (file_exists, command_pass, http_check)',
      riskLevel: 'LOW',
      schema: z.object({
        evidences: z.array(z.object({
          type: z.enum(['file_exists', 'command_pass', 'http_check']),
          target: z.string().min(1),
          method: z.string().optional(),
          expectedStatus: z.number().optional()
        })).min(1)
      }),
      execute: async (args, context) => {
        return await Verifier.verifyEvidences(context.projectRoot, args.evidences);
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

  async executeTool(name, args, context) {
    const tool = this.getTool(name);
    if (!tool) {
      throw new Error(`Herramienta '${name}' no registrada.`);
    }
    const parsedArgs = tool.schema.parse(args);
    return await tool.execute(parsedArgs, context);
  }
}

module.exports = ToolRegistry;