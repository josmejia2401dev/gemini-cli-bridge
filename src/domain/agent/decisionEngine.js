const fs = require('fs');
const path = require('path');
const { createContextFile, createPartialContextFile } = require('../../shared/utils/fileScanner');
const paths = require('../../shared/config/paths');
const SYSTEM_PROMPTS = require('../../shared/config/prompts');

/**
 * ExecutionDecisionEngine (Unificado)
 * Centraliza la clasificación de intenciones, el enrutamiento y el despacho de comandos del sistema.
 */
class ExecutionDecisionEngine {
  constructor({ geminiClient, projectRoot, dynamicCommands = {} } = {}) {
    this.gemini = geminiClient;
    this.projectRoot = projectRoot;
    this.dynamicCommands = dynamicCommands;
    this.chatsFile = paths.SAVED_CHATS_FILE;

    this.deterministicPatterns = [
      {
        regex: /^busca\s+(?:s[ií]mbolo|codigo|c[oó]digo|texto|palabra)?\s*(.+)$/i,
        tool: 'search_code',
        extractArgs: (m) => ({ query: m[1].trim() })
      },
      {
        regex: /^lee\s+(?:el\s+archivo\s+)?(.+)$/i,
        tool: 'read_files',
        extractArgs: (m) => ({ paths: [m[1].trim()] })
      },
      {
        regex: /^qui[ée]n\s+importa\s+(.+)$/i,
        tool: 'who_imports',
        extractArgs: (m) => ({ target: m[1].trim() })
      },
      {
        regex: /^dependencias\s+de\s+(.+)$/i,
        tool: 'get_dependencies',
        extractArgs: (m) => ({ filePath: m[1].trim() })
      },
      {
        regex: /^d[óo]nde\s+se\s+(?:define|ubica|encuentra)\s+(.+)$/i,
        tool: 'find_symbol',
        extractArgs: (m) => ({ symbol: m[1].trim() })
      },
      {
        regex: /^analiza\s+(?:el\s+)?impacto\s+de\s+(.+)$/i,
        tool: 'analyze_impact',
        extractArgs: (m) => ({ filePath: m[1].trim() })
      },
      {
        regex: /^ejecuta\s+(.+)$/i,
        tool: 'execute_command',
        extractArgs: (m) => ({ command: m[1].trim() })
      },
      {
        regex: /^corr[ee]\s+(.+)$/i,
        tool: 'execute_command',
        extractArgs: (m) => ({ command: m[1].trim() })
      }
    ];

    this.directCliPrefixes = /^(npm\s+|mvn\s+|gradlew?\s+|node\s+|python\s+|docker\s+|cargo\s+|go\s+|npx\s+)/i;
  }

  setProjectRoot(newRoot) {
    this.projectRoot = newRoot;
  }

  setGeminiClient(geminiClient) {
    this.gemini = geminiClient;
  }

  getGlobalRules() {
    return SYSTEM_PROMPTS.GLOBAL_TOOL_RULES;
  }

  /**
   * Clasifica la instrucción recibida.
   * @param {string} instruction
   * @returns {{ mode: 'DIRECT_CHAT' | 'DETERMINISTIC' | 'LLM_REQUIRED', cleanPrompt: string, tool?: string, args?: Object }}
   */
  classify(instruction) {
    if (!instruction || typeof instruction !== 'string') {
      return { mode: 'DIRECT_CHAT', cleanPrompt: '' };
    }

    const trimmed = instruction.trim();
    if (!trimmed) return { mode: 'DIRECT_CHAT', cleanPrompt: '' };

    // 1. SI TIENE PREFIJO /plan O /task -> FUERZA PLANIFICACIÓN DAG
    if (trimmed.startsWith('/plan ') || trimmed.startsWith('/task ')) {
      const cleanPrompt = trimmed.replace(/^(\/plan|\/task)\s+/i, '').trim();
      return {
        mode: 'LLM_REQUIRED',
        cleanPrompt
      };
    }

    // 2. EVALUACIÓN CONTRA PATRONES DETERMINÍSTICOS LOCALES
    for (const pattern of this.deterministicPatterns) {
      const match = trimmed.match(pattern.regex);
      if (match) {
        return {
          mode: 'DETERMINISTIC',
          cleanPrompt: trimmed,
          tool: pattern.tool,
          args: pattern.extractArgs(match)
        };
      }
    }

    if (this.directCliPrefixes.test(trimmed)) {
      return {
        mode: 'DETERMINISTIC',
        cleanPrompt: trimmed,
        tool: 'execute_command',
        args: { command: trimmed }
      };
    }

    // 3. POR DEFECTO: CHAT CONVERSACIONAL DIRECTO (Sin DAG)
    return {
      mode: 'DIRECT_CHAT',
      cleanPrompt: trimmed
    };
  }

