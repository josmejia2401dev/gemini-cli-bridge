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
const LoopDetector = require('./loopDetector');
const Replanner = require('./replanner');
const Tracer = require('../../shared/observability/tracer');
const MetricsCollector = require('../../shared/observability/metrics');

class AgentRuntime {
  constructor({ modelRouter, toolRegistry, projectRoot, repl, logger, episodicMemory, checkpointManager }) {
    this.modelRouter = modelRouter;
    this.toolRegistry = toolRegistry;
    this.policyEngine = new PolicyEngine();
    this.projectRoot = projectRoot;
    this.repl = repl;
    this.logger = logger;
    this.episodicMemory = episodicMemory;
    this.checkpointManager = checkpointManager;

    this.currentState = null;
    this.decomposer = new TaskDecomposer(modelRouter);
    this.decisionEngine = new ExecutionDecisionEngine();
    this.impactAnalyzer = new ImpactAnalysis(projectRoot);
    this.loopDetector = new LoopDetector();
    this.replanner = new Replanner(modelRouter);

    // ⚡ TELEMETRÍA Y OBSERVABILIDAD
    this.tracer = new Tracer();
    this.metrics = new MetricsCollector();
  }

  setProjectRoot(newRoot) {
    this.projectRoot = newRoot;
    this.impactAnalyzer = new ImpactAnalysis(newRoot);
  }

