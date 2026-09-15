```markdown
# 🚀 GeminiDev Agent (`gemini-cli-bridge`)

**GeminiDev Agent** es una herramienta de interfaz de línea de comandos (CLI) desarrollada en Node.js que conecta de forma autónoma la interfaz web de Gemini con el sistema de archivos de tu repositorio local mediante automatización de navegador (Playwright). 

Permite utilizar Gemini como un desarrollador autónomo local capaz de analizar contexto completo o parcial, realizar operaciones CRUD directas en disco duro (creación, edición, renombrado, movimiento y eliminación de archivos con backups automáticos), proponer y ejecutar comandos en terminal, gestionar múltiples sesiones de chat y adoptar perfiles expertos configurables dinámicamente.

---

## 🏗️ Arquitectura del Sistema

```text
gemini-cli-bridge/
├── index.js                  # Entry point, orquestador y bucle de delegación autónoma.
├── commands.json             # Catálogo de perfiles expertos (Prompts de Agente).
├── package.json              # Configuración de dependencias y binario global.
├── .session_chats.json       # Persistencia de los hilos de chat guardados.
├── .session_repo_path.txt    # Persistencia de la ruta del repositorio activo.
├── .session_chat_url.txt     # Persistencia de la URL del chat activo en Gemini.
├── .session/                 # Datos de sesión persistentes de Chromium (Playwright).
├── cli/
│   └── repl.js               # Gestor interactivo de consola y soporte multilínea (Copy-Paste).
├── core/
│   └── commandDispatcher.js  # Enrutador de comandos, gestión de chats e inyección global de reglas.
├── utils/
│   ├── fileScanner.js        # Escáner de repositorio, filtros y empaquetador de contexto.
│   └── codeParser.js         # Parser a prueba de balas para comandos LLM y ejecutor seguro en disco/terminal.
└── llm/
    └── geminiClient.js       # Cliente Playwright para automatización de la interfaz web de Gemini.

```

### Componentes Principales

| Componente | Archivo | Responsabilidad |
| --- | --- | --- |
| **CLI & Autonomía** | `index.js`, `cli/repl.js` | Inicializa la sesión, captura entrada multilínea e implementa el bucle de autonomía (envío de archivos bajo demanda). |
| **Enrutador & Reglas** | `core/commandDispatcher.js` | Inyecta las reglas estrictas en cada mensaje, enruta instrucciones del sistema y gestiona las sesiones de chat. |
| **Browser Engine** | `llm/geminiClient.js` | Controla Chromium persistente vía Playwright, gestiona inyección directa de prompts y extrae respuestas limpias. |
| **File Scanner** | `utils/fileScanner.js` | Filtra el proyecto mediante reglas estrictas, genera inventarios y crea paquetes de contexto `.txt`. |
| **Code Parser** | `utils/codeParser.js` | Analiza respuestas buscando etiquetas de acción, bloquea daños por merge destructivo y ejecuta comandos. |

---

## 📜 Protocolo de Autonomía y Archivos (LLM Tags)

El motor de ejecución (`codeParser.js`) dota a la IA de herramientas para investigar el entorno, ejecutar acciones y modificar el código. Monitorea las siguientes etiquetas:

### 1. Lectura Autónoma (`<<<READ>>>`)

La IA puede solicitar leer uno o más archivos físicos si le falta contexto. El sistema los empaqueta y se los envía automáticamente en segundo plano.

```text
<<<READ: package.json src/app.js,>>>

```

### 2. Sincronización Autónoma (`<<<SYNC_ALL>>>`)

Si la IA detecta que está trabajando a ciegas, puede solicitar una sincronización global. El sistema enviará el repositorio completo actualizado.

```text
<<<SYNC_ALL>>>

```

### 3. Ejecución de Comandos (`<<<CMD>>>`)

La IA puede proponer comandos de terminal. El sistema pedirá confirmación explícita al usuario (y/N) antes de ejecutar y le devolverá el resultado (log) a la IA.

```text
<<<CMD: axios install npm>>>

```

### 4. Creación y Edición Estricta (`<<<WRITE>>>` / `<<<FILE>>>`)

Sobrescribe o crea el archivo especificado bajo la **regla Zero-Merge**. La IA está obligada a generar el código **absolutamente completo**. Si el archivo ya existe localmente, se genera automáticamente una copia de seguridad (`.bak`).

```text
<<<WRITE: src/controllers/user.ts>>>
```typescript
// Código completo aquí

```

