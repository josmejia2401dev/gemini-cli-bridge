# 🚀 GeminiDev Agent V2 (`gemini-cli-bridge`)

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright-v1.40%2B-blue.svg)](https://playwright.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-Better--SQLite3-003B57.svg)](https://www.sqlite.org/)
[![Architecture](https://img.shields.io/badge/Architecture-V2--JS--Object--Mode-orange.svg)](#-motor-de-ejecución-js-object-mode-v2)

**GeminiDev Agent V2** es una plataforma CLI de automatización autónoma en Node.js que puentea la interfaz web de Gemini con el sistema de archivos de tu repositorio local. 

Concebido bajo una **Arquitectura V2 desacoplada y resiliente**, el agente ejecuta un bucle continuo de toma de decisiones (`PLAN -> EXECUTE -> VERIFY -> REFLECT`), operando bajo el novedoso paradigma **JS Object Mode**, sanitización aislada por **`OutputParser`**, memoria episódica multinivel (**SQLite + LanceDB**) y control estricto de seguridad en tiempo de ejecución.

---

## 🌟 Características Clave

* ⚡ **JS Object Mode (Zero Syntax Errors):** Evaluación segura con `vm.runInNewContext()`. La IA emite objetos JavaScript delimitados por *Template Literals* (backticks `` ` ``), permitiendo la escritura nativa de código multilínea, saltos de línea y comillas internas sin necesidad de escapes propensos a errores.
* 🛡️ **Escudo Purificador (`OutputParser.js`):** Extractor dedicado que aísla la estructura del objeto `{ tool: "...", arguments: { ... } }` y aniquila mediante Regex cualquier inyección de triples comillas de Markdown (```) o bloques no deseados.
* 🧠 **Memoria Episódica Activa:** Almacena automáticamente en SQLite los fallos de consola, comandos denegados y feedback humano (`n [motivo]`). Previene la repetición de errores inyectando contexto preventivo en tareas similares.
* 🔍 **Verifier Sintáctico Pre-Exec:** Analiza las ordenes propuestas antes de tocar la consola. Detiene comandos invertidos (ej. `clean build gradlew.bat`) y bloquea violaciones de *Path Traversal*.
* 🚦 **Policy Engine & Risk Control:** Evaluación de riesgo en 3 niveles (`LOW`, `MEDIUM`, `HIGH`) con intervención humana explícita `(y/N [motivo])` para operaciones críticas.
* 🎭 **Catálogo de Agentes Experto (`commands.json`):** Mas de 10 perfiles especializados (`/dev-java`, `/dev-react`, `/devops`, `/refactor`, `/debug`) listos para asumir roles de arquitectura.

---

## 🏗️ Arquitectura del Sistema V2

```text
                    ┌─────────────────────────┐
                    │      REPL / CLI         │
                    └────────────┬────────────┘
                                 │
                         ┌───────▼───────┐
                         │   MAIN ()     │ (bootstrap & error handler)
                         └───────┬───────┘
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
       ▼                        ├── SQLite (Op/Epi/Proc)    ├── OutputParser (JS VM)
┌────────────────┐              │                           ├── PolicyEngine (Risks)
│ LLM PROVIDERS  │              └── LanceDB (Semantic)      └── Pre/Post Verifier
└──────┬─────────┘                                          
       │
       ▼
 ┌───────────────┐
 │ Playwright/Web│
 └───────────────┘

```

### 📂 Estructura de Archivos V2

```text
gemini-cli-bridge/
├── index.js                  # Entry point con arranque limpio async main() y error handling.
├── commands.json             # Catálogo de perfiles expertos (Prompts de Agente).
├── package.json              # Dependencias del proyecto y binario ejecutable global.
├── ARCHITECTURE_V2.md        # Especificación detallada del diseño de arquitectura.
├── .agent_data/              # Directorio aislado de estado (SQLite, LanceDB, Sesiones, Logs).
├── src/
│   ├── agent/                # AgentRuntime (Loop autónomo), Verifier y Reflector.
│   ├── config/               # Rutas unificadas del sistema (paths.js).
│   ├── context/              # Indexador AST, PatternEngine y Context Retriever.
│   ├── eval/                 # Evaluador sintáctico y conjunto de test cases en JSON.
│   ├── llm/                  # ModelRouter, GeminiClient y adaptador GeminiPlaywrightProvider.
│   ├── memory/               # SQLite (Operacional, Episódica, Procedural) y LanceDB.
│   ├── observability/        # ExecutionLogger (uuid auditables) y MetricsCollector.
│   ├── schemas/              # Esquemas Zod para la validación estricta de tools.
│   ├── tools/                # ToolRegistry, PolicyEngine y conector MCP Client.
│   └── utils/                # OutputParser.js (Parser de objetos JS) y FileScanner.js.
├── cli/
│   └── repl.js               # REPL interactivo con captura multilínea (/paste) y SIGINT.
└── core/
    └── commandDispatcher.js  # Gestor de perfiles, sesiones de chat e inyector de reglas.

```

---

## ⚡ Motor de Ejecución JS Object Mode V2

A diferencia de los parsers rígidos basados en JSON plano o regex volátiles, el **Agent Runtime V2** exige a Gemini respuestas en formato de objetos nativos de JavaScript evaluados mediante `vm.runInNewContext()`:

```javascript
{
  tool: "write_file",
  arguments: {
    filePath: `src/main/java/com/example/cache/CacheService.java`,
    content: `package com.example.cache;

import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

@Service
public class CacheService {
    @Cacheable(value = "portfolio", key = "#id")
    public String getPortfolioData(String id) {
        return "Data for portfolio with id: " + id;
    }
}`
  }
}

```

### 🛡️ El Módulo `OutputParser.js`

El parseo se delega completamente a `src/utils/outputParser.js`, el cual:

1. Aisla la cadena desde el primer `{` hasta el último `}`.
2. Aplica el regex `/```[a-zA-Z0-9_-]*/g` para destruir cualquier bloque Markdown residual.
3. Transforma la cadena en un objeto JavaScript vivo sin romper los saltos de línea de los *Template Literals* (```).

---

## 🧠 Sistema de Memoria Persistente (SQLite & LanceDB)

La persistencia del agente se almacena dentro de `.agent_data/memory.db` (SQLite) y `.agent_data/lancedb/` (Vectorial):

| Tipo de Memoria | Componente | Responsabilidad |
| --- | --- | --- |
| **Operacional** | `OperationalMemory` | Rastrea el estado de la tarea actual (`taskId`, `goal`, pasos, archivos modificados). |
| **Episódica** | `EpisodicMemory` | Registra errores de terminal, bloqueos del `Verifier` y observaciones `n [motivo]`. |
| **Procedural** | `ProceduralMemory` | Guarda flujos de trabajo eficientes aprendidos para tareas repetitivas. |
| **Semántica** | `SemanticMemory` | LanceDB embebido para búsqueda vectorial por similitud conceptual de errores. |

### 🔍 Inspección en Tiempo Real de la Memoria Episódica

Puedes ejecutar este script directamente en la raíz para auditar qué ha aprendido tu agente:

```bash
node -e "
  const Database = require('better-sqlite3');
  const db = new Database('./.agent_data/memory.db');
  console.log('\n--- 🧠 MEMORIA EPISÓDICA (Lecciones Aprendidas) ---');
  console.table(db.prepare('SELECT id, command, error_output, user_feedback FROM episodic_memory ORDER BY id DESC LIMIT 5').all());
"

```

---

## 🛠️ Catálogo de Comandos CLI

### 💬 Comandos de Chat (Sesiones)

| Comando | Descripción |
| --- | --- |
| `/chat-new` | Inicia una conversación limpia en Gemini Web. |
| `/chat-save <nombre>` | Guarda el hilo activo en `saved_chats.json` (ej. `/chat-save sprint-4`). |
| `/chat-list` | Muestra todos los chats guardados. |
| `/chat-load <nombre>` | Cambia el navegador inmediatamente al chat seleccionado. |
| `/chat-delete <nombre>` | Elimina un chat de la lista guardada. |

### ⚙️ Comandos de Sistema y Contexto

| Comando | Descripción |
| --- | --- |
| `/paste` | Activa el modo multilínea. Finaliza enviando `.send` en una nueva línea. |
| `/reload-rules` | Reinyecta las directrices del **JS Object Mode** en el chat activo. |
| `/upload-files [texto]` | Empaqueta el repositorio y lo sube como archivo de contexto `.txt`. |
| `/sync-all [texto]` | Fuerza la sincronización total de código y evalúa la instrucción. |
| `/sync <rutas...>` | Sincroniza únicamente los archivos especificados (ej. `/sync src/app.js`). |
| `/history` | Extrae el historial del chat actual y genera `HISTORIAL_CHAT.md`. |
| `/new-repo <ruta>` | Cambia el repositorio objetivo de trabajo en caliente. |
| `/help` | Muestra la guía interactiva de comandos en la terminal. |
| `/exit` | Cierra Chromium y finaliza el proceso de Node.js de forma segura. |

### 🎭 Perfiles de Agente Experto (`commands.json`)

Para activar un perfil experto, antepone el comando a tu instrucción:

* `/dev` - Desarrollador Full-Stack Senior (SOLID, KISS, DRY).
* `/dev-java` - Arquitecto Java 21+ & Spring Boot 3+.
* `/dev-java-webflux` - Especialista en Spring WebFlux 100% Reactivo y no bloqueante.
* `/dev-java-webflux-hexagonal` - Java Reactivo en Arquitectura Hexagonal y DDD.
* `/dev-node` - Experto en Node.js, Express y Clean Architecture.
* `/dev-react` / `/dev-angular` - Tech Leads Frontend (Signals, Standalone, Custom Hooks).
* `/devops` - SRE/DevOps especialista en Docker multi-stage, K8s y CI/CD.
* `/refactor` - Refactorización purista de código sin cambio de comportamiento.
* `/review` - Auditoría estática de seguridad (OWASP) de **solo lectura**.
* `/debug` - Troubleshooting, lecturas de stacktraces y RCA (Root Cause Analysis).
* `/test-java` / `/test-node` - Ingenieros SDET especializados en JUnit 5, Mockito y Jest.

---

## 💡 Ejemplos de Uso en la CLI

### 1. Refactorización Segura con Perfil Experto

```text
GeminiDev V2 > /refactor optimiza la clase CacheService eliminando redundancias sin alterar el comportamiento.

```

### 2. Pegar Stacktraces Largos (`/paste`)

```text
GeminiDev V2 > /paste
  [MODO MULTILÍNEA ACTIVADO]
  > Pega todo tu texto, código o logs.
  > Cuando termines, escribe ".send" en una nueva línea y presiona Enter.

  /dev-java-webflux Corrige este error en el pipeline reactivo:
  java.lang.IllegalStateException: block()/blockFirst()/blockLast() are blocking
  at reactor.core.publisher.Mono.block(Mono.java:1738)
  at com.example.service.UserService.getUser(UserService.java:45)
  .send

```

### 3. Reinyectar Reglas en Chats Retomados

```text
GeminiDev V2 > /reload-rules
  [/reload-rules] Inyectando reglas actualizadas en el chat activo...
  ✅ Reglas actualizadas en memoria.

```

---

## 📦 Instalación y Configuración

### 1. Clonar e Instalar Dependencias

```bash
git clone [https://github.com/tu-usuario/gemini-cli-bridge.git](https://github.com/tu-usuario/gemini-cli-bridge.git)
cd gemini-cli-bridge
npm install

```

### 2. Vincular Binario Globalmente

```bash
npm link

```

*(En sistemas Linux/macOS puede requerir `sudo npm link`)*.

### 3. Iniciar el Agente

Apunta el agente a cualquier repositorio local de tu máquina:

```bash
gemini-cli-bridge /ruta/a/tu/proyecto

```

---

## 🛡️ Protocolos de Seguridad (Architect Level)

1. **Path Traversal Shield (`isSafePath`):** Bloquea cualquier intento del LLM de leer o escribir fuera de la raíz del proyecto (`projectRoot`).
2. **Standard Execution Environment (`execSync`):** Todos los comandos ejecutados por la herramienta `execute_command` se aíslan en el `cwd` del repositorio del usuario.
3. **Control de Interrupción Sigint (`Ctrl + C`):** Interrumpe de forma limpia la generación de respuesta del navegador mediante Playwright (`stopGeneration()`) sin cerrar el proceso principal del CLI.

```