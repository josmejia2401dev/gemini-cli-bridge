const { execSync } = require('child_process');
const Verifier = require('./verifier');
const Reflector = require('./reflector');
const OutputParser = require('../../shared/utils/outputParser');
const AgentState = require('./state');
const TaskDAG = require('./dag');
const TaskDecomposer = require('./decomposer');
const ExecutionDecisionEngine = require('./decisionEngine');
const ImpactAnalysis = require('../context/impactAnalysis');
const ErrorAnalyzer = require('./errorAnalyzer');
const Replanner = require('./replanner');
const SYSTEM_PROMPTS = require('../../shared/config/prompts');

class AgentRuntime {
  constructor({ modelRouter, toolRegistry, projectRoot, repl, logger, episodicMemory, checkpointManager, decisionEngine }) {
    this.modelRouter = modelRouter;
    this.toolRegistry = toolRegistry;
    this.projectRoot = projectRoot;
    this.repl = repl;
    this.logger = logger;
    this.episodicMemory = episodicMemory;
    this.checkpointManager = checkpointManager;

    this.currentState = null;
    this.decomposer = new TaskDecomposer();
    this.decisionEngine = decisionEngine || new ExecutionDecisionEngine({ projectRoot });
    this.impactAnalyzer = new ImpactAnalysis(projectRoot);
    this.replanner = new Replanner();
  }

