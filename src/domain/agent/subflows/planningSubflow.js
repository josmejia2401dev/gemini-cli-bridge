const TaskDecomposer = require('../decomposer');
const Replanner = require('../replanner');
const RecoveryContext = require('../contracts/recoveryContext');
const ModelRouter = require('../../../infrastructure/llm/modelRouter');

class PlanningSubflow {
  /**
  * @param {Object} [options={}] - Configuración inicial del subflujo.
  * @param {ModelRouter|null} [options.modelRouter=null] - Instancia del router de modelos.
  * @param {Repl|null} [options.repl=null] - Instancia del REPL.
  * @param {TaskDecomposer|null} [options.decomposer] - Instancia encargada de descomponer tareas.
  * @param {Replanner|null} [options.replanner] - Instancia encargada de re-planificar.
  */
  constructor({ modelRouter = null, repl = null, decomposer = null, replanner = null } = {}) {
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
    let rejectionFeedback = '';

    while (true) {
      const isRecovery = recoveryContext instanceof RecoveryContext;
      let dag;

      try {
        dag = isRecovery
          ? await this._generateRecoveryDAG({
            objective,
            recoveryContext,
            rejectionFeedback
          })
          : await this._generateInitialDAG({
            objective,
            rejectionFeedback
          });

        dag.validate();
      } catch (error) {
        console.error(`\n  ❌ [PLANNING] No se pudo generar/validar el DAG: ${error.message}`);
        rejectionFeedback = `El DAG generado no fue válido: ${error.message}. Genera nuevamente una estructura válida.`;
        continue;
      }

      console.log(
        dag.formatSummary({
          title: isRecovery
            ? 'PLAN DE RECUPERACIÓN - TASK DAG'
            : 'PLAN DE EJECUCIÓN - TASK DAG'
        })
      );

      if (!requireApproval) {
        return dag;
      }

      if (!this.repl) {
        throw new Error(
          '[PlanningSubflow] REPL es obligatorio cuando requireApproval=true.'
        );
      }

      const approval = await this._requestUserApproval({
        isRecovery
      });

      if (approval.manual) {
        console.log(
          '\n  👤 [SISTEMA] La tarea será resuelta manualmente por el usuario. El DAG original permanecerá pausado hasta ejecutar /resume-task.\n'
        );

        return {
          requiresManualResolution: true,
          reason: approval.reason || 'El usuario eligió resolver manualmente la tarea fallida.'
        };
      }

      if (approval.approved) {
        console.log('\n  ✅ [SISTEMA] Plan aprobado por el usuario.\n');
        return dag;
      }

      rejectionFeedback = approval.reason;
      console.log(
        '\n  🔄 [SISTEMA] El plan fue rechazado. Replanificando con el motivo proporcionado...\n'
      );
    }
  }

  async _generateInitialDAG({
    objective = '',
    rejectionFeedback = ''
  } = {}) {
    const prompt = this.decomposer.getDecompositionPrompt({
      userObjective: objective,
      rejectionFeedback: rejectionFeedback || null
    });

    this.printLLMRequest({
      stage: 'PLANNING_INITIAL',
      prompt
    });

    const response = await this.modelRouter.generate({
      prompt
    });

    this.printLLMResponse({
      stage: 'PLANNING_INITIAL',
      text: response.text
    });

    return this.decomposer.parseResponse({
      responseText: response.text,
      userObjective: objective
    });
  }

  async _generateRecoveryDAG({
    objective = '',
    recoveryContext = null,
    rejectionFeedback = ''
  } = {}) {
    if (!(recoveryContext instanceof RecoveryContext)) {
      throw new Error(
        '[PlanningSubflow] recoveryContext debe ser RecoveryContext.'
      );
    }

    const prompt = recoveryContext.buildRecoveryPrompt({
      includeParentDAG: false,
      userFeedback: rejectionFeedback
    });

    this.printLLMRequest({
      stage: 'PLANNING_RECOVERY',
      prompt
    });

    const response = await this.modelRouter.generate({
      prompt
    });

    this.printLLMResponse({
      stage: 'PLANNING_RECOVERY',
      text: response.text
    });

    const dag = this.replanner.parseResponse({
      responseText: response.text,
      failedTask:
        recoveryContext.recoveryScopeTask || recoveryContext.task
    });

    this._validateRecoveryScope({
      dag,
      recoveryContext
    });

    return dag;
  }

