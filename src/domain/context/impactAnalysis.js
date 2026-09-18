const path = require('path');
const RepositoryIntelligence = require('./repositoryIntel');

/**
 * ImpactAnalysis
 * Analiza determinísticamente qué archivos y pruebas colindantes
 * podrían verse afectados al modificar un archivo objetivo.
 */
class ImpactAnalysis {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.intel = new RepositoryIntelligence(projectRoot);
  }

  /**
   * Ejecuta el análisis predictivo de impacto.
   * @param {string} targetFile - Ruta o nombre del archivo objetivo.
   */
  analyze(targetFile) {
    const ext = path.extname(targetFile);
    const baseName = path.basename(targetFile, ext);

    // Consulta de importaciones en milisegundos
    const importersResult = this.intel.whoImports(baseName);
    
    const affectedModules = [];
    const associatedTests = [];

    for (const consumer of importersResult.importers) {
      const lowerConsumer = consumer.toLowerCase();
      if (lowerConsumer.includes('test') || lowerConsumer.includes('spec')) {
        associatedTests.push(consumer);
      } else {
        affectedModules.push(consumer);
      }
    }

    const allImpacted = Array.from(new Set([...affectedModules, ...associatedTests]));

    return {
      targetFile,
      totalImpacted: allImpacted.length,
      affectedModules,
      associatedTests,
      recommendedReviewFiles: allImpacted,
      noticeForLLM: this.buildPromptNotice(targetFile, affectedModules, associatedTests)
    };
  }

  /**
   * Construye el aviso con énfasis de validación para la IA.
   */
  buildPromptNotice(targetFile, affectedModules, associatedTests) {
    if (affectedModules.length === 0 && associatedTests.length === 0) {
      return null;
    }

    let notice = `[SISTEMA: ANÁLISIS PREDICTIVO DE IMPACTO DETERMINÍSTICO]\n`;
    notice += `Atención: El archivo objetivo "${targetFile}" es consumido por los siguientes archivos de tu proyecto:\n`;
    
    if (affectedModules.length > 0) {
      notice += `- Módulos/Controladores dependientes: ${affectedModules.join(', ')}\n`;
    }
    if (associatedTests.length > 0) {
      notice += `- Archivos de pruebas asociados: ${associatedTests.join(', ')}\n`;
    }

    notice += `\nINSTRUCCIÓN OBLIGATORIA PARA LA IA:\n`;
    notice += `Este listado fue generado mediante análisis estático de dependencias. DEBES VALIDAR si tus modificaciones en "${targetFile}" alteran firmas de métodos, interfaces o contratos, y de ser así, incluir la actualización en cascada de estos archivos afectados dentro de tu plan de trabajo.`;

    return notice;
  }
}

module.exports = ImpactAnalysis;