const fs = require('fs');
const path = require('path');
const { createContextFile, createPartialContextFile } = require('../utils/fileScanner');

class CommandDispatcher {
    constructor(geminiClient, projectRoot, dynamicCommands) {
        this.gemini = geminiClient;
        this.projectRoot = projectRoot;
        this.dynamicCommands = dynamicCommands;
        // Archivo para guardar la memoria de los chats
        this.chatsFile = path.join(__dirname, '..', '.session_chats.json');
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
        if (lowerInput === '/exit' || lowerInput.startsWith('/exit ')) {
            console.log('  Cerrando sesión y saliendo...');
            await this.gemini.close();
            repl.close();
            process.exit(0);
        }

        if (lowerInput === '/help' || lowerInput === '/helper') {
            this.showHelp();
            return { skip: true };
        }

        if (lowerInput.startsWith('/upload-files')) {
            await this.handleUploadFiles();
            return { skip: true };
        }

        if (lowerInput === '/history' || lowerInput === '/historial') {
            await this.handleHistory();
            return { skip: true };
        }

        if (lowerInput === '/sync-all') {
            await this.handleSyncAll();
            return { skip: true };
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

        // --- REGLAS GLOBALES (Autonomía Permanente) ---
        const globalSystemRules = `REGLA ESTRICTA: Eres un Agente Autónomo con acceso al sistema de archivos.
Formato obligatorio:
1. CREAR/MODIFICAR: Usa <<<WRITE: ruta/archivo.ext>>> seguido del código en \`\`\`. CRÍTICO: Provee el CÓDIGO COMPLETO. Prohibido omitir código.
2. LECTURA: Si necesitas ver uno o varios archivos, pide <<<READ: ruta/1.js, ruta/2.js>>> (separados por coma). El sistema te los enviará empaquetados.
3. COMANDOS: Usa <<<CMD: tu comando aquí>>>.
4. ELIMINAR: <<<DELETE: ruta/archivo.ext>>>
5. MOVER: <<<MOVE: ruta/origen.ext > ruta/destino.ext>>>
6. SINCRONIZACIÓN: Si el usuario te indica que tu código está desactualizado, responde ÚNICAMENTE con <<<SYNC_ALL>>>.`;

        let cleanInstruction = instructionTrimmed;
        let finalPrompt = '';

        if (matchedCmd) {
            cleanInstruction = instructionTrimmed.substring(matchedCmd.length).trim();
            const expertRolePrompt = this.dynamicCommands[matchedCmd].prompt;
            console.log(`\n  [🚀 Agente Activado: ${matchedCmd}]`);
            finalPrompt = `${globalSystemRules}\n\nPERFIL ASIGNADO: ${expertRolePrompt}\n\n**SOLICITUD DEL USUARIO**\n${cleanInstruction}`;
        } else {
            finalPrompt = `${globalSystemRules}\n\n**SOLICITUD DEL USUARIO**\n${cleanInstruction}`;
        }

        return { finalPrompt, skip: false };
    }

showHelp() {
        console.log('\n================================================================================');
        console.log('                             GUÍA DE COMANDOS CLI                               ');
        console.log('================================================================================\n');
        
        console.log('  [COMANDOS DE CHAT (Sesiones)]');
        console.log('  /chat-new              -> Inicia una nueva conversación limpia.');
        console.log('  /chat-save <nombre>    -> Guarda el chat actual con un nombre (ej. /chat-save backend).');
        console.log('  /chat-list             -> Muestra todos los chats guardados.');
        console.log('  /chat-load <nombre>    -> Retoma un chat guardado.');
        console.log('  /chat-delete <nombre>  -> Elimina un chat de la lista.\n');

        console.log('  [COMANDOS DE SISTEMA]');
        console.log('  /paste            -> Activa modo multilínea para pegar grandes bloques de texto.');
        console.log('  /upload-files     -> Genera contexto_temp.txt y lo sube formalmente a Gemini.');
        console.log('  /sync-all         -> Sincroniza TODO el repositorio.');
        console.log('  /sync <rutas...>  -> Sincroniza archivos específicos.');
        console.log('  /history          -> Extrae historial a HISTORIAL_CHAT.md.');
        console.log('  /exit             -> Cierra la aplicación.\n');

        console.log('  [COMANDOS DE AGENTE (commands.json)]');
        for (const [cmd, data] of Object.entries(this.dynamicCommands)) {
            const paddedCmd = cmd.padEnd(16, ' ');
            console.log(`  ${paddedCmd} -> ${data.description}`);
        }
        console.log('\n================================================================================\n');
    }
    
    // =========================================================================
    // MÉTODOS DE SESIÓN DE CHAT
    // =========================================================================
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
        // Navega a la URL base para forzar un chat limpio
        await this.gemini.page.goto('https://gemini.google.com/app');
        await this.gemini.page.waitForTimeout(2000);
        console.log('  ✅ Chat nuevo listo.');
    }

