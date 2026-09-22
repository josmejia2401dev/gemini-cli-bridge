const OutputParser = require('../../shared/utils/outputParser');
const TaskDAG = require('./dag');
const SYSTEM_PROMPTS = require('../../shared/config/prompts');
const { taskPlanSchema } = require('../../shared/schemas/toolSchemas');
const TaskDecomposer = require('./decomposer');

class Replanner {
  getReplanPrompt({ userObjective, failedTask, loopReason, loopDetails, errors, currentDAG }) {
    const recentErrors = errors.slice(-3).map(e => `- ${e.error || e}`).join('\n');
    return SYSTEM_PROMPTS.REPLANNER(
      userObjective, 
      failedTask, 
      loopReason, 
      loopDetails, 
      recentErrors, 
      JSON.stringify(currentDAG.toJSON(), null, 2)
    );
  }

  parseResponse(responseText, failedTask) {
    const parseResult = OutputParser.parseToolCall(responseText);

    if (parseResult.success && parseResult.data?.tool === 'task_plan') {
      const validation = taskPlanSchema.safeParse(parseResult.data.arguments);
      if (validation.success && validation.data.tasks.length > 0) {
        return new TaskDAG(validation.data.tasks);
      }
    }

    const decomposer = new TaskDecomposer();
    const regexTasks = decomposer.extractTasksWithRegex(responseText);
    if (regexTasks.length > 0) {
      console.log(`  🧠 [REPLANNER] Se recuperaron ${regexTasks.length} subtarea(s) mediante el extractor de rescate.`);
      return new TaskDAG(regexTasks);
    }

    return new TaskDAG([
      { id: 'task_replan_1', description: `Revisar y abordar con enfoque alternativo: ${failedTask.description}`, dependencies: [] }
    ]);
  }
}

module.exports = Replanner;