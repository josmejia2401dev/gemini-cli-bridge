#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const REPL = require('./cli/repl');
const CommandDispatcher = require('./core/commandDispatcher');
const { parseAndExecuteCode } = require('./utils/codeParser');
const GeminiClient = require('./llm/geminiClient');
const { createContextFile, createPartialContextFile } = require('./utils/fileScanner');

const chatUrlFile = path.join(__dirname, '.session_chat_url.txt');
const repoPathFile = path.join(__dirname, '.session_repo_path.txt');
const commandsFile = path.join(__dirname, 'commands.json');
const sessionDir = path.join(__dirname, '.session');

let dynamicCommands = {};
if (fs.existsSync(commandsFile)) {
    try { dynamicCommands = JSON.parse(fs.readFileSync(commandsFile, 'utf-8')); }
    catch (e) { console.error('  Error al leer commands.json.'); }
}

(async () => {
    const repl = new REPL();
    let projectRoot = process.argv[2];

    if (!projectRoot && fs.existsSync(repoPathFile)) {
        const savedPath = fs.readFileSync(repoPathFile, 'utf-8').trim();
        if (fs.existsSync(path.resolve(savedPath))) projectRoot = savedPath;
    }

    while (!projectRoot || !fs.existsSync(path.resolve(projectRoot))) {
        if (projectRoot) console.log(`  La ruta "${projectRoot}" es inválida.`);
        const inputPath = await repl.askQuestion('  Ingresa la ruta del repositorio (Enter para usar actual "."): ');
        projectRoot = inputPath.trim() || '.';
    }

    projectRoot = path.resolve(projectRoot);
    fs.writeFileSync(repoPathFile, projectRoot, 'utf-8');
    console.log(`  Repositorio vinculado: ${projectRoot}\n`);

    let targetUrl = 'https://gemini.google.com/app';
    if (fs.existsSync(chatUrlFile)) {
        const savedUrl = fs.readFileSync(chatUrlFile, 'utf-8').trim();
        if (savedUrl.includes('/app/')) {
            // Leer chats guardados
            const chatsFile = path.join(__dirname, '.session_chats.json');
            let savedChats = {};
            if (fs.existsSync(chatsFile)) {
                try { savedChats = JSON.parse(fs.readFileSync(chatsFile, 'utf-8')); }
                catch (e) { console.error('  Error al leer los chats guardados.'); }
            }

            const chatNames = Object.keys(savedChats);

            console.log('  Se detectó actividad previa.');
            console.log('  [1] Retomar último chat activo');
            console.log('  [2] Iniciar Nuevo chat');

            if (chatNames.length > 0) {
                console.log('  [3] Cargar un chat guardado');
            }

            const choice = await repl.askQuestion('  Selecciona una opción: ');

            if (choice.trim() === '1') {
                targetUrl = savedUrl;
            } else if (choice.trim() === '3' && chatNames.length > 0) {
                console.log('\n  [CHATS GUARDADOS]');
                chatNames.forEach((name, index) => {
                    console.log(`  [${index + 1}] ${name}`);
                });

                const chatChoice = await repl.askQuestion('  Ingresa el número del chat: ');
                const selectedIndex = parseInt(chatChoice.trim()) - 1;

                if (selectedIndex >= 0 && selectedIndex < chatNames.length) {
                    const selectedName = chatNames[selectedIndex];
                    targetUrl = savedChats[selectedName];
                    // Actualizar el archivo de última sesión
                    fs.writeFileSync(chatUrlFile, targetUrl, 'utf-8');
                    console.log(`  [SISTEMA] Se cargará el chat: "${selectedName}"`);
                } else {
                    console.log('  [!] Opción inválida. Iniciando un nuevo chat por defecto.');
                }
            }
        }
    }

    console.log('\n  Iniciando motor de IA...');
    const gemini = new GeminiClient(sessionDir, chatUrlFile);
    await gemini.init(targetUrl);
    const dispatcher = new CommandDispatcher(gemini, projectRoot, dynamicCommands);

    console.log('\n===============================================================');
    console.log(`   Agente CLI Listo. Usa "/help" para comandos o "/paste" para bloques largos.`);
    console.log('===============================================================\n');

    // INICIALIZACIÓN AUTOMÁTICA EN CHATS NUEVOS
    if (!fs.existsSync(chatUrlFile) || targetUrl === 'https://gemini.google.com/app') {
        console.log('  [SISTEMA] Inicializando nuevo chat con reglas globales...');
        const initPrompt = `Eres un Agente Autónomo con acceso al sistema de archivos.
Tus comandos permitidos son:
<<<WRITE: ruta>>> (siempre código completo)
<<<READ: rutas>>> (para leer archivos)
<<<CMD: comando>>> (LITERAL Y EXACTO: ejecutable al inicio, luego argumentos. Jamás alteres el orden. Si el usuario indica un comando a ejecutar, usa ese texto exactamente igual sin cambiar ni reordenar nada)
<<<SYNC_ALL>>> (para pedir todo el código)
<<<MOVE>>> y <<<DELETE>>>

Por favor, responde ÚNICAMENTE diciendo: "🤖 Agente inicializado y listo para codificar."`;

        const responseText = await gemini.sendPrompt(initPrompt, null);
        console.log('\n-------------------- IA --------------------');
        console.log(responseText);
        console.log('--------------------------------------------\n');
    }

    // GESTIÓN DE CTRL + C (SIGINT)
    global.isProcessing = false;
    global.abortLoop = false;

    repl.rl.on('SIGINT', async () => {
        if (global.isProcessing) {
            console.log('\n  🛑 [SISTEMA] Interrumpiendo IA. Deteniendo generación...');
            global.abortLoop = true;
            await gemini.stopGeneration();
        } else {
            console.log('\n  ℹ️ Para salir de forma segura, escribe /exit y presiona Enter.');
        }
    });

    while (true) {
        global.abortLoop = false;
        let instruction = await repl.askQuestion('\nGemini Dev > ');

        // Habilitador de Copy & Paste Masivo
        if (instruction.trim() === '/paste') {
            instruction = await repl.askMultiline();
        }

        const dispatchResult = await dispatcher.dispatch(instruction, repl);
        // Asignación dinámica del nuevo directorio de trabajo
        if (dispatchResult.newRoot) {
            projectRoot = dispatchResult.newRoot;
        }

        if (dispatchResult.skip) continue;

        let currentPrompt = dispatchResult.finalPrompt;
        let fileToUpload = null; // Controla qué archivo adjuntar (contexto_temp.txt)

        // BUCLE AUTÓNOMO (Si la IA pide leer archivos, sincronizar o ejecutar comandos)
        while (currentPrompt) {
            try {
                global.isProcessing = true;
                console.log('  Procesando con Gemini...');
                // Se envía el prompt y el archivo (si hay alguno en cola)
                const responseText = await gemini.sendPrompt(currentPrompt, fileToUpload);

                global.isProcessing = false;
                // Si presionaste Ctrl+C mientras generaba, cancelamos el flujo
                if (global.abortLoop) {
                    console.log('  [SISTEMA] Bucle y ejecución cancelados por el usuario.');
                    break;
                }

                fileToUpload = null; // Se limpia la cola tras enviarlo

                console.log('\n-------------------- IA --------------------');
                console.log(responseText);
                console.log('--------------------------------------------\n');

                // Recibimos los nuevos flags del parser actualizado
                const { count, followUpContext, syncAllRequested, filesToRead, stopAutonomousLoop } = await parseAndExecuteCode(responseText, projectRoot, repl);

                if (stopAutonomousLoop) {
                    currentPrompt = null;
                    break;
                }

                if (count > 0) {
                    console.log(`\n  ✅ Operación finalizada: ${count} acciones en disco.\n`);
                }

                // TOMA DE DECISIONES AUTÓNOMAS BASADAS EN LA RESPUESTA DE LA IA
                if (syncAllRequested) {
                    console.log('  [SISTEMA] Preparando /sync-all automático...');
                    const result = createContextFile(projectRoot);
                    if (result.fileCount > 0) {
                        currentPrompt = `[SISTEMA: ACTUALIZACIÓN GLOBAL]\nAdjunto el repositorio completo actualizado con un total de ${result.fileCount} archivos. Por favor, continúa con la tarea solicitada previamente.`;
                        fileToUpload = result.tempFilePath;
                    } else {
                        currentPrompt = `[SISTEMA: Error al sincronizar. No se encontraron archivos válidos.]`;
                    }
                }
                else if (filesToRead && filesToRead.length > 0) {
                    console.log(`  [SISTEMA] Empaquetando ${filesToRead.length} archivo(s) solicitado(s)...`);
                    const result = createPartialContextFile(projectRoot, filesToRead);
                    if (result.fileCount > 0) {
                        currentPrompt = `[SISTEMA: ARCHIVOS SOLICITADOS]\nAdjunto el archivo de texto con el contexto de los ${result.fileCount} archivos que pediste. Analízalos y continúa con la tarea.`; fileToUpload = result.tempFilePath;
                    } else {
                        currentPrompt = `[SISTEMA: Los archivos solicitados no existen en el disco o están vacíos. Verifica las rutas y reintenta.]`;
                    }
                }
                else if (followUpContext) {
                    console.log('  [SISTEMA] Autonomía activa: Retornando datos de comandos a Gemini...');
                    currentPrompt = `[SISTEMA: FEEDBACK DE TUS COMANDOS]\n${followUpContext}\n\nPor favor, continúa con la tarea basándote en esta nueva información.`;
                }
                else {
                    currentPrompt = null; // Se terminaron las acciones autónomas, el bucle se cierra y vuelve a pedirte input
                }
            } catch (err) {
                console.error('\n  Error en la comunicación:', err.message);
                break;
            }
        }
    }
})();