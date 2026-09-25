const FileSystemUtils = require('./fileSystemUtils');
const PatternEngine = require('./patternEngine');

const patternEngine = new PatternEngine();

function scanProject(dir, projectRoot) {
  let contextText = '';
  let fileList = [];

  if (!FileSystemUtils.fileExists(dir)) return { contextText, fileList };

  const items = FileSystemUtils.readDir(dir);
  for (const item of items) {
    const relPath = FileSystemUtils.getRelativePath(projectRoot, item.fullPath);

    if (item.isDirectory) {
      if (!patternEngine.isDirIgnored(item.name)) {
        const subResult = scanProject(item.fullPath, projectRoot);
        contextText += subResult.contextText;
        fileList = fileList.concat(subResult.fileList);
      }
    } else {
      if (patternEngine.shouldProcessFile(item.fullPath)) {
        try {
          const content = FileSystemUtils.readFile(item.fullPath);
          contextText += `\n<<<FILE_START: ${relPath}>>>\n${content}\n<<<FILE_END: ${relPath}>>>\n`;
          fileList.push(relPath);
        } catch (err) {
          console.error(`⚠️ Omitido (No se pudo leer): ${relPath}`);
        }
      }
    }
  }
  return { contextText, fileList };
}

function createContextFile(projectRoot) {
  const tempFilePath = FileSystemUtils.resolveSafePath(projectRoot, 'contexto_temp.txt');

  FileSystemUtils.removeIfExists(tempFilePath);

  const result = scanProject(projectRoot, projectRoot);
  const header = `===============================================================\n` +
    `ESTRUCTURA Y CÓDIGO DEL PROYECTO LOCAL\n` +
    `Total de archivos: ${result.fileList.length}\n` +
    `===============================================================\n\n`;

  FileSystemUtils.writeFile(tempFilePath, header + result.contextText);

  console.log('\n📋 Inventario de archivos escaneados y empaquetados:');
  if (result.fileList.length > 0) {
    result.fileList.forEach(file => console.log(`   ✔️ ${file}`));
  } else {
    console.log('   ⚠️ No se encontró ningún archivo válido para empaquetar.');
  }
  console.log(`\n📦 Total empaquetado: ${result.fileList.length} archivos.\n`);

  return { tempFilePath, fileCount: result.fileList.length, contextText: result.contextText };
}

function createPartialContextFile(projectRoot, filePaths) {
  const tempFilePath = FileSystemUtils.resolveSafePath(projectRoot, 'contexto_temp.txt');

  FileSystemUtils.removeIfExists(tempFilePath);

  let contextText = '';
  let fileList = [];

  for (const relPath of filePaths) {
    const fullPath = FileSystemUtils.resolveSafePath(projectRoot, relPath);
    if (FileSystemUtils.fileExists(fullPath) && FileSystemUtils.isFile(fullPath)) {
      try {
        const content = FileSystemUtils.readFile(fullPath);
        contextText += `\n<<<FILE_START: ${relPath}>>>\n${content}\n<<<FILE_END: ${relPath}>>>\n`;
        fileList.push(relPath);
      } catch (err) {
        console.error(`⚠️ Omitido (No se pudo leer): ${relPath}`);
      }
    } else {
      console.error(`⚠️ Archivo ignorado (No existe en disco): ${relPath}`);
    }
  }

  const header = `===============================================================\n` +
    `ACTUALIZACIÓN PARCIAL DE CÓDIGO (${fileList.length} ARCHIVO/S)\n` +
    `===============================================================\n\n`;

  FileSystemUtils.writeFile(tempFilePath, header + contextText);

  console.log('\n📋 Archivos empaquetados para sincronización parcial:');
  fileList.forEach(file => console.log(`   ✔️ ${file}`));

  return { tempFilePath, fileCount: fileList.length, contextText };
}


function searchProject({
  projectRoot = '',
  query = '',
  caseSensitive = false,
  maxMatches = 200
} = {}) {
  const results = [];
  const needle = caseSensitive ? String(query) : String(query).toLowerCase();
  if (!needle || !FileSystemUtils.fileExists(projectRoot)) return results;

  const visit = (dir) => {
    if (results.length >= maxMatches) return;
    for (const item of FileSystemUtils.readDir(dir)) {
      if (results.length >= maxMatches) return;
      if (item.isDirectory) {
        if (!patternEngine.isDirIgnored(item.name)) visit(item.fullPath);
        continue;
      }
      if (!patternEngine.shouldProcessFile(item.fullPath)) continue;

      let content = '';
      try { content = FileSystemUtils.readFile(item.fullPath); } catch (_) { continue; }
      const haystack = caseSensitive ? content : content.toLowerCase();
      if (!haystack.includes(needle)) continue;

      const relPath = FileSystemUtils.getRelativePath(projectRoot, item.fullPath);
      const matches = [];
      content.split(/\r?\n/).forEach((line, index) => {
        const lineValue = caseSensitive ? line : line.toLowerCase();
        if (lineValue.includes(needle)) matches.push({ line: index + 1, text: line.trim() });
      });
      results.push({ file: relPath, matches });
    }
  };

  visit(projectRoot);
  return results;
}

module.exports = { scanProject, createContextFile, createPartialContextFile, searchProject };