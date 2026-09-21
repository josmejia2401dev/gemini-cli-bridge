const { execSync } = require('child_process');
const PolicyEngine = require('../../infrastructure/tools/policyEngine');
const Verifier = require('./verifier');
const Reflector = require('./reflector');
const OutputParser = require('../../shared/utils/outputParser');
const AgentState = require('./state');
const TaskDecomposer = require('./decomposer');
const ExecutionDecisionEngine = require('./decisionEngine');
const ImpactAnalysis = require('../context/impactAnalysis');
const ErrorAnalyzer = require('./errorAnalyzer');
const Replanner = require('./replanner');

class AgentRuntime {
  constructor({ modelRouter, toolRegistry, projectRoot, repl, logger, episodicMemory, checkpointManager }) {
    this.modelRouter = modelRouter;
    this.toolRegistry = toolRegistry;
    this.projectRoot = projectRoot;
    this.repl = repl;
    this.logger = logger;
    this.episodicMemory = episodicMemory;
    this.checkpointManager = checkpointManager;

    this.currentState = null;
    this.policyEngine = new PolicyEngine();
    this.decomposer = new TaskDecomposer();
    this.decisionEngine = new ExecutionDecisionEngine();
    this.impactAnalyzer = new ImpactAnalysis(projectRoot);
    this.replanner = new Replanner();
  }

  setProjectRoot(newRoot) {
    this.projectRoot = newRoot;
    this.impactAnalyzer = new ImpactAnalysis(newRoot);
  }

  async executeReplan(failedTask, reason, details) {
    console.log(`\n  🔄 [REPLANIFICACIÓN AUTOMÁTICA] Reorganizando la estrategia por: ${reason}...`);
    this.currentState.transition('REPLAN');

    const replanPrompt = this.replanner.getReplanPrompt({
      userObjective: this.currentState.objective,
      failedTask,
      loopReason: reason,
      loopDetails: details,
      errors: this.currentState.errors,
      currentDAG: this.currentState.dag
    });
    const response = await this.modelRouter.generate({ prompt: replanPrompt });

    const newDAG = this.replanner.parseResponse(response.text, failedTask);
    this.currentState.dag = newDAG;

    console.log('\n    [NUEVA ESTRATEGIA ASIGNADA]:');
    console.log(this.currentState.dag.formatSummary());
  }

  async generateTaskDAG(objective) {
    console.log('  🧠 Analizando intención y generando DAG de tareas con Gemini...');
    const prompt = this.decomposer.getDecompositionPrompt(objective);
    const response = await this.modelRouter.generate({ prompt });
    return this.decomposer.parseResponse(response.text, objective);
  }

