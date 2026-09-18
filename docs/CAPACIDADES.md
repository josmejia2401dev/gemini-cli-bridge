# Especificación Técnica V3: Mapa de Capacidades Funcionales

---

## 🗺️ Mapa General de Capacidades Funcionales

```text
GEMINIDEV V3
│
├── 1. Gestión de Estado y Continuidad
├── 2. Descomposición Autónoma de Tareas (DAG)
├── 3. Enrutamiento de Ejecución (Determinístico vs. Razonamiento)
├── 4. Comprensión del Repositorio (Repository Intelligence)
├── 5. Análisis Predictivo de Impacto
├── 6. Modificación e Integridad Segura del Filesystem (Zero-Git)
├── 7. Verificación Basada en Evidencias Determinísticas
├── 8. Diagnóstico de Causa Raíz y Análisis de Errores
├── 9. Reflexión, Replanificación Autónoma y Control de Bucles
├── 10. Memoria Contextual, Arquitectónica y Consolidación
├── 11. Descubrimiento y Selección Inteligente de Herramientas
├── 12. Control de Recursos, Presupuesto y Guardrails
└── 13. Observabilidad, Evaluación Continua y Aprendizaje

```

---

## 📋 Especificación Detallada por Capacidad Funcional

### 1. Gestión de Estado y Continuidad

* **Objetivo:** Garantizar que el agente sepa en todo momento qué paso está ejecutando, qué ha completado, qué falló y pueda pausar o reanudar tareas sin perder contexto.
* **Qué debe saber hacer:**
* Iniciar, pausar, restaurar y finalizar una tarea guardando snapshots serializables del ciclo de vida (`IDLE`, `PLANNING`, `EXECUTING`, `VERIFYING`, `REFLECTING`, `SUCCESS`, `REPLAN`).
* Registrar el historial exacto de herramientas invocadas, archivos leídos, archivos modificados y errores encontrados.
* Continuar una ejecución interrumpida (por reinicio de consola o fallo) desde el último checkpoint estable.


* **Componentes Necesarios:** `AgentState`, `CheckpointManager`, SQLite (`agent_runs`, `agent_checkpoints`).
* **Interacción con Gemini:** Ninguna. Capacidad 100% determinística gestada por el Runtime.
* **Criterios de Aceptación:**
* Toda transición de estado y ejecución de herramienta genera automáticamente un snapshot en la tabla `agent_checkpoints`.
* Si la CLI se interrumpe abruptamente (vía `Ctrl+C` o fallo de proceso), la ejecución se retoma exactamente en el mismo paso al volver a abrir la terminal.



#### Verificación del Criterio de Aceptación

1. **Simulación de Interrupción:**
* Inicias una tarea: `gemini-cli-bridge /dev-node Crea un módulo de autenticación con 3 archivos`.
* Durante la fase `EXECUTING` (tras crear el primer archivo), cierras la consola o presionas `Ctrl+C`.


2. **Reinicio de la CLI:**
```text
gemini-cli-bridge /ruta/al/proyecto

  Se detectó actividad previa.

  ⚠️ [SISTEMA] Se detectó una tarea anterior pendiente o interrumpida:
     - Run ID: run_1726661000
     - Objetivo: "Crea un módulo de autenticación con 3 archivos"
     - Estado: EXECUTING (Paso 2)

  ¿Deseas reanudar esta tarea? (Y/n): y

  [🔄 REANUDACIÓN] Retomando tarea (Paso 2) - Estado: EXECUTING

```


3. **Validación:** El agente reanuda desde SQLite sin repetir los archivos creados antes de la interrupción.

---

### 2. Descomposición Autónoma de Tareas

* **Objetivo:** Transformar requerimientos complejos y ambiguos en una secuencia lógica de subtareas interrelacionadas mediante un Grafo Acíclico Dirigido (DAG).
* **Qué debe saber hacer:**
* Recibir una instrucción general (ej. *"Agrega autenticación JWT"*) y dividirla en un árbol de dependencias ejecutables.
* Identificar qué subtareas son secuenciales y cuáles son independientes para ejecución inmediata.
* Marcar dinámicamente subtareas como `pending`, `in_progress`, `completed` o `failed`.


