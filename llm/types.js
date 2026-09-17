/**
 * Contrato formal para las solicitudes al LLM.
 * @typedef {Object} LLMRequest
 * @property {string} prompt
 * @property {string|null} [fileToUpload]
 * @property {string} [systemRules]
 */

/**
 * Contrato formal para la respuesta del LLM.
 * @typedef {Object} LLMResponse
 * @property {string} text
 * @property {Array<{name: string, args: Record<string, any>}>} [toolCalls]
 */

module.exports = {};