### 5. Modificación Estructural (`<<<MOVE>>>` y `<<<DELETE>>>`)

Renombra, mueve (creando carpetas intermedias) o elimina forzosamente directorios y archivos.

```text
<<<MOVE: src/old.ts > src/new.ts>>>
<<<DELETE: src/legacy/file.js>>>

```

---

## 🛠️ Catálogo de Comandos CLI

El sistema clasifica las instrucciones ingresadas en la consola interactiva en tres categorías. El enrutador es tolerante a errores de escritura (acepta formatos con y sin guion).

### 1. Comandos de Chat (Gestión de Sesiones)

Permite tener múltiples hilos de conversación guardados (ej. uno para frontend, otro para backend).

| Comando | Descripción |
| --- | --- |
| `/chat-new` | Limpia el contexto y abre un chat nuevo en Gemini. |
| `/chat-save <nombre>` | Guarda el hilo actual bajo un identificador (ej. `/chat-save modulo-pagos`). |
| `/chat-list` | Muestra todos los chats guardados en `.session_chats.json`. |
| `/chat-load <nombre>` | Cambia el navegador inmediatamente al chat seleccionado. |
| `/chat-delete <nombre>` | Elimina un chat de la lista de guardados. |

### 2. Comandos de Sistema

Procesados internamente por Node.js.

| Comando | Descripción |
| --- | --- |
| `/help` | Muestra la guía completa de comandos CLI. |
| `/paste` | Activa el modo multilínea, ideal para pegar cientos de líneas de código o logs de error sin crashear Node. |
| `/upload-files` | Empaqueta y sube todo el contexto local explícitamente. |
| `/sync <rutas>` | Sincroniza únicamente los archivos indicados. (ej. `/sync src/app.js`) |
| `/history` | Extrae el historial y genera `HISTORIAL_CHAT.md`. |
| `/exit` | Cierra Chromium y el proceso de Node.js. |

### 3. Comandos de Agente (`commands.json`)

Inyectan un perfil experto específico antes de tu consulta.

* `/dev`: Agente Full-Stack genérico.
* `/dev-node`, `/dev-react`, `/dev-angular`, `/dev-java`: Perfiles especializados.
* `/devops`, `/refactor`, `/review`, `/test-node`, `/test-java`: Perfiles de operaciones, QA y arquitectura.

> **💡 Modo Chat Normal:** Si escribes un mensaje normal (sin comandos), el sistema aplicará silenciosamente las reglas de seguridad y autonomía globales para garantizar que la IA mantenga su comportamiento seguro, sin imponerle un rol específico.

---

## 📂 Reglas del Escáner de Archivos (`fileScanner.js`)

Para optimizar tokens, el escáner ignora directorios pesados (`node_modules`, `.git`, `dist`, `.next`, etc.) y solo empaqueta extensiones válidas de desarrollo web, backend, estilos, configuraciones e infraestructura (`.js`, `.ts`, `.html`, `.css`, `.py`, `.java`, `Dockerfile`, `package.json`, etc.).

---

## ⚡ Instalación y Configuración Global

1. Clona o ubícate en la carpeta del proyecto `gemini-cli-bridge`:

```bash
cd /ruta/de/tu/proyecto/gemini-cli-bridge

```

2. Instala las dependencias y los binarios de Playwright:

```bash
npm install

```

3. Enlaza el paquete de forma global:

```bash
npm link

```

*(En sistemas Linux/macOS puede requerir `sudo npm link`)*.

---

## 🛡️ Medidas de Seguridad y Robustez (Architect Level)

1. **Protección Anti-Alucinaciones (Zero-Merge):** Si el parser detecta que la IA intentó escribir un archivo de forma incompleta (ej. un fragmento muy corto para un archivo grande), el sistema bloquea la sobreescritura, aborta la operación y reprende a la IA automáticamente obligándola a reescribir el código íntegro.
2. **Delegación Orientada a Eventos:** La IA no actúa a ciegas; si carece de contexto, usa etiquetas de lectura para que el bucle de Node.js extraiga el código real del disco y se lo envíe antes de proceder.
3. **Aislamiento de Entorno (`isSafePath`):** Bloquea cualquier intento de Path Traversal asegurando que el agente solo interactúe dentro de `projectRoot`.
4. **Sandboxing de Terminal:** Todo uso de `<<<CMD>>>` pausa el hilo y exige la autorización humana expresa (y/N) antes de interactuar con el SO.

```

```