  setProjectRoot(newRoot) {
    this.projectRoot = newRoot;
    this.impactAnalyzer = new ImpactAnalysis(newRoot);
    if (this.decisionEngine) {
      this.decisionEngine.setProjectRoot(newRoot);
    }
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

  async handleSubtaskFailure(activeTask, reason, details) {
    this.currentState.addError(details);

    if (!this.repl) {
      this.currentState.dag.markFailed(activeTask.id);
      await this.executeReplan(activeTask, reason, details);
      return;
    }

    console.log(`\n  ⚠️ [INCIDENCIA EN SUBTAREA] La subtarea [${activeTask.id}] no se pudo completar.`);
    console.log(`     Detalles: ${details}\n`);

    const answer = await this.repl.askQuestion('  ¿Deseas [r]eplanear una nueva estrategia o [c]ontinuar con la siguiente subtarea? (R/c): ');
    const choice = answer.trim().toLowerCase();

    if (choice === 'c' || choice === 'continuar') {
      console.log(`\n  ⏩ [SISTEMA] Omitiendo subtarea [${activeTask.id}] y continuando con el resto del plan...\n`);
      this.currentState.dag.markCompleted(activeTask.id);
      this.currentState.completedSteps.push(activeTask.id);

      if (!this.currentState.skippedTasks) {
        this.currentState.skippedTasks = [];
      }
      this.currentState.skippedTasks.push(activeTask);
    } else {
      console.log(`\n  🔄 [SISTEMA] Iniciando replanificación por fallo en [${activeTask.id}]...\n`);
      this.currentState.dag.markFailed(activeTask.id);
      await this.executeReplan(activeTask, reason, details);
    }

    if (this.checkpointManager) {
      this.checkpointManager.saveCheckpoint(this.currentState);
    }
  }

  async generateTaskDAG(objective, rejectionFeedback = null) {
    console.log('  🧠 Analizando intención y generando DAG de tareas con Gemini...');
    const prompt = this.decomposer.getDecompositionPrompt(objective, rejectionFeedback);
    const response = await this.modelRouter.generate({ prompt });
    return this.decomposer.parseResponse(response.text, objective);
  }

  async runLoop(initialPrompt, fileToUpload = null, existingState = null, decisionMode = null, options = {}) {
    const isWebInitiated = options.isWebInitiated || false;
    global.isProcessing = true;
    try {
      let currentFile = fileToUpload;
      const runId = this.logger?.currentExecutionId || `run_${Date.now()}`;

      const activeMode = decisionMode || this.decisionEngine.classify(initialPrompt).mode;

      if (!existingState) {
        if (activeMode === 'DIRECT_CHAT') {
          console.log('\n💬 Procesando consulta conversacional directa...');
          let currentPrompt = initialPrompt;
          let currentFileToSend = currentFile;

          // 🛠️ FIX: Bucle Ad-Hoc para permitir que la IA use herramientas en medio de una charla
          while (currentPrompt) {
            const response = await this.modelRouter.generate({
              prompt: currentPrompt,
              fileToUpload: currentFileToSend,
              isWebInitiated: isWebInitiated
            });
            currentFileToSend = null; // Solo adjuntar el archivo en el primer turno

            console.log('\n-------------------- IA --------------------');
            console.log(response.text);
            console.log('--------------------------------------------\n');

            const parseResult = OutputParser.parseToolCall(response.text);

            if (parseResult.success) {
              const toolName = parseResult.data.tool;
              const args = parseResult.data.arguments || {};

              console.log(`  [⚡ TOOL RUNTIME (CHAT MODE)] Herramienta detectada: "${toolName}"`);

              if (toolName === 'task_complete') {
                console.log(`  ✅ [CHAT COMPLETADO] ${args.summary || ''}\n`);
                break;
              }

              try {
                const toolResult = await this.toolRegistry.executeTool(
                  toolName,
                  args,
                  { projectRoot: this.projectRoot, repl: this.repl }
                );

                // 🛠️ Imprimir retroalimentación visual al usuario
                if (toolName === 'write_file' && args.filePath) {
                  console.log(`  ✅ [SISTEMA] Archivo modificado en disco: ${args.filePath}`);
                } else if (toolName === 'execute_command') {
                  console.log(`  ✅ [SISTEMA] Comando ejecutado con éxito.`);
                  if (toolResult.output) {
                    const outSnippet = toolResult.output.trim().substring(0, 400);
                    console.log(`     Salida:\n${outSnippet}${toolResult.output.length > 400 ? '\n...[truncado]' : ''}`);
                  }
                } else if (toolName === 'read_files' && Array.isArray(args.paths)) {
                  console.log(`  📖 [SISTEMA] Archivos leídos: ${args.paths.join(', ')}`);
                }

                // Devolver el resultado a la IA para que continúe la charla
                currentPrompt = SYSTEM_PROMPTS.TOOL_RESULT_FEEDBACK(toolName, toolResult) + "\n\nAnaliza este resultado y responde al usuario. Si ya terminaste, emite 'task_complete'.";
              } catch (toolError) {
                if (toolError.message.includes('[USER_DENIED]')) {
                  console.log(`\n  ⛔ [ACCIÓN CANCELADA] Herramienta denegada por el usuario.`);
                  break;
                }

                let fullToolError = toolError.message;
                if (toolError.stdout && toolError.stdout.toString().trim()) fullToolError += `\n--- STDOUT ---\n${toolError.stdout.toString().trim()}`;
                if (toolError.stderr && toolError.stderr.toString().trim()) fullToolError += `\n--- STDERR ---\n${toolError.stderr.toString().trim()}`;

                console.log(`\n  ❌ [ERROR EN HERRAMIENTA] La herramienta "${toolName}" falló.\n     ${fullToolError.substring(0, 400)}...`);

                currentPrompt = `[SISTEMA: ERROR EN HERRAMIENTA]\n${fullToolError}\nPor favor analiza el error e intenta nuevamente, o emite 'task_complete' para cancelar.`;
              }
            } else {
              // Si la IA respondió con texto conversacional normal y sin herramientas, terminamos el turno
              break;
            }
          }

          this.currentState = new AgentState({
            runId,
            objective: initialPrompt,
            status: 'SUCCESS'
          });

          if (this.checkpointManager) {
            this.checkpointManager.createRun(runId, initialPrompt);
            this.checkpointManager.markRunCompleted(runId, 'SUCCESS');
          }
          return;
        }
      }

      if (existingState) {
        this.currentState = existingState;
        console.log(`  [🔄 REANUDACIÓN] Retomando tarea (Paso ${this.currentState.currentStep}) - Estado: ${this.currentState.status}`);

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

        let taskDAG = null;

        // CORRECCIÓN: Evitar generar un DAG con la IA si la instrucción es puramente un comando determinístico.
        if (activeMode === 'DETERMINISTIC') {
          console.log(`\n  ⚡ [SISTEMA] Comando local detectado. Omitiendo planificación de IA...`);
          taskDAG = new TaskDAG([
            { id: 'task_1', description: initialPrompt, dependencies: [] }
          ]);
        } else {
          let planApproved = false;
          let rejectionFeedback = null;

          while (!planApproved) {
            taskDAG = await this.generateTaskDAG(initialPrompt, rejectionFeedback);

            console.log(taskDAG.formatSummary());

            if (!this.repl) {
              planApproved = true;
              break;
            }

            const answer = await this.repl.askQuestion('  ¿Apruebas este plan de trabajo para su ejecución? (Y/n): ');
            const cleanedAnswer = answer.trim().toLowerCase();

            if (['y', 's', ''].includes(cleanedAnswer)) {
              planApproved = true;
              console.log('\n  ✅ [SISTEMA] Plan de trabajo aprobado por el usuario. Iniciando ejecución de tareas...\n');
            } else {
              console.log('\n  ❌ [SISTEMA] Plan rechazado.');
              const reason = await this.repl.askQuestion('  Indica el motivo del rechazo / ajustes requeridos para Gemini: ');
              rejectionFeedback = reason.trim() || 'El plan generado no satisface los requerimientos. Por favor reformula la estrategia.';
              console.log('\n  🔄 Reenviando observaciones a Gemini para generar un nuevo plan...\n');
            }
          }
        }

        this.currentState.dag = taskDAG;
        if (this.checkpointManager) {
          this.checkpointManager.saveCheckpoint(this.currentState);
        }
      }

      while (!this.currentState.dag.isCompleted() && !this.currentState.dag.hasFailed()) {
        const nextTasks = this.currentState.dag.getNextTasks();

        if (nextTasks.length === 0) {
          console.log('  ⚠️ [DAG STUCK] No hay subtareas pendientes con dependencias satisfechas.');

          await this.executeReplan(
            { id: 'DAG_STUCK', description: 'Desbloquear dependencias del DAG' },
            'DAG_STUCK',
            'El grafo de tareas actual se atascó sin poder avanzar en las dependencias.'
          );
          if (this.checkpointManager) this.checkpointManager.saveCheckpoint(this.currentState);
          continue;
        }

        const activeTask = nextTasks[0];
        this.currentState.dag.markInProgress(activeTask.id);
        this.currentState.transition('EXECUTING');
        if (this.checkpointManager) this.checkpointManager.saveCheckpoint(this.currentState);

        console.log(`\n  🚀 [EJECUTANDO SUBTAREA] [${activeTask.id}]: ${activeTask.description}`);

        const decision = this.decisionEngine.classify(activeTask.description);

        if (decision.mode === 'DETERMINISTIC') {
          console.log(`  ⚡ [ENRUTAMIENTO DETERMINÍSTICO] Ejecución local instantánea (Sin IA) -> Herramienta: "${decision.tool}"`);

          try {
            const toolResult = await this.toolRegistry.executeTool(
              decision.tool,
              decision.args,
              { projectRoot: this.projectRoot, repl: this.repl }
            );

            this.currentState.addToolCall(decision.tool, decision.args, toolResult);
            console.log(`  Resultado:`, JSON.stringify(toolResult, null, 2));

            this.currentState.dag.markCompleted(activeTask.id);
            this.currentState.completedSteps.push(activeTask.id);
            console.log(`  ✅ [SUBTAREA COMPLETADA] [${activeTask.id}]`);
          } catch (execErr) {
            if (execErr.message.includes('[USER_DENIED]')) {
              console.log(`\n  ⛔ [ACCIÓN CANCELADA] No se ejecutó el comando por decisión del usuario.`);
              await this.handleSubtaskFailure(
                activeTask,
                'USER_COMMAND_DENIED',
                execErr.message
              );
            } else {
              // 🛠️ FIX: Extraer la salida real de la terminal (stdout/stderr)
              let fullErrorDetails = execErr.message;
              if (execErr.stdout && execErr.stdout.toString().trim()) {
                fullErrorDetails += `\n--- STDOUT ---\n${execErr.stdout.toString().trim()}`;
              }
              if (execErr.stderr && execErr.stderr.toString().trim()) {
                fullErrorDetails += `\n--- STDERR ---\n${execErr.stderr.toString().trim()}`;
              }

              console.error(`  ❌ Error en ejecución determinística:\n${fullErrorDetails}`);

              const errorAnalysis = ErrorAnalyzer.analyze(decision.args.command || '', fullErrorDetails, this.episodicMemory);

              if (errorAnalysis.isKnown) {
                console.log(`  🧠 [AUTOCORRECCIÓN DETERMINÍSTICA] Error conocido detectado: "${errorAnalysis.signature}". Aplicando solución histórica sin IA...`);
                try {
                  execSync(errorAnalysis.solution, { cwd: this.projectRoot, stdio: 'pipe' });
                  console.log(`  ✅ [CORRECCIÓN APLICADA] Se ejecutó: "${errorAnalysis.solution}"`);
                  this.currentState.dag.markCompleted(activeTask.id);
                } catch (fixErr) {
                  await this.handleSubtaskFailure(
                    activeTask,
                    'DETERMINISTIC_FIX_FAILED',
                    `Fallo la corrección determinística: ${fixErr.message}`
                  );
                }
              } else {
                await this.handleSubtaskFailure(
                  activeTask,
                  'DETERMINISTIC_EXECUTION_FAILED',
                  fullErrorDetails
                );
              }
            }
          }

          if (this.checkpointManager) this.checkpointManager.saveCheckpoint(this.currentState);
          continue;
        }

        let impactContextNotice = '';
        const fileMatch = activeTask.description.match(/([a-zA-Z0-9_\-\/]+\.(?:js|ts|jsx|tsx|java|py|json|xml|yml))/i);
        if (fileMatch) {
          const targetFile = fileMatch[1];
          const impact = this.impactAnalyzer.analyze(targetFile);

          if (impact.noticeForLLM) {
            console.log(`  🎯 [ANÁLISIS DE IMPACTO] "${targetFile}" afecta a ${impact.totalImpacted} archivo(s) consumidores/tests.`);
            impactContextNotice = `\n\n${impact.noticeForLLM}`;
          }
        }

        let subtaskPrompt = SYSTEM_PROMPTS.SUBTASK_ACTIVE(
          activeTask.id,
          activeTask.description,
          this.currentState.objective,
          impactContextNotice
        );

        while (subtaskPrompt) {
          try {
            global.isProcessing = true;

            if (this.episodicMemory && subtaskPrompt && !subtaskPrompt.includes('SISTEMA: FEEDBACK')) {
              const keywords = activeTask.description.split(' ').slice(0, 3).join('%');
              const pastExperiences = this.episodicMemory.findPastExperience(keywords);

              if (pastExperiences && pastExperiences.length > 0) {
                subtaskPrompt += SYSTEM_PROMPTS.SUBTASK_EPISODIC_MEMORY(pastExperiences);
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

              if (toolName === 'task_complete') {
                const statusStr = String(args.status || 'SUCCESS').toUpperCase();
                let isSuccess = statusStr === 'SUCCESS' || !statusStr.includes('FAIL');

                if (isSuccess && this.currentState.filesModified.length > 0) {
                  const check = Verifier.verifyModifiedFiles(this.projectRoot, this.currentState.filesModified);
                  if (!check.valid) {
                    console.log(`\n  ❌ [VERIFICACIÓN FALLIDA] ${check.reason}`);
                    isSuccess = false;
                    args.reason = check.reason;
                  }
                }

                if (isSuccess) {
                  this.currentState.dag.markCompleted(activeTask.id);
                  this.currentState.completedSteps.push(activeTask.id);
                  console.log(`\n  ✅ [SUBTAREA COMPLETADA CON ÉXITO] [${activeTask.id}]`);
                  console.log(`     📄 Resumen: ${args.summary || 'Ejecución finalizada'}\n`);
                  subtaskPrompt = null;
                  break;
                } else {
                  console.log(`\n  ❌ [SUBTAREA FALLIDA REPORTADA POR IA] [${activeTask.id}]`);
                  console.log(`     ⚠️ Motivo: ${args.reason || args.summary || 'Error reportado por la IA'}`);

                  await this.handleSubtaskFailure(
                    activeTask,
                    'SUBTASK_FAILED_REPORTED',
                    `La IA indicó fallo en la subtarea: ${args.reason || args.summary}`
                  );
                  subtaskPrompt = null;
                  break;
                }
              }

              if (toolName === 'execute_command') {
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

                  // 🛠️ MEJORA DE VISIBILIDAD: Imprimir qué pasó realmente
                  if (toolName === 'write_file' && args.filePath) {
                    this.currentState.addFileModified(args.filePath);
                    console.log(`  ✅ [SISTEMA] Archivo modificado en disco: ${args.filePath}`);
                  } else if (toolName === 'execute_command') {
                    console.log(`  ✅ [SISTEMA] Comando ejecutado con éxito.`);
                    if (toolResult.output) {
                      const outSnippet = toolResult.output.trim().substring(0, 400);
                      console.log(`     Salida:\n${outSnippet}${toolResult.output.length > 400 ? '\n...[truncado]' : ''}`);
                    }
                  } else if (toolName === 'read_files' && Array.isArray(args.paths)) {
                    args.paths.forEach(p => this.currentState.addFileRead(p));
                    console.log(`  📖 [SISTEMA] Archivos leídos: ${args.paths.join(', ')}`);
                  }

                  this.currentState.transition('VERIFYING');
                  this.currentState.currentStep++;
                  if (this.checkpointManager) this.checkpointManager.saveCheckpoint(this.currentState);

                  followUpContext = SYSTEM_PROMPTS.TOOL_RESULT_FEEDBACK(toolName, toolResult);
                } catch (toolError) {
                  if (toolError.message.includes('[USER_DENIED]')) {
                    console.log(`\n  ⛔ [ACCIÓN CANCELADA] No se ejecutó la herramienta por decisión del usuario.`);

                    await this.handleSubtaskFailure(
                      activeTask,
                      'USER_DENIED',
                      toolError.message
                    );
                    subtaskPrompt = null;
                    break;
                  }

                  // 🛠️ Extraer stdout/stderr reales
                  let fullToolError = toolError.message;
                  if (toolError.stdout && toolError.stdout.toString().trim()) {
                    fullToolError += `\n--- STDOUT ---\n${toolError.stdout.toString().trim()}`;
                  }
                  if (toolError.stderr && toolError.stderr.toString().trim()) {
                    fullToolError += `\n--- STDERR ---\n${toolError.stderr.toString().trim()}`;
                  }

                  // 🛠️ MEJORA DE CONTROL: Mostrar el error y frenar a la IA
                  console.log(`\n  ❌ [ERROR EN HERRAMIENTA] La herramienta "${toolName}" falló.`);
                  const errSnippet = fullToolError.trim().substring(0, 800);
                  console.log(`     Detalles del entorno:\n${errSnippet}${fullToolError.length > 800 ? '\n...[truncado]' : ''}\n`);

                  let allowAutoCorrect = true;
                  if (this.repl) {
                    const fixAnswer = await this.repl.askQuestion('  ¿Deseas que la IA intente autocorregir este error? (Y/n): ');
                    if (fixAnswer.trim().toLowerCase() === 'n') {
                      allowAutoCorrect = false;
                    }
                  }

                  if (!allowAutoCorrect) {
                    console.log(`\n  ⛔ Autocorrección cancelada por el usuario.`);
                    await this.handleSubtaskFailure(activeTask, 'USER_ABORTED_AUTOCORRECT', fullToolError);
                    subtaskPrompt = null;
                    break;
                  }

                  console.log(`  🔄 [SISTEMA] Reenviando logs del error a Gemini para generar un parche...`);

                  if (this.episodicMemory && toolName === 'execute_command') {
                    this.episodicMemory.recordFailure(args.command, fullToolError, "Fallo al ejecutar en terminal");
                  }
                  this.currentState.addError(fullToolError);

                  followUpContext = Reflector.createFeedback({
                    command: args.command || '',
                    error: fullToolError,
                    isRejected: false,
                    episodicMemory: this.episodicMemory
                  });
                }
              }
            } else {
              const isAttemptingWrite = /write_file/i.test(response.text);
              const isAttemptingExecute = /execute_command/i.test(response.text);

              if (isAttemptingWrite) {
                console.log('  ⚠️ [AGENTE] Error de sintaxis en write_file. Exigiendo corrección...');
                subtaskPrompt = SYSTEM_PROMPTS.WRITE_FILE_PROTOCOL_ERROR;
                continue;
              } else if (isAttemptingExecute) {
                console.log('  ⚠️ [AGENTE] Error de sintaxis en execute_command. Exigiendo corrección...');
                subtaskPrompt = `[SISTEMA: ERROR DE SINTAXIS EN EXECUTE_COMMAND]\nTu respuesta no se pudo evaluar debido a un error de sintaxis JSON o falta del bloque Markdown. Emite de nuevo el objeto 'execute_command' con sintaxis válida.`;
                continue;
              }

              subtaskPrompt = SYSTEM_PROMPTS.TASK_COMPLETE_PROTOCOL_REQUIRED(activeTask.id);
            }

            if (followUpContext) {
              subtaskPrompt = SYSTEM_PROMPTS.RUNTIME_FEEDBACK_CONTINUE(followUpContext, activeTask.id);
            }

          } catch (err) {
            console.error('\n  Error en Agent Runtime:', err.message);

            await this.handleSubtaskFailure(
              activeTask,
              'SUBTASK_FAILED_EXCEPTION',
              `La subtarea [${activeTask.id}] falló con el error: ${err.message}`
            );
            subtaskPrompt = null;
            break;
          }
        }
      }

      if (this.currentState.dag.isCompleted()) {
        this.currentState.transition('SUCCESS');
        if (this.checkpointManager) this.checkpointManager.markRunCompleted(this.currentState.runId, 'SUCCESS');

        // VERIFICACIÓN DE HONESTIDAD: ¿Hubo errores o tareas omitidas en el camino?
        if (this.currentState.skippedTasks && this.currentState.skippedTasks.length > 0) {
          console.log('\n  ⚠️ [EJECUCIÓN FINALIZADA] El flujo de tareas terminó, pero decidiste omitir las siguientes subtareas:');
          this.currentState.skippedTasks.forEach(task => {
            console.log(`     - [${task.id}]: ${task.description}`);
          });
          console.log(); // Salto de línea final
        } else {
          console.log('\n  🎉 [ÉXITO GLOBAL] Todas las subtareas del DAG han sido completadas exitosamente.\n');
        }

        if (this.logger && typeof this.logger.saveDatasetTrace === 'function') {
          this.logger.saveDatasetTrace(this.currentState);
        }
      }
    } finally {
      global.isProcessing = false;
    }
  }
}

module.exports = AgentRuntime;