  /**
   * Método principal de procesamiento y despacho de entradas CLI.
   */
  async processInput(instruction, repl) {
    if (!instruction || typeof instruction !== 'string') {
      return { mode: 'SYSTEM', skip: true };
    }

    const trimmed = instruction.trim();
    if (!trimmed) return { mode: 'SYSTEM', skip: true };
    const lowerInput = trimmed.toLowerCase();

    // 1. COMANDOS DE SESIÓN DE CHAT
    if (lowerInput === '/chat-new') { await this.handleChatNew(); return { mode: 'SYSTEM', skip: true }; }
    if (lowerInput === '/chat-list') { this.handleChatList(); return { mode: 'SYSTEM', skip: true }; }
    if (lowerInput.startsWith('/chat-save ')) { this.handleChatSave(trimmed); return { mode: 'SYSTEM', skip: true }; }
    if (lowerInput.startsWith('/chat-load ')) { await this.handleChatLoad(trimmed); return { mode: 'SYSTEM', skip: true }; }
    if (lowerInput.startsWith('/chat-delete ')) { this.handleChatDelete(trimmed); return { mode: 'SYSTEM', skip: true }; }

    // 2. COMANDOS DE SISTEMA Y CLI
    if (['/exit', 'exit'].includes(lowerInput) || lowerInput.startsWith('/exit ') || lowerInput.startsWith('exit ')) {
      console.log('  Cerrando sesión y saliendo...');
      try { if (this.gemini) await this.gemini.close(); } catch (e) { }
      repl.close();
      process.exit(0);
    }

    if (['/help', '/helper'].includes(lowerInput)) {
      this.showHelp();
      return { mode: 'SYSTEM', skip: true };
    }

    if (['/history', '/historial'].includes(lowerInput)) {
      await this.handleHistory();
      return { mode: 'SYSTEM', skip: true };
    }

    if (lowerInput.startsWith('/new-repo ')) {
      return this.handleNewRepo(trimmed);
    }

    if (lowerInput === '/reload-rules') {
      await this.handleReloadRules();
      return { mode: 'SYSTEM', skip: true };
    }

    // 3. COMANDOS DE CONTEXTO Y ARCHIVOS
    if (lowerInput.startsWith('/upload-files')) {
      return await this.handleUploadFiles(trimmed);
    }
    
    if (lowerInput.startsWith('/sync ')) {
      await this.handleSyncPartial(trimmed);
      return { mode: 'SYSTEM', skip: true };
    }

    // 4. PERFILES DINÁMICOS DE AGENTE (/dev, /refactor, etc.)
    const sortedCommands = Object.keys(this.dynamicCommands).sort((a, b) => b.length - a.length);
    let matchedCmd = null;
    for (const cmd of sortedCommands) {
      if (trimmed === cmd || trimmed.startsWith(cmd + ' ')) {
        matchedCmd = cmd;
        break;
      }
    }

    if (matchedCmd) {
      const cleanInstruction = trimmed.substring(matchedCmd.length).trim();
      const expertRolePrompt = this.dynamicCommands[matchedCmd].prompt;
      console.log(`\n  [🚀 Agente Activado: ${matchedCmd}]`);
      const finalPrompt = `${this.getGlobalRules()}\n\nPERFIL ASIGNADO: ${expertRolePrompt}\n\n**SOLICITUD DEL USUARIO**\n${cleanInstruction}`;
      return {
        mode: 'LLM_REQUIRED',
        cleanPrompt: finalPrompt,
        skip: false
      };
    }

    // 5. CLASIFICACIÓN CON CLASSIFY
    const classification = this.classify(trimmed);
    return {
      ...classification,
      skip: false
    };
  }