* **Componentes Necesarios:** `TaskDecomposer`, `TaskDAG`.
* **Interacción con Gemini:** **Razonamiento (LLM).** Gemini analiza la intención del usuario y genera la estructura de nodos dependientes en formato JSON/Objeto JS.
* **Criterios de Aceptación:**
* Ante una orden compleja, el agente genera e imprime en la terminal la lista ordenada de subtareas (DAG) antes de ejecutar la primera acción.
* Cada subtarea actualiza su estado dinámicamente (`pending` ➔ `in_progress` ➔ `completed`) guardando checkpoints en SQLite.



#### Verificación del Criterio de Aceptación

1. **Ejecución de Comando Complejo:**
`gemini-cli-bridge /dev-node Implementa un servicio de usuarios con rutas y pruebas`
2. **Respuesta en Pantalla (Previo a cualquier acción):**
```text
  🧠 Analizando intención y generando DAG de tareas con Gemini...

  📋 [PLAN DE EJECUCIÓN - TASK DAG]
  ===============================================================
  📌 [task_1] Analizar estructura actual del repositorio (Independiente / Lista)
  📌 [task_2] Crear controlador y rutas de usuario (Depende de: task_1)
  📌 [task_3] Crear servicio de usuarios (Depende de: task_1)
  📌 [task_4] Generar ejecuciones de prueba del servicio (Depende de: task_2, task_3)
  ===============================================================

  🚀 [EJECUTANDO SUBTAREA] [task_1]: Analizar estructura actual del repositorio

```


3. **Validación:** El flujo avanza respetando las dependencias declaradas en la estructura de nodos.

---

### 3. Enrutamiento de Ejecución (Determinístico vs. Razonamiento)

* **Objetivo:** Autoclasificar cada acción para decidir si debe ser resuelta localmente por Node.js o enviada a Gemini, reduciendo latencia y consumo de tokens.
* **Qué debe saber hacer:**
* Evaluar si una acción requiere comprensión semántica (IA) o si es una operación directa de sistema de archivos/consola (Local).
* Clasificar las acciones en tres modos: `DETERMINISTIC` (Local puro), `LLM_REQUIRED` (IA pura) o `HYBRID` (Local procesa, IA interpreta).


* **Componentes Necesarios:** `ExecutionDecisionEngine`.
* **Tabla de Clasificación Funcional:**

| Acción Requerida | Clasificación | Ejecutor Primario |
| --- | --- | --- |
| Leer/Escribir archivo | `DETERMINISTIC` | GeminiDev Runtime |
| Buscar texto / Símbolos | `DETERMINISTIC` | GeminiDev Runtime |
| Ejecutar tests / Comandos | `DETERMINISTIC` | GeminiDev Runtime |
| Validar sintaxis (.tmp) | `DETERMINISTIC` | GeminiDev Runtime |
| Diseñar arquitectura | `LLM_REQUIRED` | Gemini |
| Generar código fuente | `LLM_REQUIRED` | Gemini |
| Interpretar stacktrace | `LLM_REQUIRED` | Gemini |
| Replanificar estrategia | `LLM_REQUIRED` | Gemini |

* **Criterios de Aceptación:**
* Comandos verbales directos o ejecuciones de consola se procesan en modo `DETERMINISTIC` de forma instantánea.
* Operaciones locales de búsqueda o comandos de terminal consumen 0 tokens en Gemini y no abren la sesión de Playwright.



#### Verificación del Criterio de Aceptación

