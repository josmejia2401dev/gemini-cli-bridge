const OutputParser = require('../../shared/utils/outputParser');
const TaskDAG = require('./dag');

/**
 * Replanner
 * Construye el prompt y parsea la respuesta para replanificar estrategias
 * al detectar estancamiento o bucles. Componente puro sin dependencias de I/O.
 */
class Replanner {
  /**
   * Genera el prompt para solicitar un nuevo DAG alternativo a la IA.
   */
  getReplanPrompt({ userObjective, failedTask, loopReason, loopDetails, errors, currentDAG }) {
    const recentErrors = errors.slice(-3).map(e => `- ${e.error || e}`).join('\n');

    return `[SISTEMA: REPLANIFICADOR AUTÓNOMO DE ESTRATEGIA]
Se ha DETECTADO UN BUCLE O ESTANCAMIENTO DETERMINÍSTICO (${loopReason}).

MOTIVO EXACTO DEL ESTANCAMIENTO:
"${loopDetails}"

SUBTAREA BLOQUEADA:
- ID: ${failedTask.id}
- Descripción: "${failedTask.description}"

OBJETIVO GLOBAL DE LA TAREA:
"${userObjective}"

ERRORES RECIENTES REGISTRADOS:
${recentErrors || 'Sin errores explícitos de sintaxis, pero sin avance de evidencias.'}

ESTRATEGIA FALLIDA A DESCARTAR:
${JSON.stringify(currentDAG.toJSON(), null, 2)}

INSTRUCCIÓN OBLIGATORIA PARA LA IA:
1. Analiza por qué la estrategia previa no funcionó y DESCÁRTALA por completo.
2. Diseña un NUEVO PLAN DE TAREAS (Task DAG) con una aproximación totalmente distinta.
3. No insistas en la misma edición de archivos ni en el mismo flujo que provocó el estancamiento.

Responde ÚNICAMENTE con un Objeto JavaScript estructurado así (usa backticks \` para los textos):

{
  tool: "task_plan",
  arguments: {
    tasks: [
      { id: "task_1", description: \`Nueva alternativa para resolver el problema\`, dependencies: [] },
      { id: "task_2", description: \`Ejecutar y verificar el nuevo enfoque\`, dependencies: ["task_1"] }
    ]
  }
}`;
  }

  /**
   * Transforma la respuesta de texto de Gemini en un nuevo TaskDAG.
   */
  parseResponse(responseText, failedTask) {
    const parseResult = OutputParser.parseToolCall(responseText);

    if (
      parseResult.success &&
      parseResult.data?.tool === 'task_plan' &&
      Array.isArray(parseResult.data.arguments?.tasks)
    ) {
      return new TaskDAG(parseResult.data.arguments.tasks);
    }

    // Fallback básico si la respuesta no incluye el esquema de DAG
    return new TaskDAG([
      { id: 'task_replan_1', description: `Revisar y abordar con enfoque alternativo: ${failedTask.description}`, dependencies: [] }
    ]);
  }
}

module.exports = Replanner;