  showHelp() {
    console.log('\n================================================================================');
    console.log('                               GUÍA DE COMANDOS CLI                               ');
    console.log('================================================================================\n');

    console.log('  [COMANDOS DE PLANIFICACIÓN Y CHAT]');
    console.log('  /plan <instrucción>    -> Genera un plan DAG estructurado y solicita aprobación.');
    console.log('  <texto libre>          -> Consulta conversacional directa (sin plan DAG).\n');

    console.log('  [COMANDOS DE CHAT (Sesiones)]');
    console.log('  /chat-new              -> Inicia una nueva conversación limpia.');
    console.log('  /chat-save <nombre>    -> Guarda el chat actual con un nombre.');
    console.log('  /chat-list             -> Muestra todos los chats guardados.');
    console.log('  /chat-load <nombre>    -> Retoma un chat guardado.');
    console.log('  /chat-delete <nombre>  -> Elimina un chat de la lista.\n');

    console.log('  [COMANDOS DE SISTEMA]');
    console.log('  /paste                 -> Activa modo multilínea para bloques de texto.');
    console.log('  /upload-files [texto]  -> Genera contexto y ejecuta instrucciones.');
    console.log('  /sync-all [texto]      -> Sincroniza TODO el repositorio.');
    console.log('  /sync <rutas...>       -> Sincroniza archivos específicos.');
    console.log('  /history               -> Extrae historial a HISTORIAL_CHAT.md.');
    console.log('  /new-repo <ruta>       -> Cambia el directorio de trabajo.');
    console.log('  /reload-rules          -> Fuerza a la IA a recordar las reglas del JS Object Mode.');
    console.log('  /exit                  -> Cierra la aplicación.\n');

    console.log('  [COMANDOS DE AGENTE (commands.json)]');
    for (const [cmd, data] of Object.entries(this.dynamicCommands)) {
      const paddedCmd = cmd.padEnd(22, ' ');
      console.log(`  ${paddedCmd} -> ${data.description}`);
    }
    console.log('\n================================================================================\n');
  }

  async handleReloadRules() {
    console.log('  [/reload-rules] Inyectando reglas actualizadas en el chat activo...');
    const reloadPrompt = SYSTEM_PROMPTS.RELOAD_RULES(this.getGlobalRules());
    if (this.gemini) {
      await this.gemini.sendPrompt(reloadPrompt);
    }
    console.log('  ✅ Reglas actualizadas en memoria.\n');
  }

  getSavedChats() {
    if (!fs.existsSync(this.chatsFile)) return {};
    try { return JSON.parse(fs.readFileSync(this.chatsFile, 'utf-8')); }
    catch (e) { return {}; }
  }

  saveChats(chats) {
    fs.writeFileSync(this.chatsFile, JSON.stringify(chats, null, 2), 'utf-8');
  }

  async handleChatNew() {
    console.log('  [SISTEMA] Iniciando un nuevo chat...');
    if (this.gemini?.page) {
      await this.gemini.page.goto('https://gemini.google.com/app');
      await this.gemini.page.waitForTimeout(2000);
    } else if (this.gemini) {
      await this.gemini.connect('https://gemini.google.com/app');
    }

    if (fs.existsSync(this.chatsFile) && fs.existsSync(paths.CHAT_URL_FILE)) {
      try { fs.unlinkSync(paths.CHAT_URL_FILE); } catch (e) { }
    }
    console.log('  ✅ Chat nuevo listo.');
  }

  handleChatSave(instruction) {
    const name = instruction.substring(11).trim();
    if (!name) return console.log('  ❌ Debes especificar un nombre: /chat-save <nombre>');

    if (!this.gemini?.page) {
      return console.log('  ℹ️ El guardado de URLs solo está disponible para el proveedor Playwright.');
    }

    const currentUrl = this.gemini.page.url();
    if (!currentUrl.includes('/app/')) return console.log('  ❌ Aún no hay un hilo activo.');

    const chats = this.getSavedChats();
    chats[name] = currentUrl;
    this.saveChats(chats);
    console.log(`  ✅ Chat guardado exitosamente como "${name}".`);
  }

  handleChatList() {
    const chats = this.getSavedChats();
    const keys = Object.keys(chats);
    if (keys.length === 0) return console.log('  ℹ️ No tienes chats guardados.');

    console.log('\n  [CHATS GUARDADOS]');
    keys.forEach(k => console.log(`  - ${k}`));
    console.log();
  }

