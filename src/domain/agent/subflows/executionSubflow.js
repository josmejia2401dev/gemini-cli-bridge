const ExecutionTask = require('../contracts/executionTask');
const ExecutionResult = require('../contracts/executionResult');
const Verifier = require('../verifier');

class ExecutionSubflow {
  constructor({
    toolRegistry = null,
    projectRoot = '',
    repl = null,
    verifier = Verifier
  } = {}) {
    if (!toolRegistry) {
      throw new Error('[ExecutionSubflow] toolRegistry es obligatorio.');
    }

    if (!projectRoot) {
      throw new Error('[ExecutionSubflow] projectRoot es obligatorio.');
    }

    this.toolRegistry = toolRegistry;
    this.projectRoot = projectRoot;
    this.repl = repl;
    this.verifier = verifier;
  }

  async execute(task = null) {
    const startedAt = Date.now();

    if (!(task instanceof ExecutionTask)) {
      const result = ExecutionResult.fail({
        error: 'La entrada no es una instancia válida de ExecutionTask.',
        durationMs: Date.now() - startedAt
      });

      this.printResult({ task, result });
      return result;
    }

    console.log(`\n  ▶️ [EXECUTION] [${task.id}] ${task.description}`);
    console.log(`     🔧 Tool: ${task.tool || 'N/A'}`);
    console.log(`     📥 Args: ${JSON.stringify(task.args, null, 2)}`);

    if (!task.hasExplicitTool()) {
      const result = ExecutionResult.fail({
        error: 'La tarea no define una herramienta ejecutable explícita.',
        stdout: `Tarea: ${task.description}`,
        durationMs: Date.now() - startedAt
      });

      this.printResult({ task, result });
      return result;
    }

    const { tool, args } = task;

    try {
      if (tool === 'execute_command') {
        const command = String(args.command || '');
        console.log(`     💻 Command: ${command}`);

        const preCheck = this.verifier.preExecuteCommand(command);
        if (!preCheck.valid) {
          const result = ExecutionResult.fail({
            error: `Bloqueado por validación de seguridad previa: ${preCheck.reason}`,
            durationMs: Date.now() - startedAt
          });

          this.printResult({ task, result });
          return result;
        }
      }

      const toolOutput = await this.toolRegistry.executeTool(tool, args, {
        projectRoot: this.projectRoot,
        repl: this.repl,
        streamOutput: true
      });

      const filesModified = [];
      const filesRead = [];

      if (tool === 'write_file' && args.filePath) {
        filesModified.push(args.filePath);
      }

      if (tool === 'read_files' && Array.isArray(args.paths)) {
        filesRead.push(...args.paths);
      }

      if (filesModified.length > 0) {
        const postCheck = this.verifier.verifyModifiedFiles({
          projectRoot: this.projectRoot,
          filesModified
        });

        if (!postCheck.valid) {
          const result = ExecutionResult.fail({
            error: `La verificación de sintaxis post-escritura falló: ${postCheck.reason}`,
            durationMs: Date.now() - startedAt,
            filesModified
          });

          this.printResult({ task, result });
          return result;
        }
      }

      const result = ExecutionResult.ok({
        output: toolOutput,
        stdout: toolOutput?.stdout || '',
        stderr: toolOutput?.stderr || '',
        exitCode: toolOutput?.exitCode ?? null,
        signal: toolOutput?.signal ?? null,
        errorCode: toolOutput?.errorCode ?? null,
        durationMs: Date.now() - startedAt,
        filesModified,
        filesRead
      });

      this.printResult({ task, result });
      return result;
    } catch (err) {
      const denied = Boolean(
        err?.message && err.message.includes('[USER_DENIED]')
      );

      const result = denied
        ? ExecutionResult.fail({
            error: 'ACCIÓN CANCELADA: El usuario denegó la ejecución de la herramienta.',
            errorCode: 'USER_DENIED',
            durationMs: Date.now() - startedAt
          })
        : ExecutionResult.fail({
            error: err?.message || String(err),
            stdout: err?.stdout ? err.stdout.toString().trim() : '',
            stderr: err?.stderr ? err.stderr.toString().trim() : '',
            exitCode: err?.exitCode ?? err?.status ?? null,
            signal: err?.signal ?? null,
            errorCode: err?.errorCode ?? err?.code ?? null,
            durationMs: Date.now() - startedAt
          });

      this.printResult({ task, result });
      return result;
    }
  }

  printResult({
    task = null,
    result = null
  } = {}) {
    if (!result) return;

    if (result.success) {
      console.log(`  ✅ [EXECUTION SUCCESS] [${task?.id || ''}]`);
      console.log(`     📤 Output: ${JSON.stringify(result.output ?? null, null, 2)}`);
      return;
    }

    console.error(`\n  ❌ [EXECUTION FAILED] [${task?.id || ''}] ${task?.description || ''}`);
    console.error(`     🔧 Tool: ${task?.tool || 'N/A'}`);
    console.error(`     📥 Args: ${JSON.stringify(task?.args || {}, null, 2)}`);
    console.error(`     ❌ Error: ${result.error || 'Fallo no especificado'}`);

    if (result.exitCode !== null && result.exitCode !== undefined) {
      console.error(`     🔢 Exit code: ${result.exitCode}`);
    }

    if (result.errorCode) {
      console.error(`     🏷️ Error code: ${result.errorCode}`);
    }

    if (result.signal) {
      console.error(`     📡 Signal: ${result.signal}`);
    }

    if (result.stdout) {
      console.error(`     📄 STDOUT:\n${result.stdout}`);
    }

    if (result.stderr) {
      console.error(`     📄 STDERR:\n${result.stderr}`);
    }
  }
}

module.exports = ExecutionSubflow;
