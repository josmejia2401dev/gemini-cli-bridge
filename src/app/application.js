const fs = require('fs');
const path = require('path');

const REPL = require('../interfaces/cli/repl');
const CommandDispatcher = require('../interfaces/core/commandDispatcher');
const LLMFactory = require('../infrastructure/llm/llmFactory');

const ModelRouter = require('../infrastructure/llm/modelRouter');
const ToolRegistry = require('../infrastructure/tools/registry');
const AgentRuntime = require('../domain/agent/runtime');
const CheckpointManager = require('../infrastructure/persistence/checkpoint');
const MemoryDatabase = require('../infrastructure/persistence/db');
const OperationalMemory = require('../infrastructure/persistence/operational');
const EpisodicMemory = require('../infrastructure/persistence/episodic');
const ExecutionLogger = require('../shared/observability/logger');
const paths = require('../shared/config/paths');
const SYSTEM_PROMPTS = require('../shared/config/prompts');

class Application {
  constructor() {
    this.chatUrlFile = paths.CHAT_URL_FILE;
    this.repoPathFile = paths.REPO_PATH_FILE;
    this.commandsFile = path.join(__dirname, '../../commands.json');
    this.sessionDir = paths.SESSION_DIR;
    this.dynamicCommands = this.loadDynamicCommands();
  }

