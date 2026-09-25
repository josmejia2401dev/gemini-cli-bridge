# Gemini CLI Bridge – arquitectura de subflujos

Esta versión reorganiza el agente alrededor de subflujos reutilizables:

- **PlanningSubflow**: genera, valida y solicita aprobación de DAGs; acepta feedback y replanifica.
- **ExecutionSubflow**: ejecuta herramientas de forma segura y determinística.
- **RecoverySubflow**: registra fallos y consulta inmediatamente la memoria histórica para incorporar soluciones conocidas al contexto de recuperación.
- **InterpreterSubflow**: distingue respuestas normales de tool calls.
- **TaskExecutionCoordinator**: conecta Execution → Recovery → Planning → **Aprobación del nuevo plan** → Execution y reutiliza el mismo ciclo de recuperación en todos los escenarios.

## Instalación

```bash
npm install
```

Para el proveedor Playwright, `postinstall` instala Chromium automáticamente.

## Ejecución

```bash
npm start
```

También puede indicarse el repositorio directamente:

```bash
npm start -- "C:\\ruta\\al\\proyecto"
```

## Proveedores LLM

Por defecto se utiliza `PLAYWRIGHT`.

```text
LLM_PROVIDER=PLAYWRIGHT
```

Alternativas disponibles en el código:

```text
LLM_PROVIDER=GEMINI_API
GEMINI_API_KEY=...
```

```text
LLM_PROVIDER=QWEN_API
QWEN_API_KEY=...
```

## Memoria y recuperación

Ante cada fallo de ejecución, el sistema registra el error y consulta inmediatamente la memoria episódica. Si existe una solución conocida para la tarea o un problema similar, se incorpora como feedback al contexto que recibe la IA para generar el nuevo DAG de recuperación.

No existe un contador de intentos ni un límite artificial de interacciones en el flujo de recuperación o en la conversación. Cada fallo puede volver a entrar al ciclo `Execution → Recovery → Planning → **Aprobación del nuevo plan** → Execution` hasta completar la tarea o hasta que el proceso sea abortado.

Los datos de sesión, checkpoints y memoria se almacenan en `.agent_data/`.

## Flujos

### Plan explícito

`/plan objetivo → Planning → validación → aprobación/rechazo → Execution → resultado`

### Fallo

`Execution → error → Recovery → consulta BD → feedback conocido (si existe) → Planning → nuevo DAG → Execution`

### Conversación

`Chat → Interpreter → mensaje | instrucción → Execution → Recovery/Planning si falla`. Cada entrada de chat se procesa una sola vez; la siguiente interacción requiere un nuevo mensaje del usuario.

Las instrucciones producidas por la conversación y las tareas de los DAG utilizan el mismo `TaskExecutionCoordinator`.

## Convención de contratos de entrada

Las clases del dominio y las principales capas de infraestructura declaran sus entradas directamente en el constructor o método, usando valores por defecto que muestran la forma esperada de los objetos complejos.

Ejemplo:

```js
constructor({
  id = '',
  description = '',
  tool = null,
  args = {
    path: '',
    filePath: '',
    content: '',
    command: '',
    query: '',
    target: '',
    symbol: '',
    paths: [],
    createDirs: true
  },
  context = {
    source: '',
    workingDirectory: '',
    environment: {},
    variables: {},
    metadata: {}
  },
  dependencies = []
} = {}) {}
```

Las entradas complejas de métodos siguen la misma idea, por ejemplo `RecoveryContext`, `PlanningSubflow`, `TaskExecutionCoordinator`, `ToolRegistry` y `ModelRouter`.

La recuperación no utiliza contadores de intentos: ante cada fallo se consulta inmediatamente la memoria episódica y, cuando existe una solución conocida, se incorpora como feedback para la IA antes de generar el DAG de recuperación.

### Validaciones locales

```bash
npm run check
npm run smoke
```

`npm run smoke` no necesita dependencias externas y comprueba contratos, DAG, memoria de recuperación y el ciclo Execution → Recovery → Planning → **Aprobación del nuevo plan** → Execution.


## Sin indexación de repositorio ni análisis de impacto

Esta versión no incluye `ImpactAnalysis`, `RepositoryIndexer` ni `RepositoryIntelligence`. No construye ni mantiene un índice del repositorio ni ejecuta análisis automático de impacto.

`search_code` realiza una búsqueda directa y puntual sobre archivos, sin generar un índice ni una caché de relaciones. Las herramientas de importadores, dependencias y definición de símbolos basadas en el índice fueron retiradas.

## Aprobación de planes de recuperación

Cuando una ejecución falla, `RecoverySubflow` consulta inmediatamente la memoria disponible y construye un `RecoveryContext`. `PlanningSubflow` usa ese contexto para generar un nuevo DAG de recuperación y **siempre solicita aprobación del usuario antes de ejecutarlo**. Si el usuario rechaza el nuevo plan, se solicita el motivo y se vuelve a planificar con ese feedback.


## Alcance de recuperación

Cuando una tarea de un DAG falla, el plan de recuperación es un DAG temporal e independiente cuyo único objetivo es resolver la tarea fallida. Requiere aprobación del usuario. Al completarse, no sustituye ni modifica la estructura del DAG original: la tarea fallida se marca como completada en el DAG original y la ejecución continúa con la siguiente tarea pendiente según sus dependencias.

`isWebInitiated` es una responsabilidad exclusiva de `GeminiPlaywrightClient`; no forma parte de `AgentRuntime`, `ModelRouter` ni del contrato común de los clientes LLM.
