const OutputParser = require('../../shared/utils/outputParser');
const TaskDAG = require('./dag');
const SYSTEM_PROMPTS = require('../../shared/config/prompts');
const { taskPlanSchema } = require('../../shared/schemas/toolSchemas');
const TaskDecomposer = require('./decomposer');

class Replanner {
  getReplanPrompt({
    userObjective = '',
    failedTask = { id: '', description: '', tool: null, args: { path: '', filePath: '', content: '', command: '', query: '', target: '', symbol: '', paths: [], createDirs: true, status: 'SUCCESS', summary: '', reason: '', task_id: '' }, context: {}, dependencies: [] },
    loopReason = '',
    loopDetails = '',
    errors = [],
    currentDAG = { toJSON: () => [] }
  } = {}) {
    const recentErrors = errors.map(e => `- ${e.error || e}`).join('\n');
    return SYSTEM_PROMPTS.REPLANNER(
      failedTask.description,
      failedTask,
      loopReason || 'FALLO_DE_TAREA',
      loopDetails || 'La tarea falló durante su ejecución.',
      recentErrors,
      '[NO INCLUIR NI REPLANIFICAR EL DAG ORIGINAL]'
    );
  }

  parseResponse({ responseText = '', failedTask = { id: '', description: '', tool: null, args: { path: '', filePath: '', content: '', command: '', query: '', target: '', symbol: '', paths: [], createDirs: true, status: 'SUCCESS', summary: '', reason: '', task_id: '' }, context: {}, dependencies: [] } } = {}) {
    const parseResult = OutputParser.parseToolCall(responseText);

    if (parseResult.success && parseResult.data?.tool === 'task_plan') {
      const validation = taskPlanSchema.safeParse(parseResult.data.arguments);
      if (validation.success && validation.data.tasks.length > 0) {
        return new TaskDAG({ tasks: validation.data.tasks });
      }
    }

    const decomposer = new TaskDecomposer();
    const regexTasks = decomposer.extractTasksWithRegex(responseText);
    if (regexTasks.length > 0) {
      console.log(`  🧠 [REPLANNER] Se recuperaron ${regexTasks.length} subtarea(s) mediante el extractor de rescate.`);
      return new TaskDAG({ tasks: regexTasks });
    }

    return new TaskDAG({ tasks: [
      { id: 'task_replan_1', description: `Revisar y abordar con enfoque alternativo: ${failedTask.description}`, dependencies: [] }
    ] });
  }
}

module.exports = Replanner;