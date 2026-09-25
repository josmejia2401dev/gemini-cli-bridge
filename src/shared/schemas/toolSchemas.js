const { z } = require('zod');

const executeCommandSchema = z.object({
  command: z.string().min(1, 'El comando no puede estar vacío.')
});

const readFilesSchema = z.object({
  paths: z.array(z.string().min(1, 'Ruta inválida')).min(1, 'Debe especificar al menos una ruta de archivo.')
});

const searchCodeSchema = z.object({
  query: z.string().min(1, 'El término de búsqueda es obligatorio.')
});

const writeFileSchema = z.object({
  filePath: z.string().min(1, 'La ruta del archivo es obligatoria.'),
  content: z.string(),
  createDirs: z.boolean().optional().default(true)
});

const taskPlanSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string().min(1, 'El ID de la tarea es obligatorio.'),
      description: z.string().min(1, 'La descripción de la tarea es obligatoria.'),
      tool: z.string().min(1).optional(),
      args: z.record(z.any()).optional().default({}),
      context: z.record(z.any()).optional().default({}),
      dependencies: z.array(z.string()).optional().default([])
    })
  ).min(1, 'El plan debe contener al menos una tarea.')
});

const taskCompleteSchema = z.object({
  status: z.union([z.string(), z.boolean()]).optional().default('SUCCESS').transform(val => {
    if (!val) return 'SUCCESS';
    const str = String(val).toUpperCase();
    if (str.includes('FAIL') || str.includes('ERROR') || str.includes('REJECT') || val === false) return 'FAILED';
    return 'SUCCESS';
  }),
  summary: z.string().optional().default('Subtarea completada exitosamente.'),
  reason: z.string().optional().default(''),
  task_id: z.string().optional()
});

module.exports = {
  executeCommandSchema,
  readFilesSchema,
  searchCodeSchema,
  writeFileSchema,
  taskPlanSchema,
  taskCompleteSchema
};