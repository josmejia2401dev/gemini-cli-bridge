const FileSystemUtils = require('./fileSystemUtils');

/**
 * Motor de patrones único para filtrado de archivos, directorios e ignorados.
 */
class PatternEngine {
  constructor() {
    this.ignoredDirs = new Set([
      '.git', '.idea', '.vscode', '.svn', '.hg',
      'node_modules', 'vendor', '.venv', 'venv', 'env',
      'target', 'build', 'dist', 'out', '.next', '.nuxt', '.angular',
      '.svelte-kit', '.astro', '.turbo', '.output', '.cache', 'coverage',
      '.session', 'temp', 'tmp', '.gradle'
    ]);

    this.ignoreFiles = new Set([
      'contexto_temp.txt',
      '.contexto_temp.txt',
      'historial_chat.md',
      '.session_chat_url.txt',
      '.session_repo_path.txt'
    ]);

    this.validPatterns = [
      '*.md', '*.markdown', '*.mdx',
      '*.js', '*.mjs', '*.cjs', '*.ts', '*.mts', '*.cts',
      '*.jsx', '*.tsx', '*.vue', '*.svelte', '*.astro',
      '*.css', '*.scss', '*.sass', '*.less', '*.pcss', '*.styl',
      '*.html', '*.htm', '*.svg',
      '*.json', '*.jsonc', '*.json5', '*.xml', '*.yml', '*.yaml', '*.toml', '*.properties',
      '*.env*', '*.graphql', '*.gql', '*.sql',
      '*.sh', '*.bash', '*.bat', '*.ps1',
      '*.py', '*.java', '*.kt', '*.kts', '*.groovy', '*.gradle',
      '*.go', '*.rs', '*.php', '*.cs',
      'Dockerfile*', 'Jenkinsfile*', 'Makefile*',
      'pom.xml', 'build.gradle', 'package.json', '*.lock*',
      '.gitignore', '.npmignore', '.dockerignore', '.editorconfig', '.prettierrc*', '.eslintrc*'
    ];

    this.compiledRegexes = this.validPatterns.map(p => this.parsePatternToRegex(p));
  }

  parsePatternToRegex(pattern = '') {
    if (pattern instanceof RegExp) return pattern;
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i');
  }

  isDirIgnored(dirName = '') {
    return this.ignoredDirs.has(dirName.toLowerCase());
  }

  shouldProcessFile(filePath = '') {
    const fileName = FileSystemUtils.getFileName(filePath);
    if (this.ignoreFiles.has(fileName)) return false;
    return this.compiledRegexes.some(regex => regex.test(fileName));
  }
}

module.exports = PatternEngine;