  displayBanner() {
    let pkg = { name: 'gemini-cli-bridge', version: '3.0.0', author: 'N/A' };

    if (fs.existsSync(paths.PACKAGE_JSON_FILE)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(paths.PACKAGE_JSON_FILE, 'utf-8'));
        pkg.name = parsed.name || pkg.name;
        pkg.version = parsed.version || pkg.version;
        pkg.author = typeof parsed.author === 'object' ? (parsed.author.name || 'N/A') : (parsed.author || 'N/A');
      } catch (e) {
        // Fallback silencioso si falla la lectura del package.json
      }
    }

    if (fs.existsSync(paths.BANNER_FILE)) {
      const bannerText = fs.readFileSync(paths.BANNER_FILE, 'utf-8');
      console.log(`\n${bannerText}`);
    } else {
      console.log('\n  GEMINI CLI BRIDGE');
    }

    console.log('===================================================================');
    console.log(`  📦 Nombre:  ${pkg.name}`);
    console.log(`  🏷️  Versión: v${pkg.version}`);
    console.log(`  👤 Autor:   ${pkg.author}`);
    console.log('===================================================================\n');
  }

  loadDynamicCommands() {
    if (fs.existsSync(this.commandsFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.commandsFile, 'utf-8'));
      } catch (e) {
        console.error('  Error al leer commands.json.');
      }
    }
    return {};
  }

  async resolveProjectRoot(repl) {
    let projectRoot = process.argv[2];

    if (!projectRoot && fs.existsSync(this.repoPathFile)) {
      const savedPath = fs.readFileSync(this.repoPathFile, 'utf-8').trim();
      if (fs.existsSync(path.resolve(savedPath))) projectRoot = savedPath;
    }

    while (!projectRoot || !fs.existsSync(path.resolve(projectRoot))) {
      if (projectRoot) console.log(`  La ruta "${projectRoot}" es inválida.`);
      const inputPath = await repl.askQuestion('  Ingresa la ruta del repositorio (Enter para usar actual "."): ');
      projectRoot = inputPath.trim() || '.';
    }

    projectRoot = path.resolve(projectRoot);
    fs.writeFileSync(this.repoPathFile, projectRoot, 'utf-8');
    console.log(`  Repositorio vinculado: ${projectRoot}\n`);
    return projectRoot;
  }

  async resolveTargetChatUrl(repl) {
    let targetUrl = 'https://gemini.google.com/app';
    let isNewChat = false;

    if (fs.existsSync(this.chatUrlFile)) {
      const savedUrl = fs.readFileSync(this.chatUrlFile, 'utf-8').trim();
      if (savedUrl.includes('/app/')) {
        const chatsFile = paths.SAVED_CHATS_FILE;
        let savedChats = {};
        if (fs.existsSync(chatsFile)) {
          try { savedChats = JSON.parse(fs.readFileSync(chatsFile, 'utf-8')); }
          catch (e) { console.error('  Error al leer los chats guardados.'); }
        }

        const chatNames = Object.keys(savedChats);
        const hasSavedChats = chatNames.length > 0;

        console.log('  Se detectó actividad previa.');
        console.log('  [1] Retomar último chat activo');
        console.log('  [2] Iniciar Nuevo chat');

        // Asignación dinámica de opciones para evitar colisión de números
        let loadChatOption = null;
        let exitOption = '3';

        if (hasSavedChats) {
          loadChatOption = '3';
          exitOption = '4';
          console.log('  [3] Cargar un chat guardado');
          console.log('  [4] Salir');
        } else {
          console.log('  [3] Salir');
        }

        const choice = (await repl.askQuestion('  Selecciona una opción: ')).trim();

        if (choice === '1') {
          targetUrl = savedUrl;
        } else if (choice === '2') {
          targetUrl = 'https://gemini.google.com/app';
          isNewChat = true;
        } else if (loadChatOption && choice === loadChatOption) {
          console.log('\n  [CHATS GUARDADOS]');
          chatNames.forEach((name, index) => {
            console.log(`  [${index + 1}] ${name}`);
          });

          const chatChoice = await repl.askQuestion('  Ingresa el número del chat: ');
          const selectedIndex = parseInt(chatChoice.trim()) - 1;

          if (selectedIndex >= 0 && selectedIndex < chatNames.length) {
            const selectedName = chatNames[selectedIndex];
            targetUrl = savedChats[selectedName];
            fs.writeFileSync(this.chatUrlFile, targetUrl, 'utf-8');
            console.log(`  [SISTEMA] Se cargará el chat: "${selectedName}"`);
          } else {
            console.log('  [!] Opción inválida. Iniciando un nuevo chat por defecto.');
            isNewChat = true;
          }
        } else if (choice === exitOption) {
          console.log('  Cerrando aplicación...');
          repl.close();
          process.exit(0);
        } else {
          console.log('  [!] Opción no reconocida. Iniciando un nuevo chat por defecto.');
          isNewChat = true;
        }
      }
    } else {
      isNewChat = true;
    }

    return { targetUrl, isNewChat };
  }

  setupSigintHandler(repl, llmClient) {
    global.isProcessing = false;
    global.abortLoop = false;
    let sigintCount = 0;

    repl.rl.on('SIGINT', async () => {
      if (global.isProcessing) {
        console.log('\n  🛑 [SISTEMA] Interrumpiendo IA. Deteniendo generación...');
        global.abortLoop = true;
        await llmClient.stopGeneration();
      } else {
        sigintCount++;
        if (sigintCount === 1) {
          console.log('\n  ℹ️ Presiona Ctrl+C de nuevo o escribe /exit para salir.');
          setTimeout(() => { sigintCount = 0; }, 2000);
        } else {
          console.log('\n  Cerrando aplicación...');
          try { await llmClient.close(); } catch (e) { }
          repl.close();
          process.exit(0);
        }
      }
    });
  }

  async start() {
    this.displayBanner();
    const repl = new REPL();
    const logger = new ExecutionLogger();
    let projectRoot = await this.resolveProjectRoot(repl);

    const { targetUrl, isNewChat } = await this.resolveTargetChatUrl(repl);

    console.log('\n  Iniciando motor de IA (Playwright Provider)...');

    const llmClient = LLMFactory.createClient(process.env.LLM_PROVIDER || 'PLAYWRIGHT', {
      sessionDir: this.sessionDir,
      chatUrlFile: this.chatUrlFile
    });
    await llmClient.connect(targetUrl);

    const modelRouter = new ModelRouter(llmClient);
    const toolRegistry = new ToolRegistry();
    const dbConnection = new MemoryDatabase();
    const checkpointManager = new CheckpointManager(dbConnection);
    const operationalMemory = new OperationalMemory(dbConnection);
    const episodicMemory = new EpisodicMemory(dbConnection);

    const agentRuntime = new AgentRuntime({
      modelRouter,
      toolRegistry,
      projectRoot,
      repl,
      logger,
      episodicMemory,
      checkpointManager
    });

    const geminiAdapter = llmClient.client;
    const dispatcher = new CommandDispatcher(geminiAdapter, projectRoot, this.dynamicCommands);

    console.log('\n===============================================================');
    console.log(`   Agente CLI V3 Listo. Usa "/help" para comandos o "/paste".`);
    console.log('===============================================================\n');

    // Inicialización de reglas en chats nuevos
    if (isNewChat || targetUrl === 'https://gemini.google.com/app') {
      console.log('  [SISTEMA] Inicializando nuevo chat con reglas globales...');
      const response = await modelRouter.generate({ prompt: SYSTEM_PROMPTS.INIT_NEW_CHAT });
      console.log('\n-------------------- IA --------------------');
      console.log(response.text);
      console.log('--------------------------------------------\n');
    }

    process.on('unhandledRejection', (reason) => {
      if (reason && (reason.code === 'ABORT_ERR' || reason.name === 'AbortError')) return;
      if (reason && reason.message && reason.message.includes('closed')) return;
      console.error('\n  [!] Error no controlado:', reason?.message || reason);
    });

    this.setupSigintHandler(repl, llmClient);

    // Comprobación de ejecuciones pendientes al arrancar la CLI
    const pendingState = checkpointManager.getPendingRun();
    if (pendingState) {
      console.log('\n  ⚠️ [SISTEMA] Se detectó una tarea anterior pendiente o interrumpida:');
      console.log(`     - Run ID: ${pendingState.runId}`);
      console.log(`     - Objetivo: "${pendingState.objective}"`);
      console.log(`     - Estado: ${pendingState.status} (Paso ${pendingState.currentStep})\n`);

      const resumeChoice = await repl.askQuestion('  ¿Deseas reanudar esta tarea? (Y/n): ');
      if (resumeChoice.trim().toLowerCase() !== 'n') {
        logger.currentExecutionId = pendingState.runId;
        await agentRuntime.runLoop(pendingState.objective, null, pendingState);
      } else {
        checkpointManager.markRunCompleted(pendingState.runId, 'CANCELLED');
        console.log('  [SISTEMA] Tarea anterior descartada.\n');
      }
    }

    // Bucle Principal de la Consola REPL
    while (true) {
      global.abortLoop = false;
      let instruction = await repl.askQuestion('\nGemini Dev V3 > ');

      if (instruction.trim() === '/paste') {
        instruction = await repl.askMultiline();
      }

      const dispatchResult = await dispatcher.dispatch(instruction, repl);
      if (dispatchResult.newRoot) {
        projectRoot = dispatchResult.newRoot;
        agentRuntime.setProjectRoot(projectRoot);
      }

      if (dispatchResult.skip) continue;

      logger.startExecution();
      operationalMemory.setTask(logger.currentExecutionId, dispatchResult.finalPrompt);

      await agentRuntime.runLoop(dispatchResult.finalPrompt);
    }
  }
}

module.exports = Application;