  async runLoop(initialPrompt, fileToUpload = null, existingState = null) {
    let currentFile = fileToUpload;
    const runId = this.logger?.currentExecutionId || `run_${Date.now()}`;
    this.tracer.reset();
    this.metrics.reset();

    if (existingState) {
      this.currentState = existingState;
      console.log(`  [🔄 REANUDACIÓN] Retomando tarea (Paso ${this.currentState.currentStep}) - Estado: ${this.currentState.status}`);

      // 🛡️ GUARDIA V3: Detectar si el DAG está vacío en Map (.size) o Array (.length)
      const taskCount = this.currentState.dag?.tasks?.size
        ?? this.currentState.dag?.tasks?.length
        ?? 0;

      if (taskCount === 0 || this.currentState.status === 'PLANNING') {
        console.log('  [SISTEMA] Tarea reanudada en PLANNING o sin subtareas. Generando plan con Gemini...');
        const spanDecompose = this.tracer.startSpan('TASK_DECOMPOSE');
        const taskDAG = await this.decomposer.decompose(this.currentState.objective || initialPrompt);
        this.tracer.endSpan(spanDecompose);

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

      const spanDecompose = this.tracer.startSpan('TASK_DECOMPOSE');
      const taskDAG = await this.decomposer.decompose(initialPrompt);
      this.tracer.endSpan(spanDecompose);

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
        this.currentState.transition('REFLECTING');
        break;
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
        const spanDet = this.tracer.startSpan('DETERMINISTIC_EXEC', { tool: decision.tool });
        const startTime = Date.now();

        try {
          const toolResult = await this.toolRegistry.executeTool(
            decision.tool,
            decision.args,
            { projectRoot: this.projectRoot, repl: this.repl }
          );

          const duration = Date.now() - startTime;
          this.tracer.endSpan(spanDet, { success: true });
          this.metrics.recordToolCall(decision.tool, duration, true);

          this.currentState.addToolCall(decision.tool, decision.args, toolResult);
          console.log(`  Resultado:`, JSON.stringify(toolResult, null, 2));

          activeTask.status = 'completed';
          this.currentState.dag.updateStatus(activeTask.id, 'completed');
          this.currentState.completedSteps.push(activeTask.id);
          console.log(`  ✅ [SUBTAREA COMPLETADA] [${activeTask.id}]`);
        } catch (execErr) {
          const duration = Date.now() - startTime;
          this.tracer.endSpan(spanDet, { success: false, error: execErr.message });
          this.metrics.recordToolCall(decision.tool, duration, false);

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
        const spanImpact = this.tracer.startSpan('IMPACT_ANALYSIS');
        const impact = this.impactAnalyzer.analyze(targetFile);
        this.tracer.endSpan(spanImpact);

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

          const spanLLM = this.tracer.startSpan('LLM_GENERATE');
          const llmStartTime = Date.now();

          const response = await this.modelRouter.generate({
            prompt: subtaskPrompt,
            fileToUpload: currentFile
          });

          const llmDuration = Date.now() - llmStartTime;
          this.tracer.endSpan(spanLLM);
          this.metrics.recordLlmCall(llmDuration);

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

          const actionSig = isToolCall
            ? `${parsedObject.tool}:${JSON.stringify(parsedObject.arguments)}`
            : 'no_tool_response';

          const snapshot = {
            errorCount: this.currentState.errors.length,
            evidencePassedCount: this.currentState.evidence.filter(e => e.passed).length,
            filesModifiedCount: this.currentState.filesModified.length
          };

          const loopCheck = this.loopDetector.registerStep(actionSig, snapshot);

          if (loopCheck.loopDetected) {
            console.log(`\n  🛑 [DETERMINISTIC LOOP DETECTED] Motivo: ${loopCheck.reason}`);
            console.log(`     Detalles: ${loopCheck.details}`);

            this.currentState.transition('REPLAN');
            this.metrics.recordLoopRecovery();

            const spanReplan = this.tracer.startSpan('REPLANNER');
            const newDAG = await this.replanner.replan({
              userObjective: this.currentState.objective,
              failedTask: activeTask,
              loopReason: loopCheck.reason,
              loopDetails: loopCheck.details,
              errors: this.currentState.errors,
              currentDAG: this.currentState.dag
            });
            this.tracer.endSpan(spanReplan);

            this.currentState.dag = newDAG;
            this.loopDetector.reset();

            console.log('\n  🔄 [REPLANIFICACIÓN COMPLETADA] Nueva estrategia asignada:');
            console.log(this.currentState.dag.formatSummary());

            if (this.checkpointManager) this.checkpointManager.saveCheckpoint(this.currentState);

            subtaskPrompt = null;
            break;
          }

          if (isToolCall) {
            const toolName = parsedObject.tool;
            const args = parsedObject.arguments || {};

            console.log(`\n  [⚡ TOOL RUNTIME (JS MODE)] Herramienta solicitada: "${toolName}"`);

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
              const spanTool = this.tracer.startSpan('TOOL_EXECUTION', { tool: toolName });
              const toolStartTime = Date.now();

              try {
                const toolResult = await this.toolRegistry.executeTool(
                  toolName,
                  args,
                  { projectRoot: this.projectRoot, repl: this.repl }
                );

                const toolDuration = Date.now() - toolStartTime;
                this.tracer.endSpan(spanTool, { success: true });
                this.metrics.recordToolCall(toolName, toolDuration, true);

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
                const toolDuration = Date.now() - toolStartTime;
                this.tracer.endSpan(spanTool, { success: false, error: toolError.message });
                this.metrics.recordToolCall(toolName, toolDuration, false);

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
            console.log(`  🔎 [BARRERA DE EVIDENCIAS] Gemini declaró haber terminado la subtarea [${activeTask.id}]. Verificando evidencias determinísticas...`);

            const requiredEvidences = [];
            for (const file of this.currentState.filesModified) {
              requiredEvidences.push({ type: 'file_exists', target: file });
            }

            if (activeTask.description.toLowerCase().includes('test') || activeTask.description.toLowerCase().includes('prueba')) {
              requiredEvidences.push({ type: 'command_pass', target: 'npm test' });
            }

            const spanEvidence = this.tracer.startSpan('EVIDENCE_AUDIT');
            const evidenceAudit = await Verifier.verifyEvidences(this.projectRoot, requiredEvidences);
            this.tracer.endSpan(spanEvidence, { success: evidenceAudit.success });

            if (evidenceAudit.success) {
              activeTask.status = 'completed';
              this.currentState.dag.updateStatus(activeTask.id, 'completed');
              this.currentState.completedSteps.push(activeTask.id);
              console.log(`  ✅ [SUBTAREA COMPLETADA Y AUDITADA] [${activeTask.id}]: Evidencias superadas (${evidenceAudit.passedCount}/${evidenceAudit.total}).`);
              subtaskPrompt = null;
              break;
            } else {
              console.log(`  ⛔ [BARRERA DE EVIDENCIAS BLOQUEADA] Se bloqueó la finalización. Pruebas fallidas: ${evidenceAudit.failures.length}`);
              this.currentState.transition('REFLECTING');

              let failureDetails = evidenceAudit.failures.map(f => `- ${f.type} en '${f.target}': ${f.details}`).join('\n');

              followUpContext = `[SISTEMA ERROR: EVIDENCIAS OBLIGATORIAS NO SUPERADAS]\nAfirmaste haber terminado la subtarea, pero las siguientes comprobaciones determinísticas FALLARON:\n${failureDetails}\n\nNO puedes concluir la subtarea hasta resolver estos errores y asegurarte de que el código compila y pasa las pruebas.`;
            }
          }

          if (followUpContext) {
            subtaskPrompt = `[SISTEMA: FEEDBACK AGENT RUNTIME]\n${followUpContext}\n\nContinúa con la subtarea [${activeTask.id}].`;
          }

        } catch (err) {
          console.error('\n  Error en Agent Runtime:', err.message);
          activeTask.status = 'failed';
          this.currentState.dag.updateStatus(activeTask.id, 'failed');
          this.currentState.addError(err.message);
          this.currentState.transition('REFLECTING');
          if (this.checkpointManager) this.checkpointManager.saveCheckpoint(this.currentState);
          break;
        }
      }
    }

    if (this.currentState.dag.isCompleted()) {
      this.currentState.transition('SUCCESS');
      if (this.checkpointManager) this.checkpointManager.markRunCompleted(this.currentState.runId, 'SUCCESS');

      const tracerSummary = this.tracer.getSummary();
      const metricsSummary = this.metrics.getSummary();

      console.log('\n  🎉 [ÉXITO GLOBAL] Todas las subtareas del DAG han sido completadas y auditadas exitosamente.');
      console.log('  📊 [TELEMETRÍA Y MÉTRICAS DE EJECUCIÓN]');
      console.log(`     - Llamadas a IA: ${metricsSummary.llmCalls} (Latencia media: ${metricsSummary.avgLlmLatencyMs} ms)`);
      console.log(`     - Llamadas a Herramientas: ${metricsSummary.totalToolCalls} (Éxito: ${metricsSummary.toolSuccessRate}, Latencia media: ${metricsSummary.avgToolLatencyMs} ms)`);
      console.log(`     - Recuperaciones de Bucle: ${metricsSummary.loopRecoveries}\n`);

      if (this.logger && typeof this.logger.saveDatasetTrace === 'function') {
        this.logger.saveDatasetTrace(this.currentState, { tracerSummary, metricsSummary });
      }
    }
  }
}

module.exports = AgentRuntime;