1. **Prueba de Búsqueda / Ejecución Directa:**
Ingresas en la CLI: `busca UserService` o `npm test`.
2. **Resultado de la Consola (Instantáneo):**
```text
  📋 [PLAN DE EJECUCIÓN - TASK DAG]
  ===============================================================
  📌 [task_1] busca UserService (Independiente / Lista)
  ===============================================================

  🚀 [EJECUTANDO SUBTAREA] [task_1]: busca UserService
  ⚡ [ENRUTAMIENTO DETERMINÍSTICO] Ejecución local instantánea (Sin IA) -> Herramienta: "search_code"
  Resultado: {
    "query": "UserService",
    "matchesCount": 2,
    "matches": [
      "src/services/UserService.js",
      "src/controllers/UserController.js"
    ]
  }
  ✅ [SUBTAREA COMPLETADA] [task_1]

  🎉 [ÉXITO GLOBAL] Todas las subtareas del DAG han sido completadas con éxito.

```


3. **Validación:** Tiempo de respuesta $< 0.05$ segundos, $0$ tokens consumidos y la sesión de navegador permanece inactiva.

---

### 4. Comprensión del Repositorio (Repository Intelligence)

* **Objetivo:** Mapear y entender la estructura, símbolos y dependencias del código fuente antes de proponer cambios.
* **Qué debe saber hacer:**
* Escanear el repositorio para indexar clases, funciones, exportaciones e importaciones.
* Construir un mapa de dependencias entre archivos sin cargar todo el código en el prompt de la IA.
* Responder consultas de estructura interna de forma determinística.


* **Componentes Necesarios:** `RepositoryIntelligence`, `RepositoryIndexer`, `PatternEngine`.
* **Interacción con Gemini:** Híbrida. GeminiDev extrae los símbolos con AST/Regex; Gemini consulta el índice resultante cuando diseña una solución.
* **Criterios de Aceptación:**
* El agente puede responder qué archivos importan o dependen de una clase específica en menos de 10 milisegundos.
* La consulta se resuelve sin leer físicamente todo el código ni cargarlo en la memoria del LLM.



#### Verificación del Criterio de Aceptación

1. **Consulta CLI Directa:**
Ingresas en la CLI: `quién importa OutputParser`.
2. **Respuesta en Pantalla (< 5 milisegundos, 0 tokens consumidos de la IA):**
```text
  📋 [PLAN DE EJECUCIÓN - TASK DAG]
  ===============================================================
  📌 [task_1] quién importa OutputParser (Independiente / Lista)
  ===============================================================

  🚀 [EJECUTANDO SUBTAREA] [task_1]: quién importa OutputParser
  ⚡ [ENRUTAMIENTO DETERMINÍSTICO] Ejecución local instantánea (Sin IA) -> Herramienta: "who_imports"
  Resultado: {
    "target": "OutputParser",
    "count": 2,
    "importers": [
      "src/agent/runtime.js",
      "src/agent/decomposer.js"
    ]
  }
  ✅ [SUBTAREA COMPLETADA] [task_1]

  🎉 [ÉXITO GLOBAL] Todas las subtareas del DAG han sido completadas con éxito.

```


3. **Validación:** El grafo de importaciones mapea los consumidores exactos a partir del índice local.

---

### 5. Análisis Predictivo de Impacto

* **Objetivo:** Determinar qué archivos adicionales o módulos colindantes podrían verse afectados o rotos antes de realizar la modificación de un archivo.
* **Qué debe saber hacer:**
* Dado un archivo objetivo a modificar (ej. `UserService.js`), rastrear sus consumidores directos e indirectos (`UserController.js`, `UserTests.js`).
* Incluir de forma preventiva los archivos impactados dentro del contexto de verificación.
* Inyectar una notificación formal a Gemini solicitándole validar si sus cambios alteran contratos o firmas.


* **Componentes Necesarios:** `ImpactAnalysis`, `RepositoryIntelligence`.
* **Interacción con Gemini:** Determinístico en el rastreo de dependencias; Gemini lo utiliza para planificar la actualización en cascada.
* **Criterios de Aceptación:**
* Al solicitar la modificación de un archivo consumido por otros módulos, el agente detecta automáticamente los archivos dependientes.
* Se inyecta un aviso obligatorio a la IA indicándole que valide el impacto en los módulos colindantes antes de generar código.



#### Verificación del Criterio de Aceptación