  async runLoop(initialPrompt, fileToUpload = null, existingState = null) {
    let currentFile = fileToUpload;
    const runId = this.logger?.currentExecutionId || `run_${Date.now()}`;

    if (existingState) {
      this.currentState = existingState;
      console.log(`  [🔄 REANUDACIÓN] Retomando tarea (Paso ${this.currentState.currentStep}) - Estado: ${this.currentState.status}`);

      // GUARDIA V3: Detectar si el DAG está vacío en Map (.size) o Array (.length)
      const taskCount = this.currentState.dag?.tasks?.size
        ?? this.currentState.dag?.tasks?.length
        ?? 0;

      if (taskCount === 0 || this.currentState.status === 'PLANNING') {
        console.log('  [SISTEMA] Tarea reanudada en PLANNING o sin subtareas. Generando plan con Gemini...');
        const taskDAG = await this.generateTaskDAG(this.currentState.objective || initialPrompt);

        this.currentState.dag = taskDAG;
        if (this.checkpointManager) {
          this.checkpointManager.saveCheckpoint(this.currentState);
        }
      }

      if (this.currentState.dag && typeof this.currentState.dag.formatSummary === 'function') {
        console.log(this.currentState.dag.formatSummary());
      }
    } else {
      this.currentState = new AgentState({
        runId,
        objective: initialPrompt,
        status: 'PLANNING'
      });

      if (this.checkpointManager) {
        this.checkpointManager.createRun(runId, initialPrompt);
        this.checkpointManager.saveCheckpoint(this.currentState);
      }

      const taskDAG = await this.generateTaskDAG(initialPrompt);

      this.currentState.dag = taskDAG;
      console.log(this.currentState.dag.formatSummary());

      if (this.checkpointManager) {
        this.checkpointManager.saveCheckpoint(this.currentState);
      }
    }

    while (!this.currentState.dag.isCompleted() && !this.currentState.dag.hasFailed()) {
      const nextTasks = this.currentState.dag.getNextTasks();

      if (nextTasks.length === 0) {
        console.log('  ⚠️ [DAG STUCK] No hay subtareas pendientes con dependencias satisfechas.');

        //this.currentState.transition('REFLECTING');
        //break;

        await this.executeReplan(
          { id: 'DAG_STUCK', description: 'Desbloquear dependencias del DAG' },
          'DAG_STUCK',
          'El grafo de tareas actual se atascó sin poder avanzar en las dependencias.'
        );
        if (this.checkpointManager) this.checkpointManager.saveCheckpoint(this.currentState);
        continue;
      }

      const activeTask = nextTasks[0];
      activeTask.status = 'in_progress';
      this.currentState.dag.updateStatus(activeTask.id, 'in_progress');
      this.currentState.transition('EXECUTING');
      if (this.checkpointManager) this.checkpointManager.saveCheckpoint(this.currentState);

      console.log(`\n  🚀 [EJECUTANDO SUBTAREA] [${activeTask.id}]: ${activeTask.description}`);

      const decision = this.decisionEngine.classify(activeTask.description);

      if (decision.mode === 'DETERMINISTIC') {
        console.log(`  ⚡ [ENRUTAMIENTO DETERMINÍSTICO] Ejecución local instantánea (Sin IA) -> Herramienta: "${decision.tool}"`);
        const startTime = Date.now();

        try {
          const toolResult = await this.toolRegistry.executeTool(
            decision.tool,
            decision.args,
            { projectRoot: this.projectRoot, repl: this.repl }
          );


          this.currentState.addToolCall(decision.tool, decision.args, toolResult);
          console.log(`  Resultado:`, JSON.stringify(toolResult, null, 2));

          activeTask.status = 'completed';
          this.currentState.dag.updateStatus(activeTask.id, 'completed');
          this.currentState.completedSteps.push(activeTask.id);
          console.log(`  ✅ [SUBTAREA COMPLETADA] [${activeTask.id}]`);
        } catch (execErr) {

          console.error(`  ❌ Error en ejecución determinística: ${execErr.message}`);

          const errorAnalysis = ErrorAnalyzer.analyze(decision.args.command || '', execErr.message, this.episodicMemory);
          if (errorAnalysis.isKnown) {
            console.log(`  🧠 [AUTOCORRECCIÓN DETERMINÍSTICA] Error conocido detectado: "${errorAnalysis.signature}". Aplicando solución histórica sin IA...`);
            try {
              execSync(errorAnalysis.solution, { cwd: this.projectRoot, stdio: 'pipe' });
              console.log(`  ✅ [CORRECCIÓN APLICADA] Se ejecutó: "${errorAnalysis.solution}"`);
              activeTask.status = 'completed';
              this.currentState.dag.updateStatus(activeTask.id, 'completed');
            } catch (fixErr) {
              activeTask.status = 'failed';
              this.currentState.dag.updateStatus(activeTask.id, 'failed');
            }
          } else {
            activeTask.status = 'failed';
            this.currentState.dag.updateStatus(activeTask.id, 'failed');
            this.currentState.addError(execErr.message);
          }
        }

        if (this.checkpointManager) this.checkpointManager.saveCheckpoint(this.currentState);
        continue;
      }

      let impactContextNotice = '';
      const fileMatch = activeTask.description.match(/([a-zA-Z0-9_\-\/]+\.(?:js|ts|jsx|tsx|java|py|json))/i);
      if (fileMatch) {
        const targetFile = fileMatch[1];
        const impact = this.impactAnalyzer.analyze(targetFile);

        if (impact.noticeForLLM) {
          console.log(`  🎯 [ANÁLISIS DE IMPACTO] "${targetFile}" afecta a ${impact.totalImpacted} archivo(s) consumidores/tests.`);
          impactContextNotice = `\n\n${impact.noticeForLLM}`;
        }
      }

      let subtaskPrompt = `[SUBTAREA ACTIVA: ${activeTask.id}]\nDescripción: ${activeTask.description}\n\nObjetivo Global: "${this.currentState.objective}"${impactContextNotice}\n\nPor favor, ejecuta las herramientas necesarias para completar esta subtarea. Si ya terminaste esta subtarea, no llames más herramientas.`;

      while (subtaskPrompt) {
        try {
          global.isProcessing = true;
          this.currentState.iterations++;

          if (this.episodicMemory && subtaskPrompt && !subtaskPrompt.includes('SISTEMA: FEEDBACK')) {
            const keywords = subtaskPrompt.split(' ').slice(0, 3).join('%');
            const pastExperiences = this.episodicMemory.findPastExperience(keywords);

            if (pastExperiences && pastExperiences.length > 0) {
              let memoryContext = `\n[SISTEMA - MEMORIA EPISÓDICA]: Lecciones previas para esta tarea:\n`;
              pastExperiences.forEach((exp, idx) => {
                memoryContext += `- Intento fallido #${idx + 1}: Ejecutaste '${exp.command}'. Error: ${exp.error_output}.\n`;
              });
              subtaskPrompt += `\n${memoryContext}`;
            }
          }

          const response = await this.modelRouter.generate({
            prompt: subtaskPrompt,
            fileToUpload: currentFile
          });


          global.isProcessing = false;
          if (global.abortLoop) {
            console.log('  [SISTEMA] Bucle y ejecución cancelados por el usuario.');
            this.currentState.transition('IDLE');
            if (this.checkpointManager) this.checkpointManager.saveCheckpoint(this.currentState);
            return;
          }

          currentFile = null;

          console.log('\n-------------------- IA --------------------');
          console.log(response.text);
          console.log('--------------------------------------------\n');

          let followUpContext = '';
          let isToolCall = false;
          let parsedObject = null;

          const parseResult = OutputParser.parseToolCall(response.text);

          if (parseResult.success) {
            parsedObject = parseResult.data;
            if (this.toolRegistry.getTool(parsedObject.tool)) {
              isToolCall = true;
            }
          }


          if (isToolCall) {
            const toolName = parsedObject.tool;
            const args = parsedObject.arguments || {};

            console.log(`\n  [⚡ TOOL RUNTIME (JS MODE)] Herramienta solicitada: "${toolName}"`);

            // VALIDACIÓN DE POLÍTICA Y RIESGO (Human-in-the-Loop)
            const toolDef = this.toolRegistry.getTool(toolName);
            const policyCheck = await this.policyEngine.evaluateAndConfirm({
              toolName,
              args,
              toolDef,
              repl: this.repl
            });

            if (!policyCheck.allowed) {
              console.log(`  [⛔ ACCIÓN BLOQUEADA] ${policyCheck.reason}`);
              this.currentState.addError(policyCheck.reason);

              // Se le regresa feedback a la IA informando que el usuario canceló la acción
              followUpContext = `[SISTEMA ERROR]: ${policyCheck.reason}. Debes proponer un enfoque alternativo o consultar al usuario.`;
            }

            if (toolName === 'execute_command' && !followUpContext) {
              const verification = Verifier.preExecuteCommand(args.command || '');
              if (!verification.valid) {
                console.log(`  [⛔ VERIFIER BLOCKED] ${verification.reason}`);
                if (this.episodicMemory) {
                  this.episodicMemory.recordFailure(args.command, verification.reason, "Bloqueado por validación sintáctica previa");
                }
                this.currentState.addError(verification.reason);
                followUpContext = Reflector.createFeedback({
                  command: args.command,
                  error: verification.reason,
                  isRejected: false,
                  episodicMemory: this.episodicMemory
                });
              }
            }

            if (!followUpContext) {
              try {
                const toolResult = await this.toolRegistry.executeTool(
                  toolName,
                  args,
                  { projectRoot: this.projectRoot, repl: this.repl }
                );

                this.currentState.addToolCall(toolName, args, toolResult);
                if (toolName === 'write_file' && args.filePath) {
                  this.currentState.addFileModified(args.filePath);
                } else if (toolName === 'read_files' && Array.isArray(args.paths)) {
                  args.paths.forEach(p => this.currentState.addFileRead(p));
                }

                this.currentState.transition('VERIFYING');
                this.currentState.currentStep++;
                if (this.checkpointManager) this.checkpointManager.saveCheckpoint(this.currentState);

                followUpContext = `[SISTEMA: Resultado de ${toolName}]:${JSON.stringify(toolResult)}`;
              } catch (toolError) {

                if (this.episodicMemory && toolName === 'execute_command') {
                  this.episodicMemory.recordFailure(args.command, toolError.message, "Fallo al ejecutar en terminal");
                }
                this.currentState.addError(toolError);

                followUpContext = Reflector.createFeedback({
                  command: args.command || '',
                  error: toolError.message,
                  isRejected: false,
                  episodicMemory: this.episodicMemory
                });
              }
            }
          } else {
            activeTask.status = 'completed';
            this.currentState.dag.updateStatus(activeTask.id, 'completed');
            this.currentState.completedSteps.push(activeTask.id);
            console.log(`  ✅ [SUBTAREA COMPLETADA] [${activeTask.id}]`);
            subtaskPrompt = null;
            break;
          }

          if (followUpContext) {
            subtaskPrompt = `[SISTEMA: FEEDBACK AGENT RUNTIME]\n${followUpContext}\n\nContinúa con la subtarea [${activeTask.id}].`;
          }

        } catch (err) {
          console.error('\n  Error en Agent Runtime:', err.message);
          activeTask.status = 'failed';
          this.currentState.dag.updateStatus(activeTask.id, 'failed');
          this.currentState.addError(err.message);

          //this.currentState.transition('REFLECTING');
          //if (this.checkpointManager) this.checkpointManager.saveCheckpoint(this.currentState);
          //break;

          await this.executeReplan(
            activeTask,
            'SUBTASK_FAILED',
            `La subtarea [${activeTask.id}] falló con el error: ${err.message}`
          );
          if (this.checkpointManager) this.checkpointManager.saveCheckpoint(this.currentState);
          subtaskPrompt = null;
          break;
        }
      }
    }

    if (this.currentState.dag.isCompleted()) {
      this.currentState.transition('SUCCESS');
      if (this.checkpointManager) this.checkpointManager.markRunCompleted(this.currentState.runId, 'SUCCESS');

      console.log('\n  🎉 [ÉXITO GLOBAL] Todas las subtareas del DAG han sido completadas exitosamente.\n');

      if (this.logger && typeof this.logger.saveDatasetTrace === 'function') {
        this.logger.saveDatasetTrace(this.currentState);
      }
    }
  }
}

module.exports = AgentRuntime;