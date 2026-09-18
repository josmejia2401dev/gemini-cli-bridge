const { z } = require('zod');

const executeCommandSchema = z.object({
  command: z.string().min(1, 'El comando no puede estar vacío.'),
  cwd: z.string().optional()
});

const writeFileSchema = z.object({
  filePath: z.string().min(1, 'La ruta del archivo es obligatoria.'),
  content: z.string()
});

const readFilesSchema = z.object({
  paths: z.array(z.string()).min(1, 'Debe especificar al menos una ruta de archivo.')
});

module.exports = {
  executeCommandSchema,
  writeFileSchema,
  readFilesSchema
};