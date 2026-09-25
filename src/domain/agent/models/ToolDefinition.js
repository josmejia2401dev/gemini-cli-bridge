/**
 * @class ToolDefinition
 */
class ToolDefinition {
    /**
     * @param {Object} params
     * @param {string} params.name
     * @param {string} params.description
     * @param {'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'} params.riskLevel
    * @param {import('zod').ZodType} params.schema
     * @param {(args: Object) => Promise<Object>} params.execute
     */
    constructor({
        name = '',
        description = '',
        riskLevel = 'LOW',
        schema = {},
        execute = null
    } = {}) {
        this.name = name;
        this.description = description;
        this.riskLevel = riskLevel;
        this.schema = schema;
        this.execute = execute;
    }
}

module.exports = ToolDefinition;