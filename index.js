#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const REPL = require('./cli/repl');
const CommandDispatcher = require('./core/commandDispatcher');
const GeminiPlaywrightProvider = require('./llm/providers/geminiPlaywright');
const ModelRouter = require('./llm/modelRouter');
const ToolRegistry = require('./tools/registry');
const AgentRuntime = require('./agent/runtime');
const MemoryDatabase = require('./memory/sqlite/db');
const OperationalMemory = require('./memory/sqlite/operational');
const EpisodicMemory = require('./memory/sqlite/episodic');
const ExecutionLogger = require('./observability/logger');
const paths = require('./config/paths');

const chatUrlFile = paths.CHAT_URL_FILE;
const repoPathFile = paths.REPO_PATH_FILE;
const commandsFile = path.join(__dirname, 'commands.json');
const sessionDir = paths.SESSION_DIR;

let dynamicCommands = {};
if (fs.existsSync(commandsFile)) {
    try { dynamicCommands = JSON.parse(fs.readFileSync(commandsFile, 'utf-8')); }
    catch (e) { console.error('  Error al leer commands.json.'); }
}

// 1. Declaramos la función principal de arranque
async function main() {
    const repl = new REPL();
    const logger = new ExecutionLogger();
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
    let isNewChat = false;

    if (fs.existsSync(chatUrlFile)) {
        const savedUrl = fs.readFileSync(chatUrlFile, 'utf-8').trim();
        if (savedUrl.includes('/app/')) {
            const chatsFile = paths.SAVED_CHATS_FILE;
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
            } else if (choice.trim() === '2') {
                targetUrl = 'https://gemini.google.com/app';
                isNewChat = true;
            } else if (choice.trim() === '3' && chatNames.length > 0) {
                console.log('\n  [CHATS GUARDADOS]');
                chatNames.forEach((name, index) => {
                    console.log(`  [${index + 1}]${name}`);
                });

                const chatChoice = await repl.askQuestion('  Ingresa el número del chat: ');
                const selectedIndex = parseInt(chatChoice.trim()) - 1;

                if (selectedIndex >= 0 && selectedIndex < chatNames.length) {
                    const selectedName = chatNames[selectedIndex];
                    targetUrl = savedChats[selectedName];
                    fs.writeFileSync(chatUrlFile, targetUrl, 'utf-8');
                    console.log(`  [SISTEMA] Se cargará el chat: "${selectedName}"`);
                } else {
                    console.log('  [!] Opción inválida. Iniciando un nuevo chat por defecto.');
                    isNewChat = true;
                }
            }
        }
    } else {
        isNewChat = true;
    }

    console.log('\n  Iniciando motor de IA (Playwright Provider)...');

    // INICIALIZACIÓN DE LA ARQUITECTURA V2
    const playwrightProvider = new GeminiPlaywrightProvider(sessionDir, chatUrlFile);
    await playwrightProvider.connect(targetUrl);

    const modelRouter = new ModelRouter(playwrightProvider);
    const toolRegistry = new ToolRegistry();
    const dbConnection = new MemoryDatabase();
    const operationalMemory = new OperationalMemory(dbConnection);
    const episodicMemory = new EpisodicMemory(dbConnection);

    const agentRuntime = new AgentRuntime({
        modelRouter,
        toolRegistry,
        projectRoot,
        repl,
        logger,
        episodicMemory
    });

    const geminiAdapter = playwrightProvider.client;
    const dispatcher = new CommandDispatcher(geminiAdapter, projectRoot, dynamicCommands);

    console.log('\n===============================================================');
    console.log(`   Agente CLI V2 Listo. Usa "/help" para comandos o "/paste".`);
    console.log('===============================================================\n');

    // INICIALIZACIÓN EN CHATS NUEVOS (Ejecución Única)
    if (isNewChat || targetUrl === 'https://gemini.google.com/app') {
        console.log('  [SISTEMA] Inicializando nuevo chat con reglas globales...');

        const initPrompt = `Eres un Agente Autónomo V2 con acceso al sistema de archivos.

# REGLA SUPREMA Y PRIORIDAD ABSOLUTA
- Las siguientes instrucciones son OBLIGATORIAS, aplican explícitamente a TODA la sesión de este chat y a CADA interacción.
- Prevalecen y priman sobre cualquier otra regla, instrucción posterior, contexto o perfil de agente (/dev, /refactor, etc.).
- JAMÁS deben omitirse, ignorarse o flexibilizarse bajo ninguna circunstancia.

# PROHIBICIÓN DE INTÉRPRETE WEB (CRÍTICO)
- PROHIBIDO usar la herramienta interna de análisis de código o ejecución de Python de la interfaz web de Gemini (NO uses "import subprocess", "import os", etc.).
- NO intentes ejecutar ni simular código en la nube de Google.
- Si necesitas ejecutar un comando, DEBES solicitar que se ejecute en la terminal local del usuario emitiendo EXCLUSIVAMENTE el objeto de herramienta correspondiente.

# INSTRUCCIONES DE TRABAJO GLOBALES

## Confirmación de Aplicación
- Antes de responder cualquier solicitud, inicia SIEMPRE tu respuesta con la línea:
  "✓ Instrucciones aplicadas" y luego continúa con lo solicitado.

## Idioma y Formato
- Responde siempre en español. Sé conciso, directo y evita explicaciones innecesarias o flujos conversacionales no solicitados.

## Alcance
- Implementar estrictamente lo solicitado. No agregar features, abstracciones ni configuraciones especulativas ("por si acaso").
- No introducir errores intencionales ni código de más.
- Si una mejora parece útil pero no fue pedida, proponerla primero y esperar confirmación antes de aplicarla.
- Limítate ÚNICAMENTE a lo que se te pide de forma explícita. No asumas requerimientos, no agregues funcionalidades extra ni imagines contexto no proporcionado.
- Si alguna instrucción, variable o requerimiento es ambiguo o no está totalmente definido, NO asumas nada: pregunta directamente al usuario para aclarar la duda antes de proponer algo.

## Flujo de Trabajo (Planificar -> Esperar Aprobación -> Ejecutar)
- Si el usuario pide explicaciones o análisis, responde únicamente con la explicación, sin generar o modificar código de inmediato.
- Si la tarea requiere cambios o creación de código, genera PRIMERO un plan de acción breve o una propuesta conceptual y ESPERA el visto bueno explícito del usuario antes de escribir o aplicar el código.
- No ejecutes ni apliques cambios sin confirmación previa.

## Arquitectura, Calidad y Nombramiento de Código
- Aplica estrictamente los principios KISS (Keep It Simple), DRY (Don't Repeat Yourself), YAGNI (You Aren't Gonna Need It) y SOLID. Escribe código limpio, modular, expresivo, legible, entendible y mantenible.
- Respeta los patrones de diseño (Creacionales, Estructurales, Comportamentales) y arquitecturas estándar cuando la solución verdaderamente lo requiera.
- Sigue estrictamente las convenciones de estilo y estándares de código aceptados por la comunidad.

## Nombramiento y Legibilidad
- Nombramiento Diciente en Inglés: Los nombres de variables, funciones, métodos, clases y archivos deben ser altamente descriptivos, explícitos y autoexplicativos, estrictamente en INGLÉS.
- Cero Comentarios/Documentación Innecesaria: NO comentes el código ni generes documentación (JSDoc, docstrings) a menos que el usuario lo pida expresamente.

# PROTOCOLO DE HERRAMIENTAS (JS OBJECT MODE)
Cuando se te apruebe o solicite ejecutar una acción, DEBES responder ÚNICAMENTE con un objeto JavaScript estructurado. Aprovecha los template literals (\`) para evitar problemas de escape de caracteres:

{
  tool: "nombre_de_herramienta",
  arguments: { ... }
}

Herramientas disponibles:
- "execute_command": arguments: { command: \`comando literal con "comillas" internas\` } (Usa BACKTICKS).
- "write_file": arguments: { filePath: \`ruta\`, content: \`código completo\` } (Usa BACKTICKS).
- "read_files": arguments: { paths: [\`ruta/1.js\`, \`ruta/2.js\`] } (Usa BACKTICKS).

PROHIBIDO usar etiquetas antiguas como <<<CMD>>> o <<<WRITE>>> y PROHIBIDO generar código Python de ejecución interna.

Por favor, responde ÚNICAMENTE diciendo:
"✓ Instrucciones aplicadas

🤖 Agente V2 (JS Object Mode) inicializado y listo para codificar."`;

        const response = await modelRouter.generate({ prompt: initPrompt });
        console.log('\n-------------------- IA --------------------');
        console.log(response.text);
        console.log('--------------------------------------------\n');
    }

    // CAPTURA DE EXCEPCIONES NO CONTROLADAS Y PLAYWRIGHT / READLINE
    process.on('unhandledRejection', (reason) => {
        if (reason && (reason.code === 'ABORT_ERR' || reason.name === 'AbortError')) {
            return;
        }
        if (reason && reason.message && reason.message.includes('closed')) {
            return;
        }
        console.error('\n  [!] Error no controlado:', reason?.message || reason);
    });

    // GESTIÓN DE CTRL + C (SIGINT)
    global.isProcessing = false;
    global.abortLoop = false;
    let sigintCount = 0;

    repl.rl.on('SIGINT', async () => {
        if (global.isProcessing) {
            console.log('\n  🛑 [SISTEMA] Interrumpiendo IA. Deteniendo generación...');
            global.abortLoop = true;
            await playwrightProvider.stopGeneration();
        } else {
            sigintCount++;
            if (sigintCount === 1) {
                console.log('\n  ℹ️ Presiona Ctrl+C de nuevo o escribe /exit para salir.');
                setTimeout(() => { sigintCount = 0; }, 2000);
            } else {
                console.log('\n  Cerrando aplicación...');
                try { await playwrightProvider.close(); } catch (e) { }
                repl.close();
                process.exit(0);
            }
        }
    });

    while (true) {
        global.abortLoop = false;
        let instruction = await repl.askQuestion('\nGemini Dev V2 > ');

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

// 2. Ejecutamos la función principal y capturamos errores críticos
main().catch(err => {
    console.error('\n  [!] Error crítico al iniciar la aplicación:', err);
    process.exit(1);
});