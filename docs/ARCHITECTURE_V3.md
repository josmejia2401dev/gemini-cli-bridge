# ARCHITECTURE_V2.md: Especificación de Arquitectura Gemini CLI Agent V2

## 1. Visión General y Diagrama de Flujo

Evolucionar el agente CLI actual de una arquitectura basada en expresiones regulares y bucles lineales hacia un **Agent Runtime desacoplado, modular y resiliente**.

El núcleo del sistema aísla la comunicación web con Playwright en una capa de transporte (*LLM Provider*), delegando la toma de decisiones, la memoria, la validación de comandos y la ejecución a un motor con capacidad de reflexión y autoevaluación.

```
                    ┌─────────────────────────┐
                    │      REPL / CLI         │
                    └────────────┬────────────┘
                                 │
                         ┌───────▼───────┐
                         │ AGENT RUNTIME │
                         └───────┬───────┘
                                 │
     ┌───────────────────────────┼───────────────────────────┐
     ▼                           ▼                           ▼
┌──────────────┐       ┌──────────────────┐        ┌──────────────────┐
│ MODEL ROUTER │       │  MEMORY ENGINE   │        │  TOOL REGISTRY   │
└──────┬───────┘       └────────┬─────────┘        └────────┬─────────┘
       │                        │                           │
       ▼                        ├── SQLite (Op/Epi/Proc)    ├── Local Tools (Disk/CLI)
┌────────────────┐              │                           ├── Legacy Regex Adapter
│ LLM PROVIDERS  │              └── LanceDB (Semantic)      └── Policy Engine
└──────┬─────────┘                                          └── Pre/Post Verifier
       │
       ▼
 ┌───────────────┐
 │ Playwright/Web│
 └───────────────┘

```

---

## 2. Estructura Completa de Carpetas y Archivos

```text
gemini-cli-agent/
├── src/
│   ├── agent/                    # Motor de Estado y Grafo de Decisiones
│   │   ├── state.ts              # Interfaz y tipo global AgentState
│   │   ├── planner.ts            # Generador de planes y desglose de objetivos
│   │   ├── executor.ts           # Orquestador de herramientas
│   │   ├── verifier.ts           # Validación Pre-Execution y Post-Execution
│   │   ├── reflector.ts          # Bucle de reflexión y reintento autónomo
│   │   └── router.ts             # Selección dinámica de modelo/proveedor
│   │
│   ├── llm/                      # Capa Abstraída de Proveedores LLM
│   │   ├── types.ts              # Contrato LLMProvider, LLMRequest, LLMResponse
│   │   ├── modelRouter.ts        # Enrutador inteligente de prompts
│   │   └── providers/
│   │       ├── geminiPlaywright.ts # Envoltorio del GeminiClient actual (Playwright)
│   │       ├── geminiApi.ts       # (Opcional) Proveedor API directa
│   │       └── ollamaLocal.ts     # (Opcional) Proveedor de modelo local
│   │
│   ├── tools/                    # Sistema de Herramientas y Políticas
│   │   ├── registry.ts           # Catálogo unificado de herramientas (Local + MCP)
│   │   ├── policyEngine.ts       # Evaluación de riesgo (LOW, MEDIUM, HIGH)
│   │   ├── legacy/
│   │   │   └── regexAdapter.ts   # Adaptador transitorio para etiquetas <<<CMD>>>
│   │   ├── local/
│   │   │   ├── terminal.ts       # Ejecución CLI aislada con cwd: projectRoot
│   │   │   ├── fileSystem.ts     # Escritura/Lectura completa con backups
│   │   │   └── codeSearch.ts     # Búsqueda por palabras clave/símbolos
│   │   └── mcp/
│   │       └── mcpClient.ts      # Cliente para protocolo MCP externo
│   │
│   ├── memory/                   # Almacenamiento Multinivel
│   │   ├── sqlite/
│   │   │   ├── db.ts             # Conexión y creación de esquemas SQLite
│   │   │   ├── operational.ts    # Estado activo de la tarea en curso
│   │   │   ├── episodic.ts       # Historial de ejecuciones y errores
│   │   │   └── procedural.ts    # Guías y flujos paso a paso aprendidos
│   │   └── vector/
│   │       └── semantic.ts       # LanceDB para recuperación por similitud
│   │
│   ├── context/                  # Indexación y Selección de Contexto
│   │   ├── patternEngine.ts      # Reglas glob, gitignore, exclusiones de binarios
│   │   ├── indexer.ts            # Indexador de símbolos AST y mapa del repo
│   │   └── retriever.ts          # Filtro de contexto relevante pre-prompt
│   │
│   ├── observability/            # Telemetría y Auditoría
│   │   ├── logger.ts             # Logs estandarizados con executionId
│   │   └── metrics.ts            # Trazabilidad de latencia, errores y reintentos
│   │
│   ├── schemas/                  # Esquemas Estrictos de Validación (Zod)
│   │   ├── toolSchemas.ts        # Estructura para argumentos de herramientas
│   │   └── agentSchemas.ts       # Estructura de salida JSON del LLM
│   │
│   ├── eval/                     # Dataset de Evaluación Continua
│   │   └── testCases/            # Casos de prueba estandarizados (JSON)
│   │
│   ├── cli/                      # Interfaz de Consola Interactiva
│   │   └── repl.ts               # REPL enriquecido (y/N [motivo], /paste, SIGINT)
│   │
│   └── index.ts                  # Punto de entrada inicializador
│
├── .session_memory.db            # Base de datos SQLite local (creada en runtime)
├── .lancedb/                     # Almacenamiento vectorial local (creado en runtime)
├── ARCHITECTURE_V2.md            # Especificación técnica oficial
└── package.json

```