1. **Instrucción de Modificación:**
`gemini-cli-bridge /dev-node Cambia la firma del método en OutputParser.js`
2. **Ejecución y Registro en Consola:**
```text
  🧠 Analizando intención y generando DAG de tareas con Gemini...

  📋 [PLAN DE EJECUCIÓN - TASK DAG]
  ===============================================================
  📌 [task_1] Cambia la firma del método en OutputParser.js (Independiente / Lista)
  ===============================================================

  🚀 [EJECUTANDO SUBTAREA] [task_1]: Cambia la firma del método en OutputParser.js
  🎯 [ANÁLISIS DE IMPACTO] "OutputParser.js" afecta a 2 archivo(s) consumidores/tests.

  Procesando con Gemini (Agent Runtime V2 - JS Object Mode)...

```


3. **Prompt Inyectado Automáticamente a Gemini:**
```text
[SUBTAREA ACTIVA: task_1]
Descripción: Cambia la firma del método en OutputParser.js

Objetivo Global: "/dev-node Cambia la firma del método en OutputParser.js"

[SISTEMA: ANÁLISIS PREDICTIVO DE IMPACTO DETERMINÍSTICO]
Atención: El archivo objetivo "OutputParser.js" es consumido por los siguientes archivos de tu proyecto:
- Módulos/Controladores dependientes: src/agent/runtime.js, src/agent/decomposer.js

INSTRUCCIÓN OBLIGATORIA PARA LA IA:
Este listado fue generado mediante análisis estático de dependencias. DEBES VALIDAR si tus modificaciones en "OutputParser.js" alteran firmas de métodos, interfaces o contratos, y de ser así, incluir la actualización en cascada de estos archivos afectados dentro de tu plan de trabajo.

```


4. **Validación:** Gemini recibe la lista exacta de consumidores, valida el impacto y actualiza en cascada los controladores o servicios correspondientes.

---

### 6. Modificación e Integridad Segura del Filesystem (Zero-Git)

