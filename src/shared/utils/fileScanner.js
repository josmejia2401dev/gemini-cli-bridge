const fs = require('fs');
const path = require('path');

const ignoreDirs = new Set([
  '.git', '.idea', '.vscode', '.svn', '.hg',
  'node_modules', 'vendor', '.venv', 'venv', 'env',
  'target', 'build', 'dist', 'out', '.next', '.nuxt', '.angular',
  '.svelte-kit', '.astro', '.turbo', '.output', '.cache', 'coverage',
  '.session', 'temp', 'tmp', '.gradle'
]);

const ignoreFiles = new Set([
  'contexto_temp.txt',
  '.contexto_temp.txt',
  'historial_chat.md',
  '.session_chat_url.txt',
  '.session_repo_path.txt'
]);

// LISTA DE PATRONES CON SOPORTE WILDCARD (*) Y REGEX
const validPatterns = [
  '*.md', '*.markdown', '*.mdx',                              // Documentación Markdown
  '*.js', '*.mjs', '*.cjs', '*.ts', '*.mts', '*.cts',        // JavaScript / TypeScript
  '*.jsx', '*.tsx', '*.vue', '*.svelte', '*.astro',          // Web Frameworks
  '*.css', '*.scss', '*.sass', '*.less', '*.pcss', '*.styl', // Estilos
  '*.html', '*.htm', '*.svg',                                // Marcado
  '*.json', '*.jsonc', '*.json5', '*.xml', '*.yml', '*.yaml', '*.toml', '*.properties', // Config/Datos
  '*.env*', '*.graphql', '*.gql', '*.sql',                   // APIs y Variables de Entorno
  '*.sh', '*.bash', '*.bat', '*.ps1',                        // Scripts de Consola
  '*.py', '*.java', '*.kt', '*.kts', '*.groovy', '*.gradle', // Backend & JVM
  '*.go', '*.rs', '*.php', '*.cs',                           // Lenguajes de Backend
  'Dockerfile*', 'Jenkinsfile*', 'Makefile*',                // CI/CD y Contenedores
  'pom.xml', 'build.gradle', 'package.json', '*.lock*',      // Gestores de Paquetes
  '.gitignore', '.npmignore', '.dockerignore', '.editorconfig', '.prettierrc*', '.eslintrc*'
];

// Transforma comodines (ej. *.md) en expresiones regulares internas (ej. /^.*\.md$/i)
function parsePatternToRegex(pattern) {
  if (pattern instanceof RegExp) return pattern;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escapa caracteres especiales de Regex excepto *
    .replace(/\*/g, '.*');               // Convierte el comodín * en .*
  return new RegExp(`^${escaped}$`, 'i');
}

// Compilado automático de patrones a Regex
const compiledRegexes = validPatterns.map(parsePatternToRegex);

function isFileValid(filename) {
  const filenameLower = filename.toLowerCase();
  if (ignoreFiles.has(filenameLower)) return false;
  return compiledRegexes.some(regex => regex.test(filename));
}

function scanProject(dir, projectRoot) {
  let contextText = '';
  let fileList = [];

  if (!fs.existsSync(dir)) return { contextText, fileList };

  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');

    if (item.isDirectory()) {
      if (!ignoreDirs.has(item.name)) {
        const subResult = scanProject(fullPath, projectRoot);
        contextText += subResult.contextText;
        fileList = fileList.concat(subResult.fileList);
      }
    } else {
      // Validación usando el motor de Regex
      if (isFileValid(item.name)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
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
  const tempFilePath = path.join(projectRoot, 'contexto_temp.txt');

  if (fs.existsSync(tempFilePath)) {
    try { fs.unlinkSync(tempFilePath); } catch (e) {}
  }

  const result = scanProject(projectRoot, projectRoot);
  const header = `===============================================================\n` +
                 `ESTRUCTURA Y CÓDIGO DEL PROYECTO LOCAL\n` +
                 `Total de archivos: ${result.fileList.length}\n` +
                 `===============================================================\n\n`;

  fs.writeFileSync(tempFilePath, header + result.contextText, 'utf-8');

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
  const tempFilePath = path.join(projectRoot, 'contexto_temp.txt');

  if (fs.existsSync(tempFilePath)) {
    try { fs.unlinkSync(tempFilePath); } catch (e) {}
  }

  let contextText = '';
  let fileList = [];

  for (const relPath of filePaths) {
    const fullPath = path.resolve(projectRoot, relPath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
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

  fs.writeFileSync(tempFilePath, header + contextText, 'utf-8');

  console.log('\n📋 Archivos empaquetados para sincronización parcial:');
  fileList.forEach(file => console.log(`   ✔️ ${file}`));

  return { tempFilePath, fileCount: fileList.length, contextText };
}

module.exports = { scanProject, createContextFile, createPartialContextFile };