  async handleChatLoad(instruction) {
    const name = instruction.substring(11).trim();
    if (!name) return console.log('  ❌ Debes especificar un nombre.');

    const chats = this.getSavedChats();
    const targetUrl = chats[name];
    if (!targetUrl) return console.log(`  ❌ No se encontró el chat "${name}".`);

    console.log(`  [SISTEMA] Cargando chat "${name}"...`);
    if (this.gemini?.page) {
      await this.gemini.page.goto(targetUrl);
      await this.gemini.page.waitForTimeout(2000);
    } else if (this.gemini) {
      await this.gemini.connect(targetUrl);
    }

    fs.writeFileSync(paths.CHAT_URL_FILE, targetUrl, 'utf-8');
    console.log(`  ✅ Chat "${name}" cargado y listo.`);
  }

  handleChatDelete(instruction) {
    const name = instruction.substring(13).trim();
    if (!name) return console.log('  ❌ Debes especificar un nombre.');

    const chats = this.getSavedChats();
    if (!chats[name]) return console.log(`  ❌ El chat "${name}" no existe.`);

    delete chats[name];
    this.saveChats(chats);
    console.log(`  ✅ Chat "${name}" eliminado.`);
  }

  async handleUploadFiles(instruction) {
    const userMessage = instruction.substring('/upload-files'.length).trim();
    console.log('  [/upload-files] Subiendo paquete de contexto...');
    const result = createContextFile(this.projectRoot);

    if (result.fileCount > 0) {
      const prompt = SYSTEM_PROMPTS.UPLOAD_FILES(result.fileCount);
      if (this.gemini) {
        await this.gemini.sendPrompt(prompt, result.tempFilePath);
      }
      console.log('  Contexto subido exitosamente.\n');

      if (userMessage) {
        console.log(`  [SISTEMA] Evaluando solicitud adicional: "${userMessage}"`);
        return { mode: 'DIRECT_CHAT', cleanPrompt: userMessage, skip: false };
      }
    }
    return { mode: 'SYSTEM', skip: true };
  }

  async handleSyncPartial(instruction) {
    const args = instruction.substring(5).trim();
    const filesToSync = args.split(' ').map(f => f.trim()).filter(f => f.length > 0);
    if (filesToSync.length === 0) return console.log('  Especifica al menos un archivo.');

    console.log('  [/sync] Sincronizando selección parcial...');
    const result = createPartialContextFile(this.projectRoot, filesToSync);
    if (result.fileCount > 0 && this.gemini) {
      const prompt = SYSTEM_PROMPTS.SYNC_PARTIAL(result.fileCount);
      await this.gemini.sendPrompt(prompt, result.tempFilePath);
      console.log('  Archivos sincronizados.\n');
    }
  }

  async handleHistory() {
    console.log('\n  Extrayendo historial...');
    if (!this.gemini) return;
    const historyText = await this.gemini.getChatHistory();
    const historyPath = path.join(this.projectRoot, 'HISTORIAL_CHAT.md');
    fs.writeFileSync(historyPath, historyText, 'utf-8');
    console.log(`  Historial guardado en: ${historyPath}\n`);
  }

  handleNewRepo(instruction) {
    const targetPath = instruction.substring(10).trim();
    if (!targetPath) {
      console.log('    Debes especificar una ruta: /new-repo <ruta>');
      return { mode: 'SYSTEM', skip: true };
    }

    const absPath = path.resolve(targetPath);
    if (!fs.existsSync(absPath)) {
      console.log(`    La ruta "${absPath}" no existe en disco.`);
      return { mode: 'SYSTEM', skip: true };
    }

    this.projectRoot = absPath;
    fs.writeFileSync(paths.REPO_PATH_FILE, absPath, 'utf-8');
    console.log(`  [SISTEMA] Repositorio cambiado a: ${absPath}`);

    return { mode: 'SYSTEM', skip: true, newRoot: absPath };
  }
}

// DUAL EXPORT PARA EVITAR ERRORES DE DESTRUCTURING
module.exports = ExecutionDecisionEngine;
module.exports.ExecutionDecisionEngine = ExecutionDecisionEngine;