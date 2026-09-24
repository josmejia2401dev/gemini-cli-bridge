const FileSystemUtils = require('../../shared/utils/fileSystemUtils');
const RepositoryIntelligence = require('./repositoryIntel');
const SYSTEM_PROMPTS = require('../../shared/config/prompts');

class ImpactAnalysis {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.intel = new RepositoryIntelligence(projectRoot);
  }

  analyze(targetFile) {
    const baseName = FileSystemUtils.getFileNameWithoutExt(targetFile);

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

  buildPromptNotice(targetFile, affectedModules, associatedTests) {
    if (affectedModules.length === 0 && associatedTests.length === 0) {
      return null;
    }
    return SYSTEM_PROMPTS.IMPACT_NOTICE(targetFile, affectedModules, associatedTests);
  }
}

module.exports = ImpactAnalysis;