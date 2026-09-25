const ExecutionTask = require('../contracts/executionTask');
const ExecutionResult = require('../contracts/executionResult');
const RecoveryContext = require('../contracts/recoveryContext');

class TaskExecutionCoordinator {
  constructor({
    execution = null,
    recovery = null,
    planning = null,
    taskResolver = null
  } = {}) {
    if (!execution || !recovery || !planning) {
      throw new Error(
        '[TaskExecutionCoordinator] execution, recovery y planning son obligatorios.'
      );
    }

    this.execution = execution;
    this.recovery = recovery;
    this.planning = planning;
    this.taskResolver = taskResolver;
    this.pendingManualResolution = null;
  }

  hasPendingManualResolution() {
    return Boolean(this.pendingManualResolution);
  }

  getPendingManualResolution() {
    return this.pendingManualResolution;
  }

  clearPendingManualResolution() {
    this.pendingManualResolution = null;
  }

  async executeTaskWithRecovery(task = null, {
    parentDAG = null,
    objective = '',
    recoveryScopeTask = null,
    executionContext = {
      source: '',
      workingDirectory: '',
      environment: {},
      variables: {},
      metadata: {}
    }
  } = {}) {
    if (!(task instanceof ExecutionTask)) {
      throw new Error('[TaskExecutionCoordinator] task debe ser ExecutionTask.');
    }

    const recoveryTargetTask = recoveryScopeTask instanceof ExecutionTask ? recoveryScopeTask : task;
    let currentTask = task;

    if (!currentTask.hasExplicitTool() && this.taskResolver) {
      try {
        console.log(`\n  🧠 [TASK RESOLUTION] Resolviendo herramienta para [${currentTask.id}]...`);
        currentTask = await this.taskResolver(currentTask, {
          objective,
          executionContext
        });
      } catch (error) {
        const result = ExecutionResult.fail({ error: `No se pudo convertir la tarea en una instrucción ejecutable: ${error.message}` });
        this.printFailureEvidence({ task: currentTask, result });

        return {
          success: false,
          result,
          task: currentTask
        };
      }
    }

    const result = await this.execution.execute(currentTask);

    if (result.success) {
      console.log(`  ✅ [COORDINATOR] Tarea [${currentTask.id}] completada.`);
      return {
        success: true,
        result,
        task: currentTask
      };
    }

    this.printFailureEvidence({ task: currentTask, result });

    if (result.errorCode === 'USER_DENIED') {
      console.log('  🛑 [RECOVERY] La ejecución fue rechazada explícitamente por el usuario. No se inicia recovery automático.');
      return {
        success: false,
        result,
        task: currentTask,
        recoveredByPlan: false
      };
    }

    console.log('\n  ⚠️ [RECOVERY] Preparando contexto de recuperación con la evidencia completa del fallo...');
    const recovery = await this.recovery.handleFailure({
      task: currentTask,
      result,
      parentDAG,
      recoveryScopeTask: recoveryTargetTask,
      executionContext
    });

    if (!(recovery.context instanceof RecoveryContext)) {
      const recoveryResult = ExecutionResult.fail({ error: '[RECOVERY] RecoverySubflow no devolvió un RecoveryContext válido.' });
      this.printFailureEvidence({ task: currentTask, result: recoveryResult });
      return {
        success: false,
        result: recoveryResult,
        task: currentTask
      };
    }

    console.log(`\n  🧩 [PLANNING DE RECUPERACIÓN] Alcance exclusivo: [${recoveryTargetTask.id}] ${recoveryTargetTask.description}`);
    console.log('     🔐 El DAG original permanece intacto. El recovery será una intervención separada.');
    const recoveryPlan =
      await this.planning.generateAndApproveDAG({
        objective: recoveryTargetTask.description,
        recoveryContext: recovery.context,
        requireApproval: true
      });

    if (recoveryPlan?.requiresManualResolution) {
      if (parentDAG) {
        const marked = parentDAG.markWaitingManual(recoveryTargetTask.id);
        if (!marked) {
          throw new Error(`[RECOVERY] No se pudo marcar la tarea '${recoveryTargetTask.id}' como waiting_manual en el DAG original.`);
        }
      }

      this.pendingManualResolution = {
        task: recoveryTargetTask,
        parentDAG,
        result,
        failureId: recovery.failureId,
        objective: recoveryTargetTask.description,
        executionContext
      };

      console.log(`\n  👤 [RECOVERY MANUAL] La tarea [${recoveryTargetTask.id}] queda en espera de resolución manual.`);
      console.log(`  📋 [TAREA] ${recoveryTargetTask.description}`);
      console.log('  ✏️ Resuélvela manualmente y luego ejecuta /resume-task para registrar la solución y continuar el DAG original.');

      return {
        success: false,
        result,
        task: recoveryTargetTask,
        manualPending: true,
        manualResolutionTask: recoveryTargetTask,
        failureId: recovery.failureId,
        sequence: []
      };
    }

    const recoveryDAG = recoveryPlan;

    console.log(recoveryDAG.formatSummary({ title: 'PLAN DE RECUPERACIÓN APROBADO' }));
    const planResult = await this.executeDAG(recoveryDAG, {
      objective: recoveryTargetTask.description,
      recoveryScopeTask: recoveryTargetTask,
      executionContext: {
        ...executionContext,
        source: 'RECOVERY',
        recoveryForTask: recoveryTargetTask.id,
        recoveryFromTask: currentTask.id
      }
    });

    if (planResult.success) {
      await this.recovery.registerSuccessfulFix({
        failureId: recovery.failureId,
        task: recoveryTargetTask,
        solutionDetails: `DAG de recuperación completado para la tarea: ${recoveryTargetTask.description}.`
      });

      console.log(`\n  ✅ [RECOVERY] La tarea [${recoveryTargetTask.id}] fue recuperada.`);
      console.log('  ▶️ [DAG ORIGINAL] La ejecución continuará con las tareas pendientes.');
    } else {
      console.error(`\n  ❌ [RECOVERY] No fue posible resolver la tarea [${recoveryTargetTask.id}].`);
      this.printFailureEvidence({ task: recoveryTargetTask, result: planResult.result });
    }

    return {
      success: planResult.success,
      result: planResult.result,
      recoveredByPlan: planResult.success,
      sequence: planResult.sequence,
      task: recoveryTargetTask
    };
  }

