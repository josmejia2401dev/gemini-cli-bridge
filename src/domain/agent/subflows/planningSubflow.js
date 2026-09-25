const TaskDecomposer = require('../decomposer');
const Replanner = require('../replanner');
const RecoveryContext = require('../contracts/recoveryContext');
const TaskDAG = require('../dag');

class PlanningSubflow {
  constructor({ modelRouter = null, repl = null, decomposer = new TaskDecomposer(), replanner = new Replanner() } = {}) {
    if (!modelRouter) throw new Error('[PlanningSubflow] modelRouter es obligatorio.');
    this.modelRouter = modelRouter;
    this.repl = repl;
    this.decomposer = decomposer;
    this.replanner = replanner;
  }

  async generateAndApproveDAG({
    objective = '',
    recoveryContext = null,
    requireApproval = true
  } = {}) {
    let feedback = null;
    while (true) {
      const dag = recoveryContext instanceof RecoveryContext
        ? await this._generateRecoveryDAG(objective, recoveryContext, feedback)
        : await this._generateInitialDAG(objective, feedback);

      try { dag.validate(); }
      catch (err) {
        console.warn(`  ⚠️ [PLANNING] DAG inválido: ${err.message}. Reintentando generación.`);
        feedback = `El DAG anterior era inválido: ${err.message}. Genera una estructura válida.`;
        continue;
      }

      if (!requireApproval || !this.repl) return dag;
      console.log(dag.formatSummary());
      const approval = await this._requestUserApproval();
      if (approval.approved) {
        console.log('\n  ✅ [SISTEMA] Plan aprobado por el usuario.\n');
        return dag;
      }
      feedback = approval.reason;
      console.log('\n  🔄 [SISTEMA] Replanificando con las observaciones del usuario...\n');
    }
  }

  async _generateInitialDAG(objective = '', rejectionFeedback = null) {
    const prompt = this.decomposer.getDecompositionPrompt({ userObjective: objective, rejectionFeedback });
    const response = await this.modelRouter.generate({ prompt });
    return this.decomposer.parseResponse({ responseText: response.text, userObjective: objective });
  }

  async _generateRecoveryDAG(objective = '', recoveryContext = null, rejectionFeedback = null) {
    let prompt = recoveryContext.buildRecoveryPrompt();
    if (rejectionFeedback) prompt += `\nFEEDBACK DEL USUARIO:\n${rejectionFeedback}\n`;
    const response = await this.modelRouter.generate({ prompt });
    return this.replanner.parseResponse({ responseText: response.text, failedTask: recoveryContext.recoveryScopeTask || recoveryContext.task });
  }

  async _requestUserApproval({ approvalPrompt = '  ¿Apruebas este plan de trabajo para su ejecución? (Y/n): ', rejectionPrompt = '  Indica el motivo del rechazo o ajustes requeridos para la IA: ' } = {}) {
    global.isProcessing = false;
    const answer = await this.repl.askQuestion(approvalPrompt);
    if (['y', 's', ''].includes(answer.trim().toLowerCase())) return { approved: true, reason: '' };
    const reason = await this.repl.askQuestion(rejectionPrompt);
    return { approved: false, reason: reason.trim() || 'El plan no satisface los requerimientos; genera una estrategia alternativa.' };
  }
}
module.exports = PlanningSubflow;
