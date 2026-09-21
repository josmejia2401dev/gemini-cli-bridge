# 🚀 GeminiDev Agent V3 (`gemini-cli-bridge`)

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright-v1.40%2B-blue.svg)](https://playwright.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-Better--SQLite3-003B57.svg)](https://www.sqlite.org/)
[![Architecture](https://img.shields.io/badge/Architecture-V3--Clean--Layered-orange.svg)](#-arquitectura-del-sistema-v3)

**GeminiDev Agent V3** es una plataforma CLI autónoma de Ingeniería de Software en Node.js que conecta la interfaz web de Gemini o proveedores de API en la nube con el sistema de archivos local de tu repositorio.

Concebido bajo una **Arquitectura Limpia en Capas (Clean & Layered Architecture)** y guiado por principios estrictos de diseño (**SOLID, KISS, DRY, YAGNI**), el agente opera bajo el paradigma **Zero-Git**, desacoplamiento de enrutamiento determinístico, descomposición autónoma de tareas mediante **TaskDAG**, control de riesgos interactivo (*Human-in-the-Loop*) y persistencia por checkpoints.

---

## 🌟 Capacidades Clave V3

* 🔌 **Contrato de Abstracción LLM Multi-Proveedor (`ILLMClient` & `LLMFactory`):** Inversión de dependencias (DIP) pura. Permite intercambiar de forma transparente el motor de IA subyacente (Playwright Chromium, API oficial de Gemini o Qwen/Alibaba Cloud) mediante configuración (`LLM_PROVIDER`), sin modificar el runtime.
* ⚡ **Enrutamiento Determinístico vs. Razonamiento:** Autoclasifica peticiones. Consultas de repositorio (`git status`, `quién importa X`, `busca Y`) o scripts de consola se ejecutan **localmente en <50ms con 0 tokens de IA**.
* 📋 **Descomposición Autónoma de Tareas (TaskDAG):** Transforma requerimientos complejos en un Grafo Acíclico Dirigido (DAG) de subtareas lógicas, ejecutándolas en secuencia con actualización dinámica de estado.
* 🛡️ **Filesystem Seguro Zero-Git (`AtomicWriter`):** Aplica modificaciones de código sobre archivos temporales (`.tmp`), valida la sintaxis determinísticamente (`node --check`, `JSON.parse`) y realiza un *swap* atómico. Si la sintaxis falla, el archivo original en disco permanece 100% intacto.
* ☕ **Indexación Multilenguaje Desacoplada (`RepositoryIndexer`):** Procesa de forma aislada ecosistemas JavaScript/TypeScript y Java (Spring Boot/J2EE), extrayendo símbolos, importaciones, paquetes y exportaciones sin falsos positivos.
* 🛑 **Control de Riesgos e Intervención Humana (`PolicyEngine`):** Evalúa el nivel de riesgo de cada herramienta (`LOW`, `MEDIUM`, `HIGH`). Detiene la ejecución e invoca el modo *Human-in-the-Loop* pidiendo autorización interactiva antes de correr comandos destructivos.
* 🔄 **Replanificación Autónoma por Fallos (`Replanner`):** Componente puro de replanificación. Si una subtarea falla o el DAG se atasca, descarta la ruta fallida y genera una nueva estrategia sin detener el proceso.
* 🧠 **Memoria Histórica y Checkpoints:** Persistencia en SQLite con claves foráneas activas (`agent_runs`, `agent_checkpoints`, `episodic_memory`). Si la consola se interrumpe, el agente reanuda desde el último checkpoint estable.
* 📝 **REPL Multilínea Robusto:** Captura masiva de código o logs (`/paste` / `.send`) procesada mediante un bucle asíncrono puro que previene el congelamiento de la consola.

---

## 🏗️ Arquitectura del Sistema V3

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
      │ (LLM, SQLite, Tools)│                         │ (Config, Utils, Obs)│
      └─────────────────────┘                         └─────────────────────┘

```

### 📂 Estructura Completa de Carpetas

```text
gemini-cli-bridge/
├── index.js                      # Bootstrap minimalista de la aplicación
├── commands.json                 # Catálogo de perfiles expertos (/dev, /refactor, etc.)
├── package.json                  # Dependencias y binario ejecutable
├── docs/                         # Especificaciones técnicas de arquitectura y capacidades
│   ├── ARCHITECTURE_V3.md
│   └── CAPACIDADES.md
├── .agent_data/                  # Datos locales aislados (SQLite, Sesiones, Logs)
└── src/
    ├── app/                      # Orquestador del ciclo de vida y menús de la CLI
    ├── domain/                   # Núcleo del Agente Autónomo
    │   ├── agent/                # Runtime, AgentState, TaskDAG, Replanner, Reflector, Verifier
    │   └── context/              # RepositoryIntelligence, ImpactAnalysis, Indexer, PatternEngine
    ├── infrastructure/           # Adaptadores de Entrada/Salida
    │   ├── llm/                  # Capa de Interacción con Modelos de Lenguaje
    │   │   ├── contracts/        # ILLMClient (Contrato base abstracto)
    │   │   ├── providers/        # GeminiPlaywrightClient, GeminiApiClient, QwenApiClient
    │   │   ├── llmFactory.js     # Fábrica de instanciación según configuración
    │   │   └── modelRouter.js    # Enrutador centralizado de llamadas
    │   ├── persistence/          # MemoryDatabase (SQLite), Checkpoints, EpisodicMemory
    │   └── tools/                # ToolRegistry, AtomicWriter, PolicyEngine
    ├── interfaces/               # Capa de Interacción
    │   ├── cli/                  # REPL interactivo con soporte multilínea (/paste)
    │   └── core/                 # CommandDispatcher y gestor de perfiles
    └── shared/                   # Recursos Compartidos
        ├── assets/               # Banner ASCII (banner.txt)
        ├── config/               # Fuente única de verdad de Rutas (paths.js) y Prompts (prompts.js)
        ├── observability/        # ExecutionLogger
        ├── schemas/              # Esquemas de validación Zod
        └── utils/                # OutputParser (JS VM), FileScanner

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

La persistencia del agente se concentra en `.agent_data/memory.db` con restricciones `foreign_keys = ON`:

| Tabla | Responsabilidad |
| --- | --- |
| `agent_runs` | Estado global de la tarea (`IDLE`, `PLANNING`, `EXECUTING`, `REPLAN`, `SUCCESS`, `CANCELLED`). |
| `agent_checkpoints` | Snapshots serializados del `AgentState` y `TaskDAG` por cada paso de subtarea. |
| `episodic_memory` | Experiencias históricas de errores de terminal, comandos fallidos y soluciones aplicadas. |

---

## 🛠️ Catálogo de Comandos CLI

### 💬 Comandos de Sesión de Chat

| Comando | Descripción |
| --- | --- |
| `/chat-new` | Inicia una conversación limpia reinyectando reglas globales. |
| `/chat-save <nombre>` | Guarda el hilo activo en `saved_chats.json` (Proveedor Playwright). |
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
| `/exit` | Cierra las conexiones y finaliza la aplicación de forma segura. |

---

## 📦 Instalación y Configuración

### 1. Instalación de Dependencias y Enlace Global

```bash
git clone https://github.com/tu-usuario/gemini-cli-bridge.git
cd gemini-cli-bridge
npm install
npm link

```

### 2. Variables de Entorno (Opcional para APIs)

Por defecto, la CLI utiliza Playwright en modo Web Chromium. Para utilizar proveedores de API directa, configura las variables de entorno en tu terminal o archivo `.env`:

```bash
# Para la API oficial de Gemini
export LLM_PROVIDER=GEMINI_API
export GEMINI_API_KEY=tu_api_key_aqui

# Para la API de Qwen (Alibaba Cloud)
export LLM_PROVIDER=QWEN_API
export QWEN_API_KEY=tu_api_key_aqui

```

### 3. Ejecutar el Agente sobre un Repositorio

```bash
gemini-cli-bridge /ruta/a/tu/proyecto

```

---

## 🛡️ Protocolos de Seguridad y Guardrails

1. **Path Traversal Shield (`isSafePath`):** Bloquea lecturas o escrituras fuera del directorio del proyecto vinculado.
2. **Human-in-the-Loop (`PolicyEngine`):** Solicita autorización explícita antes de ejecutar comandos o herramientas clasificadas como `HIGH` o `CRITICAL`.
3. **Control de Interrupción (`Ctrl + C`):** Interrumpe la generación activa del modelo sin cerrar bruscamente la sesión ni la terminal REPL.