  async executeDAG(dag = null, {
    objective = '',
    recoveryScopeTask = null,
    executionContext = {
      source: '',
      workingDirectory: '',
      environment: {},
      variables: {},
      metadata: {}
    }
  } = {}) {
    if (!dag || typeof dag.getNextTasks !== 'function') {
      throw new Error('[TaskExecutionCoordinator] dag debe ser un TaskDAG válido.');
    }
    const working = dag;
    const sequence = [];
    let lastResult = ExecutionResult.ok({ output: null });
    console.log(`\n  🚀 [DAG] Iniciando ejecución: ${objective || 'sin objetivo'}`);

    while (!working.isCompleted() && !global.abortLoop) {
      const next = working.getNextTasks();

      if (!next.length) {
        if (working.hasWaitingManualResolution()) {
          console.log('\n  👤 [DAG] La ejecución está pausada esperando una resolución manual. Ejecuta /resume-task cuando la tarea haya sido solucionada.');

          return {
            success: false,
            manualPending: true,
            result: ExecutionResult.fail({ error: 'El DAG está esperando la resolución manual de una tarea.' }),
            sequence
          };
        }

        const result = ExecutionResult.fail({ error: 'DAG bloqueado: no hay tareas ejecutables.' });
        console.error(`\n  ❌ [DAG] ${result.error}`);
        return {
          success: false,
          result,
          sequence
        };
      }

      for (const rawTask of next) {
        const task = rawTask instanceof ExecutionTask ? rawTask : new ExecutionTask(rawTask);
        working.markInProgress(task.id);
        console.log(`\n  ➡️ [DAG] Ejecutando [${task.id}] ${task.description}`);

        const result = await this.executeTaskWithRecovery(task, {
          parentDAG: working,
          objective,
          recoveryScopeTask: recoveryScopeTask instanceof ExecutionTask ? recoveryScopeTask : null,
          executionContext
        });

        sequence.push(task.id);

        if (result.manualPending) {
          return {
            success: false,
            manualPending: true,
            manualResolutionTask: result.manualResolutionTask,
            failureId: result.failureId ?? null,
            result: result.result,
            sequence
          };
        }

        if (!result.success) {
          working.markFailed(task.id);
          return {
            success: false,
            result: result.result,
            sequence
          };
        }

        working.markCompleted(task.id);
        lastResult = result.result;
        const recoveryDAG = executionContext.source === 'RECOVERY';
        console.log(recoveryDAG ? `  ✅ [DAG DE RECUPERACIÓN] [${task.id}] completada.` : `  ✅ [DAG ORIGINAL] [${task.id}] completada.`);
      }
    }

    return {
      success: working.isCompleted(),
      result: lastResult,
      sequence
    };
  }

  printFailureEvidence({ task = null, result = null } = {}) {
    if (!task || !result) {
      return;
    }

    console.error('\n  ================= EVIDENCIA DE FALLO =================');
    console.error(`  TASK: [${task.id}] ${task.description}`);
    console.error(`  TOOL: ${task.tool || 'N/A'}`);
    console.error(`  ARGS: ${JSON.stringify(task.args, null, 2)}`);
    console.error(`  ERROR: ${result.error || 'Fallo no especificado'}`);

    if (result.exitCode !== null && result.exitCode !== undefined) {
      console.error(`  EXIT CODE: ${result.exitCode}`);
    }
    if (result.errorCode) {
      console.error(`  ERROR CODE: ${result.errorCode}`);
    }
    if (result.signal) {
      console.error(`  SIGNAL: ${result.signal}`);
    }
    if (result.stdout) {
      console.error(`  STDOUT:\n${result.stdout}`);
    }
    if (result.stderr) {
      console.error(`  STDERR:\n${result.stderr}`);
    }
    console.error('  =======================================================\n');
  }
}

module.exports = TaskExecutionCoordinator;
