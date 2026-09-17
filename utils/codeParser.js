const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function isSafePath(targetPath, projectRoot) {
    return targetPath.startsWith(path.resolve(projectRoot));
}

async function parseAndExecuteCode(responseText, projectRoot, repl) {
    let count = 0;
    let followUpContext = ''; // Para devolver info a la IA dinámicamente
    let syncAllRequested = false;
    let filesToRead = []; // Array para almacenar las rutas solicitadas por la IA

    // 1. SYNC ALL (Sincronización Autónoma)
    if (responseText.includes('<<<SYNC_ALL>>>')) {
        console.log('  [🔄 Agente] Solicitud de sincronización global detectada.');
        syncAllRequested = true;
    }

    // 2. READ (Lectura Autónoma de múltiples archivos)
    const readRegex = /<<<READ:\s*([^>]+)>>>/g;
    let readMatch;
    while ((readMatch = readRegex.exec(responseText)) !== null) {
        const paths = readMatch[1].split(',').map(p => p.trim()).filter(p => p.length > 0);
        filesToRead.push(...paths);
        console.log(`  [👀 Agente] Solicitó leer: ${paths.join(', ')}`);
        count++;
    }

    // 3. CMD (Propuesta de comandos con Guía y Motivo del Usuario)
    const cmdRegex = /<<<CMD:\s*([^>]+)>>>/g;
    let cmdMatch;
    let stopAutonomousLoop = false;

    while ((cmdMatch = cmdRegex.exec(responseText)) !== null) {
        const command = cmdMatch[1].trim();
        console.log(`\n  [💻 Comando propuesto por IA en: ${projectRoot}]\n  > ${command}`);
        
        // FRENO DE SEGURIDAD: Si la IA repite el mismo comando fallido
        if (global.lastFailedCommand === command) {
            console.log('\n  [⛔ BUCLE DETECTADO] La IA insiste en el mismo comando erróneo.');
            console.log('  [SISTEMA] Abortando autonomía. Escríbele el motivo al agente.\n');
            global.lastFailedCommand = null;
            stopAutonomousLoop = true;
            break;
        }

        const answer = await repl.askQuestion('  ¿Deseas ejecutar este comando? (y/N [motivo]): ');
        const trimmedAnswer = answer.trim();
        
        // Extraemos la primera palabra ('y', 'n', 'yes', 'no', 'sÍ') y el motivo posterior
        const firstWord = trimmedAnswer.split(' ')[0].toLowerCase();
        const isApproved = firstWord === 'y' || firstWord === 'yes' || firstWord === 'si' || firstWord === 'sí';
        const userReason = trimmedAnswer.substring(firstWord.length).trim();

        if (isApproved) {
            try {
                console.log('  Ejecutando...');
                const output = execSync(command, { 
                    cwd: projectRoot, 
                    encoding: 'utf-8',
                    stdio: 'pipe' 
                });
                console.log(output);

                let feedback = `\n[SISTEMA: Resultado del comando '${command}':\n${output}]\n`;
                if (userReason) {
                    feedback += `[NOTA DEL USUARIO AL APROBAR: ${userReason}]\n`;
                }
                followUpContext += feedback;
                global.lastFailedCommand = null; 
            } catch (err) {
                const errorOutput = err.stderr || err.stdout || err.message;
                console.error('  Error al ejecutar:', errorOutput);
                global.lastFailedCommand = command;
                
                followUpContext += `\n[SISTEMA: Error al ejecutar comando '${command}':\n${errorOutput}]\n`;
                if (userReason) {
                    followUpContext += `[OBSERVACIÓN ADICIONAL DEL USUARIO: ${userReason}]\n`;
                }
            }
        } else {
            if (userReason) {
                // Si explicas el motivo de la negación, la IA recibe la corrección y reintenta
                console.log(`  ⛔ Comando denegado con observación: "${userReason}"`);
                followUpContext += `\n[SISTEMA: El usuario denegó la ejecución del comando '${command}' indicando el siguiente motivo: "${userReason}". Ajusta tu estrategia o comando en base a esta observación.]\n`;
            } else {
                // Si solo escribes "n" o "N", se frena la autonomía y te devuelve la terminal
                console.log('  ⛔ Comando cancelado por el usuario.');
                console.log('  [SISTEMA] Autonomía pausada. Ingresa tu instrucción para la IA.\n');
                stopAutonomousLoop = true;
                followUpContext = ''; 
                break;
            }
        }
        count++;
    }

    // 4. WRITE / FILE (A Prueba de Balas)
    const writeRegex = /<<<(?:WRITE|FILE):\s*([^>]+)>>>([\s\S]*?)(?=(?:<<<(?:WRITE|FILE|MOVE|DELETE|READ|CMD|SYNC_ALL):)|$)/g;
    let writeMatch;
    while ((writeMatch = writeRegex.exec(responseText)) !== null) {
        const relPath = writeMatch[1].trim();
        const rawContent = writeMatch[2].trim();

        if (!relPath) continue;

        const codeBlockRegex = /```[a-zA-Z]*\n([\s\S]*?)\n```/;
        const blockMatch = rawContent.match(codeBlockRegex);

        let fullCode = blockMatch ? blockMatch[1].trim() : rawContent.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();

        if (!fullCode) continue;

        const absPath = path.resolve(projectRoot, relPath);
        if (!isSafePath(absPath, projectRoot)) continue;

        fs.mkdirSync(path.dirname(absPath), { recursive: true });

        if (fs.existsSync(absPath)) {
            const oldContent = fs.readFileSync(absPath, 'utf-8');

            if (oldContent.length > 100 && fullCode.length < 30 && !fullCode.includes(oldContent.substring(0, 10))) {
                console.error(`  [⛔ ALERTA CRÍTICA] Código sospechosamente corto para ${relPath}. Posible merge omitido.`);
                followUpContext += `\n[SISTEMA: Violación de regla. Intentaste sobrescribir ${relPath} con código incompleto. REGLA: Genera el CÓDIGO COMPLETO.]\n`;
                continue;
            }

            fs.copyFileSync(absPath, `${absPath}.bak`);
            console.log(`   Backup creado: ${relPath}.bak`);
        }

        fs.writeFileSync(absPath, fullCode, 'utf-8');
        console.log(`   📝 Escrito/Actualizado: ${relPath}`);
        count++;
    }

    // 5. MOVE / RENAME
    const moveRegex = /<<<MOVE:\s*([^>]+?)\s*>\s*([^>]+?)>>>/g;
    let moveMatch;
    while ((moveMatch = moveRegex.exec(responseText)) !== null) {
        const originRel = moveMatch[1].trim();
        const destRel = moveMatch[2].trim();
        const absOrigin = path.resolve(projectRoot, originRel);
        const absDest = path.resolve(projectRoot, destRel);

        if (isSafePath(absOrigin, projectRoot) && isSafePath(absDest, projectRoot) && fs.existsSync(absOrigin)) {
            fs.mkdirSync(path.dirname(absDest), { recursive: true });
            fs.renameSync(absOrigin, absDest);
            console.log(`   🚚 Movido: ${originRel} -> ${destRel}`);
            count++;
        }
    }

    // 6. DELETE
    const deleteRegex = /<<<DELETE:\s*([^>]+)>>>/g;
    let deleteMatch;
    while ((deleteMatch = deleteRegex.exec(responseText)) !== null) {
        const relPath = deleteMatch[1].trim();
        const absPath = path.resolve(projectRoot, relPath);

        if (isSafePath(absPath, projectRoot) && fs.existsSync(absPath)) {
            fs.rmSync(absPath, { recursive: true, force: true });
            console.log(`   🗑️ Eliminado: ${relPath}`);
            count++;
        }
    }

    return { 
        count, 
        followUpContext: followUpContext.trim(), 
        syncAllRequested, 
        filesToRead,
        stopAutonomousLoop 
    };
}

module.exports = { parseAndExecuteCode };