---

## 3. Especificación de Módulos Core

### 3.1 LLM Layer & Model Router (`src/llm/`)

Desconecta a Playwright de la lógica del agente. Playwright actúa únicamente como un medio de transporte.

```typescript
// Contrato base para proveedores LLM
export interface LLMRequest {
  prompt: string;
  fileToUpload?: string | null;
  systemRules?: string;
}

export interface LLMResponse {
  text: string;
  toolCalls?: Array<{ name: string; args: Record<string, any> }>;
}

export interface LLMProvider {
  connect(initialUrl?: string): Promise<void>;
  generate(request: LLMRequest): Promise<LLMResponse>;
  stopGeneration(): Promise<void>;
  close(): Promise<void>;
}

```

### 3.2 Tool Registry & Policy Engine (`src/tools/`)

Garantiza que toda acción pase por un esquema Zod y una verificación de riesgo antes de su ejecución.

| Nivel de Riesgo | Acciones Incluidas | Modo de Confirmación |
| --- | --- | --- |
| **LOW** | `read_file`, `list_files`, `search_code`, `npm test` | Ejecución Autónoma Directa |
| **MEDIUM** | `write_file`, `move_file`, `npm install` | Aprobación con resumen previo |
| **HIGH** | `delete_file`, `git reset --hard`, comandos destructivos | Aprobación Estricta `(y/N [motivo])` |

```typescript
// Estructura de una Tool Nativa
export interface ToolDefinition<T = any> {
  name: string;
  description: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  schema: z.ZodSchema<T>;
  execute: (args: T, context: ToolContext) => Promise<ToolResult>;
}

```

### 3.3 Verificador Pre/Post Ejecución (`src/agent/verifier.ts`)

* **Pre-Execution Check:** Verifica que el ejecutable existe en el sistema operativo, confirma que la sintaxis de la orden no esté invertida (ej. valida `gradlew.bat clean build` contra `build clean gradlew.bat`) y valida que la ruta no rompa la cárcel del `projectRoot`.
* **Post-Execution Check:** Analiza el código de salida ($?$), detecta errores en `stderr` o `stdout`, e instruye al `Reflector` sobre si se logró el objetivo.

### 3.4 Sistema de Memoria en 4 Niveles (`src/memory/`)

1. **Memoria Operacional (SQLite):** Controla el estado actual de la tarea activa (`taskId`, paso actual, archivos modificados).
2. **Memoria Episódica (SQLite):** Guarda el historial completo de errores de terminal y cómo se solucionaron.
3. **Memoria Procedural (SQLite):** Guarda recetas o flujos de trabajo eficientes para tareas comunes (ej. actualización de dependencias).
4. **Memoria Semántica (LanceDB):** Permite buscar por similitud conceptual cuando aparece un error desconocido o complejo.

---

## 4. Roadmap de Implementación (5 Fases)

```
[FASE 1] LLMProvider + Zod + LegacyAdapter
   │
[FASE 2] AgentRuntime + Pre/Post Verifier + Policy Engine
   │
[FASE 3] Memoria SQLite (Operacional, Episódica, Procedural)
   │
[FASE 4] Context Engine + LanceDB (Memoria Semántica) + MCP
   │
[FASE 5] Observability + Evaluation Dataset

```

* **Fase 1 (Fundamentos y Dual-Parsing):** Abstraer `GeminiClient` bajo la interfaz `LLMProvider`. Implementar `ToolRegistry`, esquemas `Zod` iniciales y mantener compatibilidad con el `regexAdapter` actual.
* **Fase 2 (Runtime y Seguridad):** Construir `AgentRuntime`, `verifier.ts` y `policyEngine.ts`. Implementar la captura de observaciones en rechazos `n [motivo]`.
* **Fase 3 (Memoria Estructurada):** Crear la base de datos SQLite para persistir el estado activo, el historial episódico de ejecuciones y las lecciones aprendidas.
* **Fase 4 (Contexto Inteligente y MCP):** Crear el indexador AST/Símbolos, integrar LanceDB para búsquedas vectoriales complejas y habilitar conectores MCP.
* **Fase 5 (Observabilidad y Métricas):** Implementar trazabilidad por `executionId` y crear la suite de evaluación con casos de prueba JSON.

---