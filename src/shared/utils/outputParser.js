const vm = require('vm');
const { z } = require('zod');

const baseToolCallSchema = z.object({
  tool: z.string().min(1, 'La propiedad "tool" es obligatoria y no puede estar vacía.'),
  arguments: z.record(z.any()).optional().default({})
});

class OutputParser {
  static parseToolCall(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return { success: false, error: 'El texto de entrada está vacío o no es una cadena válida.' };
    }

    try {
      let text = rawText.trim();

      // 🛠️ FIX: Extraer el contenido de adentro del bloque Markdown antes de analizar
      const codeBlockMatch = text.match(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        text = codeBlockMatch[1].trim();
      } else {
        text = text.replace(/^```[a-zA-Z0-9_-]*\r?\n?/g, '').replace(/\r?\n?```$/g, '').trim();
      }

      // 1. EXTRAER TODOS LOS OBJETOS CANDIDATOS EQUILIBRADOS { ... }
      const candidates = OutputParser.extractObjectCandidates(text);

      for (let candidate of candidates) {
        let parsedObject = null;

        try {
          const cleanJson = candidate.replace(/```[a-zA-Z0-9_-]*/g, '').trim();
          parsedObject = JSON.parse(cleanJson);
        } catch (e) {}

        if (!parsedObject) {
          try {
            parsedObject = vm.runInNewContext(`(${candidate.trim()})`);
          } catch (e) {}
        }

        if (!parsedObject && candidate.includes('write_file')) {
          parsedObject = OutputParser.parseWriteFileFallback(candidate);
        }

        if (!parsedObject && candidate.includes('task_complete')) {
          parsedObject = OutputParser.parseTaskCompleteFallback(candidate);
        }

        if (parsedObject && typeof parsedObject === 'object' && parsedObject.tool) {
          if (parsedObject.arguments && typeof parsedObject.arguments === 'object') {
            if (!parsedObject.arguments.filePath && parsedObject.arguments.path) {
              parsedObject.arguments.filePath = parsedObject.arguments.path;
            }

            if (parsedObject.tool === 'write_file' && typeof parsedObject.arguments.content === 'string') {
              parsedObject.arguments.content = parsedObject.arguments.content
                .replace(/^```[a-zA-Z0-9_-]*\r?\n?/g, '')
                .replace(/\r?\n?```$/g, '')
                .trim();
            }
          }

          const validation = baseToolCallSchema.safeParse(parsedObject);
          if (validation.success) {
            return { success: true, data: validation.data };
          }
        }
      }

      // Fallbacks globales
      const taskCompleteFallback = OutputParser.parseTaskCompleteFallback(text);
      if (taskCompleteFallback) return { success: true, data: taskCompleteFallback };

      const writeFileFallback = OutputParser.parseWriteFileFallback(text);
      if (writeFileFallback) return { success: true, data: writeFileFallback };

      return { success: false, error: 'Ningún candidato JSON en la respuesta contenía un Tool Call válido.' };

    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  static parseTaskCompleteFallback(text) {
    if (!/task_complete/i.test(text)) return null;
    const statusMatch = text.match(/status\s*:\s*["'`\s]*([a-zA-Z0-9_\-]+)/i);
    const status = statusMatch ? statusMatch[1].toUpperCase() : 'SUCCESS';
    const summaryMatch = text.match(/summary\s*:\s*[`"']?([\s\S]*?)(?=\n\s*\}|\n\s*arguments|\}$|$)/i);
    let summary = summaryMatch ? summaryMatch[1].trim() : 'Subtarea completada.';
    summary = summary.replace(/^[`"'\s]+|[`"'\s,]+$/g, '').trim();
    return { tool: 'task_complete', arguments: { status, summary } };
  }

  static parseWriteFileFallback(text) {
    if (!/write_file/i.test(text)) return null;
    const pathMatch = text.match(/(?:filePath|path)\s*:\s*["'`\s]*([^"'`\s,\}\n]+)/i);
    const filePath = pathMatch ? pathMatch[1].trim() : null;
    if (!filePath) return null;
    const contentMatch = text.match(/content\s*:\s*[`"']([\s\S]*?)[`"'](?=\s*[\},])/i) || text.match(/content\s*:\s*[`"']([\s\S]*)$/i);
    if (contentMatch) {
      let rawContent = contentMatch[1].replace(/^```[a-zA-Z0-9_-]*\r?\n?/g, '').replace(/\r?\n?```$/g, '').trim();
      return { tool: 'write_file', arguments: { filePath, content: rawContent } };
    }
    return null;
  }

  static extractObjectCandidates(text) {
    const candidates = [];
    let braceCount = 0;
    let startIndex = -1;
    let inString = false;
    let stringChar = '';
    let isEscaped = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (inString) {
        if (isEscaped) {
          isEscaped = false;
        } else if (char === '\\') {
          isEscaped = true;
        } else if (char === stringChar) {
          if (stringChar === '`') {
            const rest = text.slice(i + 1);
            if (/^\s*[\},]/.test(rest)) {
              inString = false;
            }
          } else {
            inString = false;
          }
        }
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        inString = true;
        stringChar = char;
        continue;
      }
      if (char === '{') {
        if (braceCount === 0) startIndex = i;
        braceCount++;
      } else if (char === '}') {
        if (braceCount > 0) {
          braceCount--;
          if (braceCount === 0 && startIndex !== -1) {
            candidates.push(text.substring(startIndex, i + 1));
            startIndex = -1;
          }
        }
      }
    }
    return candidates;
  }
}

module.exports = OutputParser;