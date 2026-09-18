const fs = require('fs');
const path = require('path');
const { createContextFile, createPartialContextFile } = require('../../shared/utils/fileScanner');
const paths = require('../../shared/config/paths');
const SYSTEM_PROMPTS = require('../../shared/config/prompts');

class CommandDispatcher {
    constructor(geminiClient, projectRoot, dynamicCommands) {
        this.gemini = geminiClient;
        this.projectRoot = projectRoot;
        this.dynamicCommands = dynamicCommands;
        this.chatsFile = paths.SAVED_CHATS_FILE;
    }

    getGlobalRules() {
        return SYSTEM_PROMPTS.GLOBAL_TOOL_RULES;
    }

    async dispatch(instruction, repl) {
        const instructionTrimmed = instruction.trim();
        if (!instructionTrimmed) return { skip: true };
        const lowerInput = instructionTrimmed.toLowerCase();

        // --- GESTIÓN DE CHATS ---
        if (lowerInput === '/chat-new') { await this.handleChatNew(); return { skip: true }; }
        if (lowerInput === '/chat-list') { this.handleChatList(); return { skip: true }; }
        if (lowerInput.startsWith('/chat-save ')) { this.handleChatSave(instructionTrimmed); return { skip: true }; }
        if (lowerInput.startsWith('/chat-load ')) { await this.handleChatLoad(instructionTrimmed); return { skip: true }; }
        if (lowerInput.startsWith('/chat-delete ')) { this.handleChatDelete(instructionTrimmed); return { skip: true }; }

        // --- COMANDOS DE SISTEMA ---
        if (lowerInput === '/exit' || lowerInput === 'exit' || lowerInput.startsWith('/exit ') || lowerInput.startsWith('exit ')) {
            console.log('  Cerrando sesión y saliendo...');
            try { await this.gemini.close(); } catch (e) { }
            repl.close();
            process.exit(0);
        }

        if (lowerInput === '/help' || lowerInput === '/helper') {
            this.showHelp();
            return { skip: true };
        }

        if (lowerInput === '/history' || lowerInput === '/historial') {
            await this.handleHistory();
            return { skip: true };
        }

        if (lowerInput.startsWith('/new-repo ')) {
            return this.handleNewRepo(instructionTrimmed);
        }

        // --- COMANDO: RECARGAR REGLAS ---
        if (lowerInput === '/reload-rules') {
            await this.handleReloadRules();
            return { skip: true };
        }

        // --- COMANDOS CON CONTEXTO ---
        if (lowerInput.startsWith('/upload-files')) {
            return await this.handleUploadFiles(instructionTrimmed);
        }

        if (lowerInput.startsWith('/sync-all')) {
            return await this.handleSyncAll(instructionTrimmed);
        }

        if (lowerInput.startsWith('/sync ')) {
            await this.handleSyncPartial(instructionTrimmed);
            return { skip: true };
        }

        // --- COMANDOS DE AGENTE ---
        const sortedCommands = Object.keys(this.dynamicCommands).sort((a, b) => b.length - a.length);
        let matchedCmd = null;
        for (const cmd of sortedCommands) {
            if (instructionTrimmed === cmd || instructionTrimmed.startsWith(cmd + ' ')) {
                matchedCmd = cmd;
                break;
            }
        }

        let cleanInstruction = instructionTrimmed;
        let finalPrompt = '';

        if (matchedCmd) {
            cleanInstruction = instructionTrimmed.substring(matchedCmd.length).trim();
            const expertRolePrompt = this.dynamicCommands[matchedCmd].prompt;
            console.log(`\n  [🚀 Agente Activado: ${matchedCmd}]`);
            finalPrompt = `${this.getGlobalRules()}\n\nPERFIL ASIGNADO: ${expertRolePrompt}\n\n**SOLICITUD DEL USUARIO**\n${cleanInstruction}`;
        } else {
            finalPrompt = cleanInstruction;
        }

        return { finalPrompt, skip: false };
    }

