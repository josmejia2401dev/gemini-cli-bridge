const PolicyEngine = require('../tools/policyEngine');
const Verifier = require('./verifier');
const Reflector = require('./reflector');
const OutputParser = require('../utils/outputParser');

class AgentRuntime {
  constructor({ modelRouter, toolRegistry, projectRoot, repl, logger, episodicMemory }) {
    this.modelRouter = modelRouter;
    this.toolRegistry = toolRegistry;
    this.policyEngine = new PolicyEngine();
    this.projectRoot = projectRoot;
    this.repl = repl;
    this.logger = logger;
    this.episodicMemory = episodicMemory;

    this.state = {
      taskId: null,
      currentPrompt: null,
      lastFailedCommand: null,
      isAutonomous: true
    };
  }

  setProjectRoot(newRoot) {
    this.projectRoot = newRoot;
  }

  async runLoop(initialPrompt, fileToUpload = null) {
    let currentPrompt = initialPrompt;
    let currentFile = fileToUpload;

    while (currentPrompt) {
      try {
        global.isProcessing = true;
        console.log('  Procesando con Gemini (Agent Runtime V2 - JS Object Mode)...');

        // --- 🧠 RECUPERACIÓN DE MEMORIA EPISÓDICA ---
        if (this.episodicMemory && currentPrompt && !currentPrompt.includes('SISTEMA: FEEDBACK')) {
          const keywords = currentPrompt.split(' ').slice(0, 3).join('%');
          const pastExperiences = this.episodicMemory.findPastExperience(keywords);

          if (pastExperiences && pastExperiences.length > 0) {
            console.log(`  [🧠 MEMORIA ACTIVA] Se encontraron ${pastExperiences.length} lecciones previas para esta tarea.`);

            let memoryContext = `\n[SISTEMA - MEMORIA EPISÓDICA]: Antes de actuar, ten en cuenta tus errores pasados en tareas similares para NO repetirlos:\n`;
            pastExperiences.forEach((exp, idx) => {
              memoryContext += `- Intento fallido #${idx + 1}: Ejecutaste '${exp.command}'. Error: ${exp.error_output}.\n`;
              if (exp.user_feedback) memoryContext += `  Feedback del usuario: ${exp.user_feedback}\n`;
            });

            currentPrompt += `\n${memoryContext}`;
          }
        }

        const response = await this.modelRouter.generate({
          prompt: currentPrompt,
          fileToUpload: currentFile
        });

        global.isProcessing = false;
        if (global.abortLoop) {
          console.log('  [SISTEMA] Bucle y ejecución cancelados por el usuario.');
          break;
        }

        currentFile = null;

        console.log('\n-------------------- IA --------------------');
        console.log(response.text);
        console.log('--------------------------------------------\n');

        let followUpContext = '';
        let isToolCall = false;
        let parsedObject = null;
        let parseError = '';

        // DELEGAMOS EL PARSEO Y LA LIMPIEZA A NUESTRO NUEVO MÓDULO
        const parseResult = OutputParser.parseToolCall(response.text);

        if (parseResult.success) {
          parsedObject = parseResult.data;

          // Verificamos si la herramienta solicitada realmente existe en el sistema
          if (this.toolRegistry.getTool(parsedObject.tool)) {
            isToolCall = true;
          } else {
            parseError = `La herramienta '${parsedObject.tool}' no existe en el registro.`;
          }
        } else {
          parseError = parseResult.error;
        }

        // --- EJECUCIÓN O FEEDBACK ---
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
              followUpContext = Reflector.createFeedback({
                command: args.command,
                error: verification.reason,
                isRejected: false
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
              followUpContext = `[SISTEMA: Resultado de ${toolName}]:${JSON.stringify(toolResult)}`;
            } catch (toolError) {
              if (this.episodicMemory && toolName === 'execute_command') {
                this.episodicMemory.recordFailure(args.command, toolError.message, "Fallo al ejecutar en terminal");
              }
              followUpContext = `[SISTEMA: Error ejecutando ${toolName}]:${toolError.message}`;
            }
          }
        } else {
          // GESTIÓN DE DESVIACIONES Y ERRORES SINTÁCTICOS
          const lowerText = response.text.toLowerCase();
          const attemptedPython = lowerText.includes('import subprocess') || lowerText.includes('import os') || lowerText.includes('os.listdir');
          const attemptedTool = lowerText.includes('tool:') || lowerText.includes('"tool":') || lowerText.includes('execute_command') || lowerText.includes('write_file') || lowerText.includes('read_files');

          if (attemptedPython) {
            console.log(`  [⚠️ DESVIACIÓN DETECTADA] Gemini intentó usar Python Web en lugar de JS Objects.`);
            followUpContext = `[SISTEMA ERROR: HERRAMIENTA INVÁLIDA]\nProhibido usar scripts de Python o intérprete web. Emite ÚNICAMENTE el objeto JS estructurado correspondiente.`;
          } else if (attemptedTool) {
            console.log(`  [⚠️ ERROR DE SINTAXIS JS] Objeto JS mal formado. Motivo: ${parseError}`);
            followUpContext = `[SISTEMA ERROR CRÍTICO: Objeto JS Mal Formado]
Falló la evaluación de tu respuesta con el error: "${parseError}".

CAUSA EXACTA: Usaste comillas dobles (") o simples (') y rompiste la sintaxis al anidarlas.

SOLUCIÓN OBLIGATORIA: Usa SIEMPRE backticks/comillas invertidas (\`) para TODOS los valores de texto.
Ejemplo correcto: command: \`git commit -m "mensaje"\`

REGLA ESTRICTA: Corrige el error y responde ÚNICAMENTE con el Objeto JS. Cero texto conversacional.`;
          } else {
            // Conversación normal sin intento de herramienta
            currentPrompt = null;
            break;
          }
        }

        if (followUpContext) {
          currentPrompt = `[SISTEMA: FEEDBACK AGENT RUNTIME]\n${followUpContext}\n\nContinúa con la tarea basándote en esta nueva información.`;
        } else {
          currentPrompt = null;
        }

      } catch (err) {
        console.error('\n  Error en Agent Runtime:', err.message);
        if (this.logger) this.logger.error(`[RUNTIME_ERROR] ${err.message}`);
        break;
      }
    }
  }
}

module.exports = AgentRuntime;