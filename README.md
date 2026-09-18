# 🚀 GeminiDev Agent V3 (`gemini-cli-bridge`)

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright-v1.40%2B-blue.svg)](https://playwright.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-Better--SQLite3-003B57.svg)](https://www.sqlite.org/)
[![Architecture](https://img.shields.io/badge/Architecture-V3--Clean--Layered-orange.svg)](#-arquitectura-del-sistema-v3)

**GeminiDev Agent V3** es una plataforma CLI autónoma de Ingeniería de Software en Node.js que conecta la interfaz web de Gemini con el sistema de archivos local de tu repositorio.

Concebido bajo una **Arquitectura Limpia en Capas (Clean & Layered Architecture)** y guiado por principios estrictos de diseño (**SOLID, KISS, DRY, YAGNI**), el agente opera bajo el paradigma **Zero-Git**, desacoplamiento de enrutamiento determinístico, descomposición autónoma de tareas mediante **TaskDAG**, verificación por evidencias y telemetría continua de aprendizaje.

---

## 🌟 Capacidades Clave V3

* ⚡ **Enrutamiento Determinístico vs. Razonamiento (Capacidad 3):** Autoclasifica peticiones. Consultas de repositorio (`git status`, `quién importa X`, `busca Y`) o scripts de consola se ejecutan **localmente en <50ms con 0 tokens de la IA**.
* 📋 **Descomposición Autónoma de Tareas (TaskDAG - Capacidad 2):** Transforma requerimientos complejos en un Grafo Acíclico Dirigido (DAG) de subtareas lógicas, ejecutándolas en secuencia con actualización dinámica de estado.
* 🛡️ **Filesystem Seguro Zero-Git (`AtomicWriter` - Capacidad 6):** Aplica modificaciones de código sobre archivos temporales (`.tmp`), valida la sintaxis determinísticamente (`node --check`, `JSON.parse`) y realiza un *swap* atómico. Si la sintaxis falla, el archivo original en disco permanece 100% intacto.
* 🔎 **Verificación por Evidencias Determinísticas (`EvidenceEngine` - Capacidad 7):** Bloquea falsos positivos auditablemente (`file_exists`, `command_pass`, `http_check`) antes de otorgar el estado `SUCCESS`.
* 🛑 **Control de Bucles y Replanificación Autónoma (`LoopDetector` & `Replanner` - Capacidad 9):** Monitorea patrones $A-A-A$, $A-B-A-B$ y estados `NO_PROGRESS` (3 intentos modificando código sin pasar tests). Ante un estancamiento, pausa los reintentos automáticos y fuerza a Gemini a descartar la ruta fallida y generar un nuevo plan.
* 🧠 **Memoria Histórica y Checkpoints (Capacidad 1 & 8):** Persistencia en SQLite (`agent_runs`, `agent_checkpoints`, `episodic_memory`). Si la consola se interrumpe, el agente recupera el estado exacto del paso anterior. Ante errores de consola conocidos, aplica soluciones históricas sin consumir tokens.
* 📊 **Observabilidad, Métricas y Dataset (`Tracer` & `MetricsCollector` - Capacidad 13):** Registra latencias exactas por componente (spans) y exporta trazas limpias de ejecuciones exitosas a `.agent_data/dataset.jsonl` para aprendizaje continuo.

---

## 🏗️ Arquitectura del Sistema V3

El proyecto está estructurado en 5 capas desacopladas, aislando la lógica de negocio de los detalles de infraestructura (Playwright, SQLite, I/O):

```text
                            ┌─────────────────────────┐
                            │      src/app/           │ (Application Lifecycle)
                            └────────────┬────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
      ┌─────────────────────┐                         ┌─────────────────────┐
      │   src/interfaces/   │                         │     src/domain/     │
      │  (CLI REPL & Cmds)  │                         │ (DAG, AgentRuntime) │
      └──────────┬──────────┘                         └──────────┬──────────┘
                 │                                               │
                 └───────────────────────┬───────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
      ┌─────────────────────┐                         ┌─────────────────────┐
      │ src/infrastructure/ │                         │    src/shared/      │
      │ (Playwright, SQLite)│                         │ (Config, Utils, Obs)│
      └─────────────────────┘                         └─────────────────────┘

```

### 📂 Estructura Completa de Carpetas

```text
gemini-cli-bridge/
├── index.js                      # Bootstrap minimalista de la aplicación (10 líneas)
├── commands.json                 # Catálogo de perfiles expertos (/dev, /refactor, etc.)
├── package.json                  # Dependencias y binario ejecutable
├── docs/                         # Especificaciones técnicas de arquitectura y capacidades
│   ├── ARCHITECTURE_V3.md
│   └── CAPACIDADES.md
├── .agent_data/                  # Datos locales aislados (SQLite, Sesiones, Logs, Datasets)
└── src/
    ├── app/                      # Application Orquestador (Lifecyle, Menú de Chat, SIGINT)
    ├── domain/                   # Núcleo del Agente Autónomo
    │   ├── agent/                # Runtime, AgentState, TaskDAG, LoopDetector, Replanner
    │   └── context/              # RepositoryIntelligence, ImpactAnalysis, Indexer
    ├── infrastructure/           # Adaptadores de Entrada/Salida
    │   ├── llm/                  # Playwright Client, ModelRouter, Provider
    │   ├── persistence/          # MemoryDatabase (SQLite), Checkpoints, EpisodicMemory
    │   └── tools/                # ToolRegistry, AtomicWriter, PolicyEngine
    ├── interfaces/               # Capa de Interacción
    │   ├── cli/                  # REPL interactivo con soporte multilínea (/paste)
    │   └── core/                 # CommandDispatcher y gestor de perfiles
    └── shared/                   # Recursos Compartidos
        ├── assets/               # Banner ASCII (banner.txt)
        ├── config/               # Fuente única de verdad de Rutas (paths.js) y Prompts (prompts.js)
        ├── observability/        # ExecutionLogger, Tracer, MetricsCollector
        ├── schemas/              # Esquemas de validación Zod
        ├── utils/                # OutputParser (JS VM), FileScanner
        └── eval/                 # Suite de benchmarking sintético

```

---

## ⚡ JS Object Mode & Escritura Atómica

A diferencia de los parsers basados en JSON plano o regex volátiles, GeminiDev V3 utiliza **JS Object Mode** evaluado mediante un contexto aislado `vm.runInNewContext()`. La IA responde con objetos nativos delimitados por *Template Literals* (backticks ```):

```javascript
{
  tool: "write_file",
  arguments: {
    filePath: `src/services/UserService.js`,
    content: `const fs = require('fs');

class UserService {
  async getUsers() {
    return [{ id: 1, name: 'Alice' }];
  }
}

module.exports = UserService;`
  }
}

```

### 🛡️ Flujo de Seguridad `AtomicWriter`

1. **Path Traversal Check:** Garantiza que la ruta permanezca dentro de `ROOT_DIR`.
2. **Escritura Temporal:** Escribe el contenido en `filePath.tmp`.
3. **Validación Sintáctica:** Ejecuta `node --check` (para JS/TS) o `JSON.parse` (para JSON) sobre el `.tmp`.
4. **Swap Atómico:** Si compila/valida, ejecuta `fs.renameSync` reemplazando el archivo original. Si falla, destruye el `.tmp` dejando el código en disco intacto.

---

## 💾 Persistencia y Base de Datos (SQLite)

Todos los estados del agente se persisten en `.agent_data/memory.db` (SQLite):

| Tabla | Responsabilidad |
| --- | --- |
| `agent_runs` | Estado global del ciclo de vida (`IDLE`, `PLANNING`, `EXECUTING`, `SUCCESS`, `CANCELLED`). |
| `agent_checkpoints` | Snapshots serializados del objeto `AgentState` por cada paso de subtarea. |
| `episodic_memory` | Experiencias históricas de errores de terminal, bloqueos de sintaxis y soluciones aplicadas. |
| `operational_memory` | Control activo de la tarea en ejecución y archivos modificados. |

---

## 🛠️ Catálogo de Comandos CLI

### 💬 Comandos de Sesión de Chat

| Comando | Descripción |
| --- | --- |
| `/chat-new` | Inicia una conversación limpia en Gemini Web reinyectando reglas. |
| `/chat-save <nombre>` | Guarda el hilo activo en `saved_chats.json`. |
| `/chat-list` | Muestra la lista de chats guardados. |
| `/chat-load <nombre>` | Carga inmediatamente la sesión del chat guardado. |
| `/chat-delete <nombre>` | Elimina un chat de la lista. |

### ⚙️ Comandos de Sistema y Contexto

| Comando | Descripción |
| --- | --- |
| `/paste` | Activa el modo multilínea. Finaliza enviando `.send` en una nueva línea. |
| `/reload-rules` | Reinyecta las directrices del **JS Object Mode** en el chat activo. |
| `/upload-files [texto]` | Empaqueta el repositorio y lo sube como archivo de contexto `.txt`. |
| `/sync-all [texto]` | Fuerza la sincronización total del código y evalúa la instrucción. |
| `/sync <rutas...>` | Sincroniza únicamente los archivos especificados (ej. `/sync src/app.js`). |
| `/history` | Extrae el historial del chat actual a `HISTORIAL_CHAT.md`. |
| `/new-repo <ruta>` | Cambia el repositorio objetivo de trabajo en caliente. |
| `/help` | Muestra la guía interactiva de comandos en la terminal. |
| `/exit` | Cierra Chromium y finaliza la aplicación de forma segura. |

### 🎭 Perfiles de Agente Experto (`commands.json`)

Antepone el comando para activar perfiles especializados con prompts de arquitectura:

* `/dev` - Desarrollador Full-Stack Senior (SOLID, KISS, DRY).
* `/dev-java` - Arquitecto Java 21+ & Spring Boot 3+.
* `/dev-java-webflux` - Especialista en Spring WebFlux 100% Reactivo.
* `/dev-java-webflux-hexagonal` - Java Reactivo en Arquitectura Hexagonal y DDD.
* `/dev-node` - Experto en Node.js, Express y Clean Architecture.
* `/dev-react` / `/dev-angular` - Tech Leads Frontend (Signals, Standalone, Custom Hooks).
* `/devops` - SRE/DevOps especialista en Docker multi-stage, K8s y CI/CD.
* `/refactor` - Refactorización purista de código sin cambio de comportamiento.
* `/review` - Auditoría estática de seguridad (OWASP) de **solo lectura**.
* `/debug` - Troubleshooting, lecturas de stacktraces y Análisis de Causa Raíz (RCA).
* `/test-java` / `/test-node` - SDET especializados en JUnit 5, Mockito y Jest.

---

## 📦 Instalación y Uso

### 1. Instalación de Dependencias y Enlace Global

```bash
git clone [https://github.com/tu-usuario/gemini-cli-bridge.git](https://github.com/tu-usuario/gemini-cli-bridge.git)
cd gemini-cli-bridge
npm install
npm link

```

### 2. Ejecutar el Agente sobre un Repositorio

```bash
gemini-cli-bridge /ruta/a/tu/proyecto

```

### 3. Ejecutar Suite de Evaluaciones Sintácticas (Benchmark)

```bash
node src/shared/eval/evaluator.js

```

---

## 🛡️ Protocolos de Seguridad y Guardrails

1. **Path Traversal Shield (`isSafePath`):** Bloquea lecturas o escrituras fuera de `ROOT_DIR`.
2. **Standard Execution Environment (`execSync`):** Aísla los comandos de terminal dentro de la raíz del proyecto vinculado.
3. **Control de Interrupción Sigint (`Ctrl + C`):** Interrumpe de forma limpia las llamadas de Playwright (`stopGeneration()`) sin destruir el proceso principal del CLI.
4. **Presupuesto y Guardrails:** Control determinístico de límites de iteración, deteniendo el bucle si se supera el presupuesto asignado sin completar evidencias.