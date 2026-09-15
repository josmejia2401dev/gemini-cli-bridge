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
    // Permite formato: <<<READ: src/app.js, package.json>>>
    const readRegex = /<<<READ:\s*([^>]+)>>>/g;
    let readMatch;
    while ((readMatch = readRegex.exec(responseText)) !== null) {
        // Separar por comas y limpiar espacios
        const paths = readMatch[1].split(',').map(p => p.trim()).filter(p => p.length > 0);
        filesToRead.push(...paths);
        console.log(`  [👀 Agente] Solicitó leer: ${paths.join(', ')}`);
        count++;
    }

    // 3. CMD (Propuesta de comandos de terminal)
    const cmdRegex = /<<<CMD:\s*([^>]+)>>>/g;
    let cmdMatch;
    while ((cmdMatch = cmdRegex.exec(responseText)) !== null) {
        const command = cmdMatch[1].trim();
        console.log(`\n  [💻 Comando propuesto por IA]\n  > ${command}`);
        
        const answer = await repl.askQuestion('  ¿Deseas ejecutar este comando? (y/N): ');
        if (answer.trim().toLowerCase() === 'y') {
            try {
                console.log('  Ejecutando...');
                const output = execSync(command, { cwd: projectRoot, encoding: 'utf-8' });
                console.log(output);
                followUpContext += `\n[SISTEMA: Resultado del comando '${command}':\n${output}]\n`;
            } catch (err) {
                console.error('  Error al ejecutar:', err.message);
                followUpContext += `\n[SISTEMA: Error al ejecutar comando '${command}': ${err.message}]\n`;
            }
        } else {
            console.log('  Comando cancelado.');
            followUpContext += `\n[SISTEMA: El usuario denegó la ejecución del comando: ${command}]\n`;
        }
        count++;
    }

    // 4. WRITE / FILE (A Prueba de Balas)
    // Actualizado para que el Regex se detenga si encuentra SYNC_ALL
    const writeRegex = /<<<(?:WRITE|FILE):\s*([^>]+)>>>([\s\S]*?)(?=(?:<<<(?:WRITE|FILE|MOVE|DELETE|READ|CMD|SYNC_ALL):)|$)/g;
    let writeMatch;
    while ((writeMatch = writeRegex.exec(responseText)) !== null) {
        const relPath = writeMatch[1].trim();
        const rawContent = writeMatch[2].trim();
        
        if (!relPath) continue;

        // Búsqueda ESTRICTA del bloque de código (Ignora basura conversacional)
        const codeBlockRegex = /```[a-zA-Z]*\n([\s\S]*?)\n```/;
        const blockMatch = rawContent.match(codeBlockRegex);
        
        // Si no hay backticks, fallback limpio quitando líneas huérfanas
        let fullCode = blockMatch ? blockMatch[1].trim() : rawContent.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
        
        if (!fullCode) continue;

        const absPath = path.resolve(projectRoot, relPath);
        if (!isSafePath(absPath, projectRoot)) continue;

        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        
        if (fs.existsSync(absPath)) {
            const oldContent = fs.readFileSync(absPath, 'utf-8');
            
            // FILTRO DE SEGURIDAD CONTRA HALLUCINATIONS (Evitar Merges Destructivos)
            if (oldContent.length > 100 && fullCode.length < 30 && !fullCode.includes(oldContent.substring(0, 10))) {
                console.error(`  [⛔ ALERTA CRÍTICA] Código sospechosamente corto para ${relPath}. Posible merge omitido.`);
                followUpContext += `\n[SISTEMA: Violación de regla. Intentaste sobrescribir ${relPath} con código incompleto. REGLA: Genera el CÓDIGO COMPLETO.]\n`;
                continue; // Aborta escritura
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

    // Se retornan los nuevos flags al orquestador principal (index.js)
    return { 
        count, 
        followUpContext: followUpContext.trim(), 
        syncAllRequested, 
        filesToRead 
    };
}

module.exports = { parseAndExecuteCode };