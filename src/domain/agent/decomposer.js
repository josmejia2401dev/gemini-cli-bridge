const OutputParser = require('../../shared/utils/outputParser');
const TaskDAG = require('./dag');
const SYSTEM_PROMPTS = require('../../shared/config/prompts');
const { taskPlanSchema } = require('../../shared/schemas/toolSchemas');

class TaskDecomposer {
  getDecompositionPrompt({ userObjective = '', rejectionFeedback = null } = {}) {
    return SYSTEM_PROMPTS.TASK_DECOMPOSER(userObjective, rejectionFeedback);
  }

  parseResponse({ responseText = '', userObjective = '' } = {}) {
    // 1. Intentar parseo estándar con OutputParser y esquema Zod
    const parseResult = OutputParser.parseToolCall(responseText);

    if (parseResult.success && parseResult.data?.tool === 'task_plan') {
      const validation = taskPlanSchema.safeParse(parseResult.data.arguments);
      if (validation.success && validation.data.tasks.length > 0) {
        return new TaskDAG({ tasks: validation.data.tasks });
      }
    }

    // 2. FALLBACK DE RESCATE RESILIENTE: Extrae las tareas incluso si la IA omitió comillas en 'description'
    const regexTasks = this.extractTasksWithRegex(responseText);
    if (regexTasks.length > 0) {
      console.log(`  🧠 [TASK DAG] Se recuperaron ${regexTasks.length} subtarea(s) mediante el extractor de rescate.`);
      return new TaskDAG({ tasks: regexTasks });
    }

    // 3. Fallback atómico final si todo falla
    console.log('  ⚠️ [TASK DAG] No se pudo extraer la estructura de plan. Usando fallback de tarea única.');
    return new TaskDAG({ tasks: [
      { id: 'task_1', description: userObjective, dependencies: [] }
    ] });
  }

  extractTasksWithRegex(text = '') {
    const tasks = [];
    const taskObjects = text.match(/\{[^{}]*description[^{}]*\}/gi) || [];

    for (const rawObj of taskObjects) {
      const idMatch = rawObj.match(/(?:id|["']id["'])\s*:\s*["']?([a-zA-Z0-9_\-]+)["']?/i);
      const id = idMatch ? idMatch[1].trim() : null;

      const depsMatch = rawObj.match(/(?:dependencies|["']dependencies["'])\s*:\s*\[(.*?)\]/i);
      const depsRaw = depsMatch ? depsMatch[1].trim() : '';
      const dependencies = depsRaw
        ? depsRaw.split(',').map(d => d.replace(/[`"'\s]/g, '')).filter(Boolean)
        : [];

      let description = null;
      const descMatch = rawObj.match(/(?:description|["']description["'])\s*:\s*([\s\S]*?)(?:,\s*(?:dependencies|["']dependencies["'])|\s*(?:dependencies|["']dependencies["'])|\s*\}$)/i);
      
      if (descMatch) {
        description = descMatch[1].trim();
        description = description.replace(/^[`"'\s]+|[`"'\s,]+$/g, '').trim();
      }

      if (id && description) {
        tasks.push({ id, description, dependencies });
      }
    }

    return tasks;
  }
}

module.exports = TaskDecomposer;