* **Objetivo:** Escribir y actualizar código de forma atómica garantizando que ningún archivo termine corrupto o con sintaxis inválida, sin utilizar Git.
* **Qué debe saber hacer:**
* Aplicar el paradigma **Zero-Git**: Trabajar sobre el estado actual del proyecto entregando archivos completos en **JS Object Mode** (usando backticks ```).
* Escribir cambios en un archivo temporal de trabajo (`.tmp`).
* Ejecutar una prueba de integridad sintáctica determinística (`node --check` o `JSON.parse`).
* Si la sintaxis es correcta, realizar el reemplazo atómico (`fs.renameSync`). Si es inválida, eliminar el `.tmp` dejando el código original intacto.
* Validar límites de seguridad (*Path Traversal*) para no operar fuera de `projectRoot`.


* **Componentes Necesarios:** `AtomicWriter`, `PolicyEngine`, `OutputParser`.
* **Interacción con Gemini:** Gemini genera el código completo del archivo; GeminiDev valida la sintaxis y realiza el swap en disco.
* **Criterios de Aceptación:**
* Si Gemini genera un archivo JavaScript con una llave no cerrada o error sintáctico, el archivo original en el disco jamás se modifica.
* El archivo `.tmp` defectuoso se elimina automáticamente y el runtime le reporta el error exacto a la IA para su corrección.



#### Verificación del Criterio de Aceptación

1. **Escenario de Código Corrupto:**
Gemini intenta escribir en `src/services/UserService.js` un código sintácticamente inválido (ej. llave sin cerrar):
```javascript
function getUsers() { return []; // Falta la llave de cierre '}'

```


2. **Comportamiento en la Terminal:**
```text
  [⚡ TOOL RUNTIME (JS MODE)] Herramienta solicitada: "write_file"
  Error en Agent Runtime: [ERROR DE SINTAXIS EN CÓDIGO GENERADO] El archivo 'src/services/UserService.js' NO se modificó en disco para evitar corrupción. Motivo: .../src/services/UserService.js.tmp:1
  function getUsers() { return [];
                       ^
  SyntaxError: Unexpected end of input

```


3. **Inspección del Filesystem:**
* El archivo temporal `src/services/UserService.js.tmp` es destruido.
* El archivo original `src/services/UserService.js` **permanece 100% intacto**.
* El error sintáctico se retroalimenta a Gemini para su corrección en la siguiente iteración.



---

### 7. Verificación Basada en Evidencias Determinísticas

* **Objetivo:** Validar objetivamente si un objetivo se cumplió mediante pruebas ejecutables, eliminando falsos positivos donde la IA afirma haber terminado sin probar el código.
* **Qué debe saber hacer:**
* Exigir la recolección de artefactos concretos antes de marcar una tarea como `SUCCESS`.
* Auditar tres tipos de evidencia: `file_exists` (Existencia física de archivos), `command_pass` (Código de salida $0$ en scripts de compilación/tests) y `http_check` (Validación de respuestas HTTP de endpoints).
* Bloquear la finalización si alguna de las evidencias falla.


* **Componentes Necesarios:** `EvidenceEngine`, `Verifier`.
* **Interacción con Gemini:** Gemini propone qué evidencias deberían cumplirse; GeminiDev las ejecuta y verifica de forma 100% determinística.
* **Criterios de Aceptación:**
* Aunque Gemini responda *"He completado la tarea"*, el agente no finaliza la ejecución hasta que `npm test` o la comprobación física devuelvan un resultado exitoso.
* Si alguna evidencia obligatoria falla, la finalización se bloquea y el runtime fuerza a la IA a solucionar los fallos pendientes.



#### Verificación del Criterio de Aceptación

1. **Escenario:** Gemini afirma haber concluido la subtarea mediante texto plano (*"He terminado de implementar las pruebas"*), pero la prueba de consola falla.
2. **Ejecución del Runtime (Bloqueo de Finalización):**
```text
-------------------- IA --------------------
✓ Instrucciones aplicadas
He terminado de implementar las pruebas para el controlador de usuarios.
--------------------------------------------

  🔎 [BARRERA DE EVIDENCIAS] Gemini declaró haber terminado la subtarea [task_2]. Verificando evidencias determinísticas...
  ⛔ [BARRERA DE EVIDENCIAS BLOQUEADA] Se bloqueó la finalización. Pruebas fallidas: 1

```


3. **Feedback Inyectado a Gemini:**
```text
[SISTEMA ERROR: EVIDENCIAS OBLIGATORIAS NO SUPERADAS]
Afirmaste haber terminado la subtarea, pero las siguientes comprobaciones determinísticas FALLARON:
- command_pass en 'npm test': Comando falló. Error: 1 test failed in UserController.test.js

NO puedes concluir la subtarea hasta resolver estos errores y asegurarte de que el código compila y pasa las pruebas.

```


4. **Validación:** El estado `SUCCESS` únicamente se concede cuando `npm test` responde con código de salida $0$.

---

### 8. Diagnóstico de Errores y Causa Raíz

* **Objetivo:** Analizar las salidas de error de la terminal o fallos de compilación para distinguir entre errores conocidos (con solución previa en memoria) y errores nuevos.
* **Qué debe saber hacer:**
* Capturar la salida completa de `stderr`/`stdout` tras la ejecución de un comando.
* Consultar la memoria episódica en busca de firmas de error idénticas.
* Extraer el fragmento relevante del stacktrace eliminando ruido excesivo de `node_modules` antes de enviarlo a análisis.


* **Componentes Necesarios:** `ErrorAnalyzer`, `Reflector`, `EpisodicMemory`.
* **Interacción con Gemini:** Híbrida. GeminiDev busca coincidencia exacta en memoria; si es un error inédito, le solicita a Gemini un Análisis de Causa Raíz (RCA).
* **Criterios de Aceptación:**
* Ante un error conocido registrado previamente en `episodic_memory`, el agente aplica la solución histórica de forma determinística sin consultar a la IA.
* Para errores nuevos, se depura el stacktrace suprimiendo líneas irrelevantes antes de pasarlo a Gemini.



#### Verificación del Criterio de Aceptación

1. **Escenario de Error Conocido:**
En `episodic_memory` existe el registro previo: `Error: Cannot find module 'express'` ➔ Solución: `npm install express`.
2. **Fallo en Terminal:**
Un comando falla arrojando `Error: Cannot find module 'express'`.
3. **Ejecución en Consola (Autocorrección sin IA):**
```text
  🚀 [EJECUTANDO SUBTAREA] [task_1]: npm test
  ⚡ [ENRUTAMIENTO DETERMINÍSTICO] Ejecución local instantánea (Sin IA) -> Herramienta: "execute_command"
  ❌ Error en ejecución determinística: Error: Cannot find module 'express'
  🧠 [AUTOCORRECCIÓN DETERMINÍSTICA] Error conocido detectado: "Error: Cannot find module 'express'". Aplicando solución histórica sin IA...
  ✅ [CORRECCIÓN APLICADA] Se ejecutó: "npm install express"

```


4. **Validación:** El agente soluciona la dependencia omitiendo la consulta a Gemini y ahorrando la cuota de tokens.

---

### 9. Reflexión, Replanificación Autónoma y Control de Bucles

* **Objetivo:** Evitar bucles infinitos de reintentos ciegos cuando una solución no funciona, forzando la reestructuración del plan de trabajo o el cambio de estrategia.
* **Qué debe saber hacer:**
* Monitorear si el agente ejecuta la misma acción ($A-A-A$), alterna secuencialmente entre dos comandos ($A-B-A-B$) o entra en estado `NO_PROGRESS` (3 iteraciones modificando código sin disminuir errores ni mejorar evidencias).
* Pausar la ejecución en bucle al detectar `NO_PROGRESS` invocando al `Replanner`.
* Generar un plan alternativo descartando la ruta que falló.


* **Componentes Necesarios:** `LoopDetector`, `Reflector`, `Replanner`.
* **Interacción con Gemini:** GeminiDev detecta el bucle de forma determinística; Gemini analiza la causa del estancamiento y genera el nuevo plan.
* **Criterios de Aceptación:**
* Si editar un archivo 3 veces seguidas no hace pasar los tests, el agente detiene los reintentos y declara `NO_PROGRESS`.
* El `Replanner` exige a Gemini descartar la ruta fallida y construir un nuevo `TaskDAG` con un enfoque alternativo.



#### Verificación del Criterio de Aceptación

1. **Escenario:**
El agente modifica `UserService.js` durante 3 iteraciones continuas, pero los tests siguen fallando.
2. **Detección y Replanificación en la Terminal:**
```text
  🚀 [EJECUTANDO SUBTAREA] [task_1]: Corregir error en UserService.js

  [⚡ TOOL RUNTIME (JS MODE)] Herramienta solicitada: "write_file"
  ⛔ [BARRERA DE EVIDENCIAS BLOQUEADA] Se bloqueó la finalización. Pruebas fallidas: 1

  [Iteración #2 modificando archivo...]
  ⛔ [BARRERA DE EVIDENCIAS BLOQUEADA] Se bloqueó la finalización. Pruebas fallidas: 1

  [Iteración #3 modificando archivo...]

  🛑 [DETERMINISTIC LOOP DETECTED] Motivo: NO_PROGRESS
     Detalles: Se realizaron 3 iteraciones modificando código sin lograr que los tests pasen ni reducir los errores.

  🧠 [REPLANNER] Solicitando una estrategia completamente nueva a Gemini...

  🔄 [REPLANIFICACIÓN COMPLETADA] Nueva estrategia asignada:

  📋 [PLAN DE EJECUCIÓN - TASK DAG]
  ===============================================================
  📌 [task_1] Revisar la configuración del entorno en .env en lugar de editar UserService.js (Independiente / Lista)
  📌 [task_2] Volver a ejecutar npm test (Depende de: task_1)
  ===============================================================

```


3. **Validación:** El sistema abandona la modificación infinita de `UserService.js` y reorienta el plan hacia el archivo `.env`.

---

### 10. Memoria Contextual, Arquitectónica y Consolidación

* **Objetivo:** Convertir las ejecuciones pasadas en aprendizaje útil para el futuro y retener las reglas de diseño del proyecto.
* **Qué debe saber hacer:**
* Guardar decisiones de arquitectura (ej. *"Este proyecto usa patrón Hexagonal; la lógica no va en controladores"*).
* Asignar un puntaje de confianza (`MemoryConfidence` de 0.0 a 1.0) a las lecciones almacenadas basado en su tasa de éxito histórico.
* Consolidar la memoria al finalizar una tarea exitosa, filtrando registros triviales de consola para almacenar únicamente aprendizajes de alto valor.


* **Componentes Necesarios:** `ArchitecturalMemory`, `EpisodicMemory`, `MemoryConsolidator`, LanceDB.
* **Interacción con Gemini:** Híbrida. GeminiDev recupera las reglas y lecciones relevantes; Gemini las aplica durante el diseño de código.
* **Criterios de Aceptación:**
* Al iniciar una tarea sobre un proyecto con reglas de arquitectura registradas, estas se inyectan en el prompt inicial.
* Al concluir con éxito una tarea, las lecciones relevantes se consolidan asignándoles un puntaje de confianza inicial.



#### Verificación del Criterio de Aceptación

1. **Inyección de Memoria Arquitectónica:**
Al ejecutar una tarea de backend en un repositorio configurado:
```text
  [🧠 MEMORIA ARQUITECTÓNICA ACTIVA]
  Reglas de diseño del proyecto inyectadas:
  - Regla #1: Arquitectura Hexagonal estricta. Prohibido importar Repositorios en Controllers.
  - Regla #2: Utilizar DTOs con validación Zod en la capa de entrada.

```


2. **Consolidación Post-Tarea:**
```text
  🎉 [ÉXITO GLOBAL] Tarea completada.
  🧠 [CONSOLIDACIÓN DE MEMORIA] Registrada nueva lección aprendida: "Uso de conectores reactivos R2DBC". Confianza asignada: 0.90.

```


3. **Validación:** En tareas futuras, Gemini respeta las restricciones de diseño inyectadas sin necesidad de recordárselas manualmente.

---

### 11. Seleccionar Inteligentemente las Herramientas

* **Objetivo:** Exponer a la IA únicamente las herramientas relevantes para el contexto de la tarea activa, previniendo confusión y reduciendo el consumo de tokens.
* **Qué debe saber hacer:**
* Descubrir herramientas expuestas por servidores MCP externos (`MCPDiscovery`).
* Filtrar la lista global de herramientas dejando activas solo aquellas pertinentes al nodo actual del DAG (ej. habilitar herramientas de base de datos solo en tareas de persistencia).


* **Componentes Necesarios:** `ToolSelector`, `MCPDiscovery`, `ToolRegistry`.
* **Interacción con Gemini:** Determinística. El runtime reduce el catálogo de herramientas antes de construir el prompt.
* **Criterios de Aceptación:**
* Durante subtareas de edición de estilos o marcado, las herramientas destructivas de terminal o base de datos quedan excluidas del catálogo expuesto.
* Las herramientas descubiertas vía MCP se registran en el `ToolRegistry` dinámicamente.



#### Verificación del Criterio de Aceptación

1. **Subtarea de Frontend/Estilos:**
Subtarea activa: `Modificar estilos CSS del componente Header.jsx`.
2. **Comportamiento del ToolSelector:**
```text
  🚀 [EJECUTANDO SUBTAREA] [task_2]: Modificar estilos CSS de Header.jsx
  🔧 [TOOL SELECTOR] Catálogo optimizado: 2 herramientas expuestas (write_file, read_files). 4 herramientas omitidas (execute_command, analyze_impact, etc.).

```


3. **Validación:** Gemini solo visualiza en las instrucciones del sistema los esquemas de las herramientas relevantes para esa subtarea puntual.

---

### 12. Administrar Recursos, Presupuesto y Guardrails

* **Objetivo:** Establecer fronteras infranqueables de tiempo, tokens e iteraciones para evitar que el agente opere indefinidamente en segundo plano.
* **Qué debe saber hacer:**
* Controlar los contadores de presupuesto: `maxIterations` (ej. 30), `maxToolCalls` (ej. 100), `maxModelCalls` (ej. 50) y `maxExecutionTimeMs` (ej. 30 min).
* Detener de forma segura la ejecución cuando se alcanza cualquiera de los límites, guardando el checkpoint en SQLite.


* **Componentes Necesarios:** `AgentBudget`, `CheckpointManager`.
* **Interacción con Gemini:** Ninguna. Control 100% determinístico en la capa del Runtime.
* **Criterios de Aceptación:**
* Al alcanzarse el límite de iteraciones o tiempo máximo sin completar las evidencias, el runtime detiene las llamadas a la IA.
* El estado se guarda en `agent_checkpoints` indicando la causa del pausado por presupuesto.



#### Verificación del Criterio de Aceptación

1. **Superación de Límite Configurado:**
El contador de iteraciones alcanza el límite configurado (`maxIterations = 30`).
2. **Interrupción Determinística:**
```text
  🛑 [AGENT BUDGET EXCEEDED] Se ha alcanzado el límite máximo de iteraciones permitidas (30/30).
  💾 [CHECKPOINT] Guardando estado actual del AgentState en SQLite...
  ℹ️ Ejecución pausada de forma segura. Puedes reanudar la tarea incrementando el presupuesto o revisando los errores.

```


3. **Validación:** El proceso finaliza de forma limpia sin generar llamadas adicionales a Playwright ni consumir recursos.

---

### 13. Observabilidad, Evaluación Continua y Aprendizaje

* **Objetivo:** Medir cuantitativamente el rendimiento del agente y recopilar trazas limpias de ejecución para auditoría o futuro *Fine-Tuning*.
* **Qué debe saber hacer:**
* Registrar la telemetría detallada por componente mediante `Tracer` (duración exacta de lecturas, escrituras, llamadas a Gemini y verificación).
* Ejecutar la suite de pruebas sintéticas (`Evaluator`) frente a un dataset de tareas patrón (`eval/testCases/`) calculando la tasa de éxito y tiempos de recuperación.
* Formatear y almacenar trazas de ejecuciones exitosas en `.agent_data/dataset.jsonl` para estructurar conjuntos de datos de aprendizaje.


* **Componentes Necesarios:** `Tracer`, `MetricsCollector`, `Evaluator`, `ExecutionLogger`.
* **Interacción con Gemini:** Determinístico en la recolección de métricas.
* **Criterios de Aceptación:**
* Ejecutar el benchmark sintético genera un reporte tabular interactivo con precisión, latencias medias y tasa de recuperación.
* Toda tarea completada con éxito exporta su traza en formato JSONL dentro del directorio de datos del agente.



#### Verificación del Criterio de Aceptación

1. **Ejecución del Evaluador:**
```bash
node src/eval/evaluator.js

```


2. **Reporte Tabular en Consola:**
```text
===================================================================
  🧪 [EVALUADOR & BENCHMARK] Ejecutando suite de pruebas sintácticas
===================================================================

┌─────────┬──────────┬──────────────────────────┬───────────┬──────────┬────────────┐
│ (index) │  TestID  │          Tarea           │ Resultado │ Detalle  │  Latencia  │
├─────────┼──────────┼──────────────────────────┼───────────┼──────────┼────────────┤
│    0    │  '001'   │ 'Ejecutar limpieza Gr…'  │ 'PASÓ ✅' │   'OK'   │   '1ms'    │
└─────────┴──────────┴──────────────────────────┴───────────┴──────────┴────────────┘
-------------------------------------------------------------------
  📊 RESUMEN CUANTITATIVO DEL BENCHMARK
-------------------------------------------------------------------
  • Tasa de Precisión Sintáctica: 100.0% (1/1)
  • Latencia Media de Verificación: 1 ms
  • Tasa de Recuperación de Bucles: 100.0%
===================================================================

```


3. **Validación del Dataset:** Al finalizar una tarea exitosa en producción, se confirma la adición de una nueva línea estructurada en `.agent_data/dataset.jsonl`.