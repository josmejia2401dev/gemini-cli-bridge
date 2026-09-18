const OutputParser = require('../../shared/utils/outputParser');
const TaskDAG = require('./dag');

class TaskDecomposer {
  constructor(modelRouter) {
    this.modelRouter = modelRouter;
  }

  async decompose(userObjective) {
    const prompt = `[SISTEMA: PLANIFICADOR DE TAREAS DAG]
Debes analizar la siguiente solicitud del usuario y descomponerla en un Grafo Acíclico Dirigido (DAG) de subtareas lógicas, atómicas y ordenadas según sus dependencias.

SOLICITUD: "${userObjective}"

REGLAS DE DESCOMPOSICIÓN:
- Asigna identificadores únicos a cada tarea ("task_1", "task_2", etc.).
- Identifica qué tareas dependen de la finalización de otras (dependencies).
- Las tareas sin dependencias podrán ejecutarse de inmediato.

INSTRUCCIÓN DE SALIDA:
Responde ÚNICAMENTE con un Objeto JavaScript estructurado así (usa backticks \` para los textos):

{
  tool: "task_plan",
  arguments: {
    tasks: [
      { id: "task_1", description: \`Analizar estructura del proyecto\`, dependencies: [] },
      { id: "task_2", description: \`Crear configuración y middleware\`, dependencies: ["task_1"] },
      { id: "task_3", description: \`Ejecutar pruebas del módulo\`, dependencies: ["task_2"] }
    ]
  }
}`;

    console.log('  🧠 Analizando intención y generando DAG de tareas con Gemini...');
    const response = await this.modelRouter.generate({ prompt });
    const parseResult = OutputParser.parseToolCall(response.text);

    if (
      parseResult.success &&
      parseResult.data?.tool === 'task_plan' &&
      Array.isArray(parseResult.data.arguments?.tasks)
    ) {
      return new TaskDAG(parseResult.data.arguments.tasks);
    }

    // Fallback directo si la tarea es simple o Gemini no emite estructura (KISS)
    return new TaskDAG([
      { id: 'task_1', description: userObjective, dependencies: [] }
    ]);
  }
}

module.exports = TaskDecomposer;