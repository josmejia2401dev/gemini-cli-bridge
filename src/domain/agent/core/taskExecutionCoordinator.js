const ExecutionTask = require('../contracts/executionTask');
const ExecutionResult = require('../contracts/executionResult');

/**
 * Conector universal Execution -> Recovery -> Planning -> Execution.
 *
 * Una tarea se ejecuta una vez. Si falla, Recovery consulta inmediatamente
 * la memoria episódica y construye el contexto para que Planning genere una
 * nueva estrategia. El nuevo DAG vuelve a entrar al mismo coordinador.
 *
 * No existe un contador de intentos: el ciclo solo termina cuando la tarea/
 * plan se completa, el usuario aborta o se produce un fallo que no puede
 * transformarse en un plan de recuperación.
 */
class TaskExecutionCoordinator {
  constructor({ execution = null, recovery = null, planning = null, taskResolver = null } = {}) {
    if (!execution || !recovery || !planning) {
      throw new Error('[TaskExecutionCoordinator] execution, recovery y planning son obligatorios.');
    }
    this.execution = execution;
    this.recovery = recovery;
    this.planning = planning;
    this.taskResolver = taskResolver;
  }

  async executeTaskWithRecovery(
    task = null,
    {
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
    } = {}
  ) {
    if (!(task instanceof ExecutionTask)) {
      throw new Error('[TaskExecutionCoordinator] task debe ser ExecutionTask.');
    }

    let currentTask = task;
    const recoveryTargetTask = recoveryScopeTask instanceof ExecutionTask ? recoveryScopeTask : task;

    if (!currentTask.hasExplicitTool() && this.taskResolver) {
      try {
        currentTask = await this.taskResolver(currentTask, { objective, executionContext });
      } catch (err) {
        return {
          success: false,
          result: ExecutionResult.fail({
            error: `No se pudo convertir la tarea en una instrucción ejecutable: ${err.message}`
          })
        };
      }
    }

    const result = await this.execution.execute(currentTask);

    if (result.success) {
      return { success: true, result };
    }

    console.log('\n⚠️ [RECOVERY] La ejecución falló. Consultando memoria y preparando una estrategia de recuperación...');

    const recovery = await this.recovery.handleFailure({
      task: currentTask,
      result,
      parentDAG,
      recoveryScopeTask: recoveryTargetTask,
      executionContext
    });

    console.log('\n🧩 [PLANNING DE RECUPERACIÓN] Se generará un nuevo plan a partir del error y del feedback recuperado. El nuevo plan requiere aprobación antes de ejecutarse.\n');

    // El DAG de recuperación es independiente y está limitado exclusivamente a la tarea fallida.
    // Nunca sustituye ni modifica el DAG original.
    const recoveryDAG = await this.planning.generateAndApproveDAG({
      objective: recoveryTargetTask.description,
      recoveryContext: recovery.context,
      requireApproval: true
    });

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
        solutionDetails: `DAG de recuperación completado para: ${recoveryTargetTask.description}.`
      });
    }

    return {
      success: planResult.success,
      result: planResult.result,
      recoveredByPlan: true,
      sequence: planResult.sequence
    };
  }

  async executeDAG(
    dag = null,
    {
      objective = '',
      recoveryScopeTask = null,
      executionContext = {
        source: '',
        workingDirectory: '',
        environment: {},
        variables: {},
        metadata: {}
      }
    } = {}
  ) {
    const working = dag;
    const sequence = [];
    let lastResult = ExecutionResult.ok({ output: null });

    while (!working.isCompleted() && !global.abortLoop) {
      const next = working.getNextTasks();

      if (!next.length) {
        return {
          success: false,
          result: ExecutionResult.fail({ error: 'DAG bloqueado: no hay tareas ejecutables.' }),
          sequence
        };
      }

      for (const raw of next) {
        const task = raw instanceof ExecutionTask ? raw : new ExecutionTask(raw);
        working.markInProgress(task.id);

        const result = await this.executeTaskWithRecovery(task, {
          parentDAG: working,
          objective,
          recoveryScopeTask: recoveryScopeTask instanceof ExecutionTask ? recoveryScopeTask : null,
          executionContext
        });

        sequence.push(task.id);

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
      }
    }

    return {
      success: working.isCompleted(),
      result: lastResult,
      sequence
    };
  }
}

module.exports = TaskExecutionCoordinator;
