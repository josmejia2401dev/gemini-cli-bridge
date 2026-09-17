// tools/registry.js
const { executeCommandSchema, writeFileSchema, readFilesSchema } = require('../schemas/toolSchemas');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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
      description: 'Escribe contenido completo en un archivo',
      riskLevel: 'MEDIUM',
      schema: writeFileSchema,
      execute: async (args, context) => {
        const absPath = path.resolve(context.projectRoot, args.filePath);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, args.content, 'utf-8');
        return { success: true, filePath: args.filePath };
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