    handleChatSave(instruction) {
        const name = instruction.substring(11).trim();
        if (!name) return console.log('  ❌ Debes especificar un nombre: /chat-save <nombre>');
        
        const currentUrl = this.gemini.page.url();
        if (!currentUrl.includes('/app/')) return console.log('  ❌ Aún no hay un hilo de chat activo para guardar. Escribe un mensaje primero.');

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
        if (!name) return console.log('  ❌ Debes especificar un nombre: /chat-load <nombre>');

        const chats = this.getSavedChats();
        const targetUrl = chats[name];
        if (!targetUrl) return console.log(`  ❌ No se encontró ningún chat con el nombre "${name}".`);

        console.log(`  [SISTEMA] Cargando chat "${name}"...`);
        await this.gemini.page.goto(targetUrl);
        await this.gemini.page.waitForTimeout(2000);
        
        // Actualizamos el archivo temporal base para que al reiniciar retome este
        const chatUrlFile = path.join(__dirname, '..', '.session_chat_url.txt');
        fs.writeFileSync(chatUrlFile, targetUrl, 'utf-8');
        
        console.log(`  ✅ Chat "${name}" cargado y listo.`);
    }

    handleChatDelete(instruction) {
        const name = instruction.substring(13).trim();
        if (!name) return console.log('  ❌ Debes especificar un nombre: /chat-delete <nombre>');

        const chats = this.getSavedChats();
        if (!chats[name]) return console.log(`  ❌ El chat "${name}" no existe.`);

        delete chats[name];
        this.saveChats(chats);
        console.log(`  ✅ Chat "${name}" eliminado.`);
    }

    // =========================================================================
    // MÉTODOS DE SISTEMA EXISTENTES
    // =========================================================================
    async handleUploadFiles() {
        console.log('  [/upload-files] Subiendo paquete de contexto...');
        const result = createContextFile(this.projectRoot);
        if (result.fileCount > 0) {
            const prompt = `CARGA DE CONTEXTO:\nLee el archivo adjunto para actualizar tu memoria. NO generes código nuevo. Responde ÚNICAMENTE: **Contexto subido con éxito**.`;
            await this.gemini.sendPrompt(prompt, result.tempFilePath);
            console.log('  Contexto subido.\n');
        }
    }

    async handleSyncAll() {
        console.log('  [/sync-all] Sincronizando proyecto completo...');
        const result = createContextFile(this.projectRoot);
        if (result.fileCount > 0) {
            const prompt = `ACTUALIZACIÓN GLOBAL:\nLee el archivo adjunto. NO generes código. Responde: **Sincronización global exitosa**.`;
            await this.gemini.sendPrompt(prompt, result.tempFilePath);
            console.log('  Sincronización lista.\n');
        }
    }

    async handleSyncPartial(instruction) {
        const args = instruction.substring(5).trim();
        const filesToSync = args.split(' ').map(f => f.trim()).filter(f => f.length > 0);
        if (filesToSync.length === 0) return console.log('  Especifica al menos un archivo.');
        
        console.log('  [/sync] Sincronizando selección parcial...');
        const result = createPartialContextFile(this.projectRoot, filesToSync);
        if (result.fileCount > 0) {
            const prompt = `ACTUALIZACIÓN PARCIAL:\nLee el archivo adjunto. NO generes código. Responde: **Sincronización exitosa**.`;
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
}

module.exports = CommandDispatcher;