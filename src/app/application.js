const FileSystemUtils = require('../shared/utils/fileSystemUtils');

const REPL = require('../interfaces/cli/repl');
const LLMFactory = require('../infrastructure/llm/llmFactory');

const ModelRouter = require('../infrastructure/llm/modelRouter');
const ToolRegistry = require('../infrastructure/tools/registry');
const AgentRuntime = require('../domain/agent/runtime');
const ExecutionDecisionEngine = require('../domain/agent/decisionEngine');
const CheckpointManager = require('../infrastructure/persistence/checkpoint');
const MemoryDatabase = require('../infrastructure/persistence/db');
const EpisodicMemory = require('../infrastructure/persistence/episodic');
const ExecutionLogger = require('../shared/observability/logger');
const paths = require('../shared/config/paths');
const SYSTEM_PROMPTS = require('../shared/config/prompts');

const cleanUrlString = (raw) => {
  if (!raw || typeof raw !== 'string') return 'https://gemini.google.com/app';
  const match = raw.match(/https?:\/\/[^\s\)"'\]]+/i);
  return match ? match[0] : raw.trim();
};

class Application {
  constructor() {
    this.chatUrlFile = paths.CHAT_URL_FILE;
    this.repoPathFile = paths.REPO_PATH_FILE;
    this.commandsFile = paths.COMMANDS_FILE || FileSystemUtils.resolveAbsolutePath('commands.json');
    this.sessionDir = paths.SESSION_DIR;
    this.dynamicCommands = this.loadDynamicCommands();
  }

  displayBanner() {
    let pkg = { name: 'gemini-cli-bridge', version: '3.0.0', author: 'N/A' };

    if (FileSystemUtils.fileExists(paths.PACKAGE_JSON_FILE)) {
      try {
        const parsed = JSON.parse(FileSystemUtils.readFile(paths.PACKAGE_JSON_FILE));
        pkg.name = parsed.name || pkg.name;
        pkg.version = parsed.version || pkg.version;
        pkg.author = typeof parsed.author === 'object' ? (parsed.author.name || 'N/A') : (parsed.author || 'N/A');
      } catch (e) { }
    }

    if (FileSystemUtils.fileExists(paths.BANNER_FILE)) {
      const bannerText = FileSystemUtils.readFile(paths.BANNER_FILE);
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
    if (FileSystemUtils.fileExists(this.commandsFile)) {
      try {
        return JSON.parse(FileSystemUtils.readFile(this.commandsFile));
      } catch (e) {
        console.error('  Error al leer commands.json.');
      }
    }
    return {};
  }

  async resolveProjectRoot(repl, forceAsk = false) {
    let projectRoot = forceAsk ? null : process.argv[2];

    if (!forceAsk && !projectRoot && FileSystemUtils.fileExists(this.repoPathFile)) {
      const savedPath = FileSystemUtils.readFile(this.repoPathFile).trim();
      const resolvedSaved = FileSystemUtils.resolveAbsolutePath(savedPath);
      if (FileSystemUtils.fileExists(resolvedSaved)) projectRoot = resolvedSaved;
    }

    while (!projectRoot || !FileSystemUtils.fileExists(FileSystemUtils.resolveAbsolutePath(projectRoot))) {
      if (repl.rl.closed) process.exit(0);
      if (projectRoot) console.log(`  La ruta "${projectRoot}" es inválida.`);
      const inputPath = await repl.askQuestion('  Ingresa la ruta del repositorio para este chat (Enter para usar actual "."): ');
      if (repl.rl.closed) process.exit(0);
      projectRoot = inputPath.trim() || '.';
    }

    projectRoot = FileSystemUtils.resolveAbsolutePath(projectRoot);
    FileSystemUtils.writeFile(this.repoPathFile, projectRoot);
    console.log(`  Repositorio vinculado: ${projectRoot}\n`);
    return projectRoot;
  }

  async resolveTargetChatUrl(repl) {
    const askForChatName = async () => {
      let chatName = '';
      while (!chatName) {
        if (repl.rl.closed) process.exit(0);
        const rawName = await repl.askQuestion('  Ingresa el nombre para el nuevo chat: ');
        if (repl.rl.closed) process.exit(0);

        chatName = rawName
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim()
          .replace(/\s+/g, '-')
          .substring(0, 50);

        if (!chatName) {
          console.log('  [!] El nombre del chat es obligatorio.');
        }
      }
      return chatName;
    };

    while (true) {
      if (repl.rl.closed) process.exit(0);

      const chatsFile = paths.SAVED_CHATS_FILE;
      let savedChats = {};
      if (FileSystemUtils.fileExists(chatsFile)) {
        try { savedChats = JSON.parse(FileSystemUtils.readFile(chatsFile)); }
        catch (e) { console.error('  Error al leer los chats guardados.'); }
      }
      const chatNames = Object.keys(savedChats);

      let savedUrl = '';
      let hasActiveChat = false;
      if (FileSystemUtils.fileExists(this.chatUrlFile)) {
        savedUrl = cleanUrlString(FileSystemUtils.readFile(this.chatUrlFile));
        hasActiveChat = savedUrl.includes('/app/');
      }

      console.log('\n  [GESTIÓN DE SESIÓN]');

      if (hasActiveChat) {
        console.log('  [1] Retomar último chat activo');
      } else {
        console.log('  [1] Retomar último chat activo (No disponible)');
      }

      console.log('  [2] Iniciar nuevo chat');

      if (chatNames.length > 0) {
        console.log('  [3] Seleccionar un chat específico');
      } else {
        console.log('  [3] Seleccionar un chat específico (No hay chats guardados)');
      }

      console.log('  [4] Salir');

      const choice = (await repl.askQuestion('\n  Selecciona una opción: ')).trim();
      if (repl.rl.closed) process.exit(0);

      if (choice === '1') {
        if (!hasActiveChat) {
          console.log('  [!] No hay un chat activo previo para retomar.');
          continue;
        }
        return { targetUrl: savedUrl, isNewChat: false, chatName: null };
      } else if (choice === '2') {
        const chatName = await askForChatName();
        return { targetUrl: 'https://gemini.google.com/app', isNewChat: true, chatName };
      } else if (choice === '3') {
        if (chatNames.length === 0) {
          console.log('\n  ⚠️ No hay chats guardados disponibles.');
          continue;
        }

        console.log('\n  [CHATS DISPONIBLES]');
        chatNames.forEach((name, index) => {
          console.log(`  [${index + 1}] ${name}`);
        });

        const chatChoice = await repl.askQuestion('\n  Ingresa el número del chat que deseas cargar (o Enter para volver): ');
        if (repl.rl.closed) process.exit(0);
        if (!chatChoice.trim()) continue;

        const selectedIndex = parseInt(chatChoice.trim(), 10) - 1;

        if (selectedIndex >= 0 && selectedIndex < chatNames.length) {
          const selectedName = chatNames[selectedIndex];
          const targetUrl = cleanUrlString(savedChats[selectedName]);
          FileSystemUtils.writeFile(this.chatUrlFile, targetUrl);
          console.log(`\n  [SISTEMA] Se cargará el chat: "${selectedName}"`);
          return { targetUrl, isNewChat: false, chatName: selectedName };
        } else {
          console.log('  [!] Número de chat inválido.');
        }
      } else if (choice === '4') {
        console.log('  Cerrando aplicación...');
        repl.close();
        process.exit(0);
      } else {
        console.log('\n  [!] Opción no reconocida. Por favor ingresa una opción del 1 al 4.');
      }
    }
  }

  setupSigintHandler(repl, getLlmClient) {
    global.isProcessing = false;
    global.abortLoop = false;
    let sigintCount = 0;

    repl.rl.on('SIGINT', async () => {
      const llmClient = typeof getLlmClient === 'function' ? getLlmClient() : null;
      if (global.isProcessing && llmClient) {
        console.log('\n  🛑 [SISTEMA] Interrumpiendo IA. Deteniendo generación...');
        global.abortLoop = true;
        global.isProcessing = false;
        await llmClient.stopGeneration();
      } else {
        sigintCount++;
        if (sigintCount === 1) {
          console.log('\n  ℹ️ Presiona Ctrl+C de nuevo o escribe /exit para salir.');
          setTimeout(() => { sigintCount = 0; }, 2000);
        } else {
          console.log('\n  Cerrando aplicación...');
          try { if (llmClient) await llmClient.close(); } catch (e) { }
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

    let llmClient = null;

    this.setupSigintHandler(repl, () => llmClient);

    process.on('unhandledRejection', (reason) => {
      if (reason && (reason.code === 'ABORT_ERR' || reason.name === 'AbortError')) return;
      if (reason && reason.message && reason.message.includes('closed')) return;
      console.error('\n  [!] Error no controlado:', reason?.message || reason);
    });

    const providerType = (process.env.LLM_PROVIDER || 'PLAYWRIGHT').toUpperCase();
    console.log(`\n  Iniciando motor de IA (${providerType} Provider)...`);

    let targetUrl = '';
    let isNewChat = false;
    let chatName = null;

    if (providerType === 'PLAYWRIGHT') {
      const sessionInfo = await this.resolveTargetChatUrl(repl);
      targetUrl = cleanUrlString(sessionInfo.targetUrl);
      isNewChat = sessionInfo.isNewChat;
      chatName = sessionInfo.chatName;
    } else {
      targetUrl = process.env.LLM_MODEL || (providerType === 'QWEN_API' ? 'qwen-coder-plus' : 'gemini-1.5-pro');
    }

    let projectRoot = await this.resolveProjectRoot(repl, isNewChat);

    llmClient = LLMFactory.createClient(providerType, {
      sessionDir: this.sessionDir,
      chatUrlFile: this.chatUrlFile
    });

    await llmClient.connect(targetUrl);

    if (typeof llmClient.setupWebUIListener === 'function') {
      await llmClient.setupWebUIListener(async (webInput) => {
        if (global.isProcessing) {
          return;
        }

        console.log(`\n  🌐 [WEB UI DETECTADO] Instrucción manual ingresada en el navegador: "${webInput}"`);
        const decision = await decisionEngine.processInput(webInput, repl);

        if (decision.skip) return;

        logger.startExecution();
        await agentRuntime.runLoop(decision.cleanPrompt, null, null, decision.mode, { isWebInitiated: true });

        process.stdout.write('\nGemini Dev V3 > ');
      });
    }

    const modelRouter = new ModelRouter(llmClient);

    const toolRegistry = new ToolRegistry();
    const dbConnection = new MemoryDatabase();
    const checkpointManager = new CheckpointManager(dbConnection);
    const episodicMemory = new EpisodicMemory(dbConnection);

    const decisionEngine = new ExecutionDecisionEngine({
      geminiClient: llmClient,
      projectRoot,
      dynamicCommands: this.dynamicCommands
    });

    const agentRuntime = new AgentRuntime({
      modelRouter,
      toolRegistry,
      projectRoot,
      repl,
      logger,
      episodicMemory,
      checkpointManager,
      decisionEngine
    });

    console.log('\n===============================================================');
    console.log(`   Agente CLI V3 Listo. Usa "/help" para comandos o "/paste".`);
    console.log('===============================================================\n');

    if (providerType === 'PLAYWRIGHT' && (isNewChat || targetUrl === 'https://gemini.google.com/app')) {
      console.log('  [SISTEMA] Inicializando nuevo chat con reglas globales...');
      const response = await modelRouter.generate({ prompt: SYSTEM_PROMPTS.INIT_NEW_CHAT });
      console.log('\n-------------------- IA --------------------');
      console.log(response.text);
      console.log('--------------------------------------------\n');

      if (chatName && llmClient.page) {
        const newUrl = cleanUrlString(llmClient.page.url());
        if (newUrl.includes('/app/')) {
          const chatsFile = paths.SAVED_CHATS_FILE;
          let savedChats = {};
          if (FileSystemUtils.fileExists(chatsFile)) {
            try { savedChats = JSON.parse(FileSystemUtils.readFile(chatsFile)); } catch (e) { }
          }
          savedChats[chatName] = newUrl;
          FileSystemUtils.writeFile(chatsFile, JSON.stringify(savedChats, null, 2));
          console.log(`  ✅ [SISTEMA] Chat guardado automáticamente como "${chatName}".\n`);
        }
      }
    }

    if (!isNewChat) {
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
    } else {
      const pendingState = checkpointManager.getPendingRun();
      if (pendingState) {
        checkpointManager.markRunCompleted(pendingState.runId, 'CANCELLED');
      }
    }

    while (true) {
      global.abortLoop = false;
      let instruction = await repl.askQuestion('\nGemini Dev V3 > ');

      if (instruction.trim() === '/paste') {
        instruction = await repl.askMultiline();
      }

      const decision = await decisionEngine.processInput(instruction, repl);

      if (decision.newRoot) {
        projectRoot = decision.newRoot;
        agentRuntime.setProjectRoot(projectRoot);
        decisionEngine.setProjectRoot(projectRoot);
      }

      if (decision.skip) continue;

      logger.startExecution();

      await agentRuntime.runLoop(decision.cleanPrompt, null, null, decision.mode);
    }
  }
}

module.exports = Application;