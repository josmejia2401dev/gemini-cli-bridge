# Patch: salida en vivo y errores completos

Archivos reemplazados:

- `src/domain/agent/contracts/executionResult.js`
- `src/domain/agent/subflows/executionSubflow.js`
- `src/infrastructure/tools/registry.js`

## Comportamiento

`execute_command` usa `child_process.spawn()` con `shell: true` para transmitir `stdout` y `stderr` mientras el comando sigue ejecutándose.

La salida se conserva completa y también se entrega en `ExecutionResult` para Recovery.

Cuando un comando falla se muestran:

- tarea
- herramienta
- argumentos
- error
- exit code
- error code
- signal
- stdout completo
- stderr completo

No se utiliza `ExecutionLogger`.