  _validateRecoveryScope({
    dag = null,
    recoveryContext = null
  } = {}) {
    if (!dag || !(recoveryContext instanceof RecoveryContext)) {
      throw new Error(
        '[PlanningSubflow] Datos insuficientes para validar el alcance del recovery DAG.'
      );
    }

    const scopeTask = recoveryContext.recoveryScopeTask;
    const forbiddenOriginalTaskIds = new Set();

    if (
      recoveryContext.parentDAG &&
      typeof recoveryContext.parentDAG.toJSON === 'function'
    ) {
      for (const originalTask of recoveryContext.parentDAG.toJSON()) {
        if (originalTask.id !== scopeTask.id) {
          forbiddenOriginalTaskIds.add(originalTask.id);
        }
      }
    }

    for (const task of dag.toJSON()) {
      if (forbiddenOriginalTaskIds.has(task.id)) {
        throw new Error(
          `El recovery DAG incluyó la tarea original '${task.id}', ajena al alcance de recuperación de '${scopeTask.id}'.`
        );
      }
    }
  }

  async _requestUserApproval({
    isRecovery = false,
    approvalPrompt = null,
    rejectionPrompt =
    '  Indica el motivo del rechazo o ajustes requeridos para la IA: ',
    manualPrompt =
    '  La tarea puede ser resuelta manualmente. ¿Deseas hacerlo ahora? (Y/n): '
  } = {}) {
    const prompt =
      approvalPrompt ||
      (
        isRecovery
          ? '  ¿Apruebas este plan de recuperación para solucionar la tarea fallida? (Y/M/N): '
          : '  ¿Apruebas este plan de trabajo para su ejecución? (Y/n): '
      );

    global.awaitingUserApproval = true;

    try {
      while (!global.abortLoop) {
        const answer = (
          await this.repl.askQuestion(prompt)
        ).trim().toLowerCase();

        if (['y', 'yes', 's', 'si', 'sí', ''].includes(answer)) {
          return {
            approved: true,
            manual: false,
            reason: ''
          };
        }

        if (isRecovery && ['m', 'manual', 'manualmente'].includes(answer)) {
          return {
            approved: false,
            manual: true,
            reason:
              'El usuario eligió resolver manualmente la tarea fallida.'
          };
        }

        if (['n', 'no'].includes(answer)) {
          const reason = await this.repl.askQuestion(rejectionPrompt);

          return {
            approved: false,
            manual: false,
            reason:
              reason.trim() ||
              'El usuario rechazó el plan sin proporcionar detalles adicionales.'
          };
        }

        console.log(
          isRecovery
            ? '\n  ⚠️ [SISTEMA] Entrada inválida. Responde Y para aprobar, M para resolver manualmente o N para rechazar.\n'
            : '\n  ⚠️ [SISTEMA] Entrada inválida. Responde Y para aprobar o N para rechazar.\n'
        );
      }

      return {
        approved: false,
        manual: false,
        reason: 'El flujo fue abortado por el usuario.'
      };
    } finally {
      global.awaitingUserApproval = false;
    }
  }

  printLLMRequest({
    stage = 'GENERAL',
    prompt = ''
  } = {}) {
    console.log(`\n  📤 [LLM REQUEST - ${stage}]`);
    console.log('  ---------------------------------------------------------------');
    console.log(prompt);
    console.log('  ---------------------------------------------------------------');
  }

  printLLMResponse({
    stage = 'GENERAL',
    text = ''
  } = {}) {
    console.log(`\n  📥 [LLM RESPONSE - ${stage}]`);
    console.log('  ---------------------------------------------------------------');
    console.log(text || '');
    console.log('  ---------------------------------------------------------------');
  }
}

module.exports = PlanningSubflow;