    showHelp() {
        console.log('\n================================================================================');
        console.log('                             GUÍA DE COMANDOS CLI                               ');
        console.log('================================================================================\n');

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
            const paddedCmd = cmd.padEnd(20, ' ');
            console.log(`  ${paddedCmd} -> ${data.description}`);
        }
        console.log('\n================================================================================\n');
    }

    async handleReloadRules() {
        console.log('  [/reload-rules] Inyectando reglas actualizadas en el chat activo...');
        const reloadPrompt = `[SISTEMA: ACTUALIZACIÓN DE REGLAS]\nA partir de este momento, se aplican las siguientes reglas obligatorias para nuestras interacciones:\n\n${this.getGlobalRules()}\n\nPor favor, responde ÚNICAMENTE diciendo: "✓ Reglas actualizadas. Operando en JS Object Mode."`;

        await this.gemini.sendPrompt(reloadPrompt);
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
        await this.gemini.page.goto('https://gemini.google.com/app');
        await this.gemini.page.waitForTimeout(2000);

        if (fs.existsSync(this.chatsFile)) {
            if (fs.existsSync(paths.CHAT_URL_FILE)) {
                try { fs.unlinkSync(paths.CHAT_URL_FILE); } catch (e) { }
            }
        }
        console.log('  ✅ Chat nuevo listo.');
    }

    handleChatSave(instruction) {
        const name = instruction.substring(11).trim();
        if (!name) return console.log('  ❌ Debes especificar un nombre: /chat-save <nombre>');

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
        await this.gemini.page.goto(targetUrl);
        await this.gemini.page.waitForTimeout(2000);

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
            const prompt = `[SISTEMA: CARGA DE CONTEXTO]\nSe adjunta el código fuente con ${result.fileCount} archivos. Actualiza tu memoria. NO ejecutes herramientas. Responde ÚNICAMENTE: "Contexto cargado exitosamente."`;
            await this.gemini.sendPrompt(prompt, result.tempFilePath);
            console.log('  Contexto subido exitosamente.\n');

            if (userMessage) {
                console.log(`  [SISTEMA] Evaluando solicitud adicional: "${userMessage}"`);
                return { finalPrompt: userMessage, skip: false };
            }
        }
        return { skip: true };
    }

    async handleSyncAll(instruction) {
        const userMessage = instruction.substring('/sync-all'.length).trim();
        console.log('  [/sync-all] Sincronizando proyecto completo...');
        const result = createContextFile(this.projectRoot);

        if (result.fileCount > 0) {
            const prompt = `[SISTEMA: ACTUALIZACIÓN GLOBAL]\nSe adjunta la estructura completa con ${result.fileCount} archivos. Actualiza tu memoria. NO ejecutes herramientas en esta respuesta. Responde ÚNICAMENTE: "Sincronización global exitosa."`;
            await this.gemini.sendPrompt(prompt, result.tempFilePath);
            console.log('  Sincronización lista.\n');

            if (userMessage) {
                console.log(`  [SISTEMA] Evaluando solicitud adicional: "${userMessage}"`);
                return { finalPrompt: userMessage, skip: false };
            }
        }
        return { skip: true };
    }

    async handleSyncPartial(instruction) {
        const args = instruction.substring(5).trim();
        const filesToSync = args.split(' ').map(f => f.trim()).filter(f => f.length > 0);
        if (filesToSync.length === 0) return console.log('  Especifica al menos un archivo.');

        console.log('  [/sync] Sincronizando selección parcial...');
        const result = createPartialContextFile(this.projectRoot, filesToSync);
        if (result.fileCount > 0) {
            const prompt = `[SISTEMA: ACTUALIZACIÓN PARCIAL]\nSe adjuntan ${result.fileCount} archivo(s) actualizado(s). Sincroniza tu memoria. Responde ÚNICAMENTE: "Sincronización parcial exitosa."`;
            await this.gemini.sendPrompt(prompt, result.tempFilePath);
            console.log('  Archivos sincronizados.\n');
        }
    }

    async handleHistory() {
        console.log('\n  Extrayendo historial...');
        const historyText = await this.gemini.getChatHistory();
        const historyPath = path.join(this.projectRoot, 'HISTORIAL_CHAT.md');
        fs.writeFileSync(historyPath, historyText, 'utf-8');
        console.log(`  Historial guardado en: ${historyPath}\n`);
    }

    handleNewRepo(instruction) {
        const targetPath = instruction.substring(10).trim();
        if (!targetPath) {
            console.log('    Debes especificar una ruta: /new-repo <ruta>');
            return { skip: true };
        }

        const absPath = path.resolve(targetPath);
        if (!fs.existsSync(absPath)) {
            console.log(`    La ruta "${absPath}" no existe en disco.`);
            return { skip: true };
        }

        this.projectRoot = absPath;
        fs.writeFileSync(paths.REPO_PATH_FILE, absPath, 'utf-8');
        console.log(`  [SISTEMA] Repositorio cambiado a: ${absPath}`);

        return { skip: true, newRoot: absPath };
    }
}

module.exports = CommandDispatcher;