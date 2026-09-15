#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const REPL = require('./cli/repl');
const CommandDispatcher = require('./core/commandDispatcher');
const { parseAndExecuteCode } = require('./utils/codeParser');
const GeminiClient = require('./llm/geminiClient');
// IMPORTACIÓN NUEVA: Necesaria para empaquetar los archivos que la IA pida leer
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
            const choice = await repl.askQuestion('  Se detectó chat previo.\n [1] Retomar\n [2] Nuevo\n Selecciona: ');
            if (choice.trim() === '1') targetUrl = savedUrl;
        }
    }

    console.log('\n  Iniciando motor de IA...');
    const gemini = new GeminiClient(sessionDir, chatUrlFile);
    await gemini.init(targetUrl);

    // Al instanciar el Dispatcher, garantizamos que inyecte las reglas en TODO mensaje
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
<<<CMD: comando>>> (para terminal)
<<<SYNC_ALL>>> (para pedir todo el código)
<<<MOVE>>> y <<<DELETE>>>

Por favor, responde ÚNICAMENTE diciendo: "🤖 Agente inicializado y listo para codificar."`;

        const responseText = await gemini.sendPrompt(initPrompt, null);
        console.log('\n-------------------- IA --------------------');
        console.log(responseText);
        console.log('--------------------------------------------\n');
    }

    while (true) {
        let instruction = await repl.askQuestion('\nGemini Dev > ');

        // Habilitador de Copy & Paste Masivo
        if (instruction.trim() === '/paste') {
            instruction = await repl.askMultiline();
        }

        const dispatchResult = await dispatcher.dispatch(instruction, repl);
        if (dispatchResult.skip) continue;

        let currentPrompt = dispatchResult.finalPrompt;
        let fileToUpload = null; // Controla qué archivo adjuntar (contexto_temp.txt)

        // BUCLE AUTÓNOMO (Si la IA pide leer archivos, sincronizar o ejecutar comandos)
        while (currentPrompt) {
            try {
                console.log('  Procesando con Gemini...');
                // Se envía el prompt y el archivo (si hay alguno en cola)
                const responseText = await gemini.sendPrompt(currentPrompt, fileToUpload);
                fileToUpload = null; // Se limpia la cola tras enviarlo

                console.log('\n-------------------- IA --------------------');
                console.log(responseText);
                console.log('--------------------------------------------\n');

                // Recibimos los nuevos flags del parser actualizado
                const { count, followUpContext, syncAllRequested, filesToRead } = await parseAndExecuteCode(responseText, projectRoot, repl);

                if (count > 0) console.log(`\n  ✅ Operación finalizada: ${count} acciones en disco.\n`);

                // TOMA DE DECISIONES AUTÓNOMAS BASADAS EN LA RESPUESTA DE LA IA
                if (syncAllRequested) {
                    console.log('  [SISTEMA] Preparando /sync-all automático...');
                    const result = createContextFile(projectRoot);
                    if (result.fileCount > 0) {
                        currentPrompt = `[SISTEMA: ACTUALIZACIÓN GLOBAL]\nAdjunto el repositorio completo actualizado. Por favor, continúa con la tarea solicitada previamente.`;
                        fileToUpload = result.tempFilePath;
                    } else {
                        currentPrompt = `[SISTEMA: Error al sincronizar. No se encontraron archivos válidos.]`;
                    }
                }
                else if (filesToRead && filesToRead.length > 0) {
                    console.log(`  [SISTEMA] Empaquetando ${filesToRead.length} archivo(s) solicitado(s)...`);
                    const result = createPartialContextFile(projectRoot, filesToRead);
                    if (result.fileCount > 0) {
                        currentPrompt = `[SISTEMA: ARCHIVOS SOLICITADOS]\nAdjunto el archivo de texto con el contexto de los archivos que pediste. Analízalos y continúa con la tarea.`;
                        fileToUpload = result.tempFilePath;
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