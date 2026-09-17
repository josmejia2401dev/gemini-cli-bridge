const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

/**
 * Cliente conector para servidores externos que implementen el protocolo MCP (Model Context Protocol).
 */
class MCPClientManager {
  constructor() {
    this.clients = new Map();
  }

  async connectServer(serverName, command, args = []) {
    const transport = new StdioClientTransport({
      command,
      args
    });

    const client = new Client(
      { name: 'GeminiCliAgent', version: '2.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);
    this.clients.set(serverName, client);
    console.log(`  [MCP] Conectado exitosamente al servidor '${serverName}'.`);
  }

  async listTools(serverName) {
    const client = this.clients.get(serverName);
    if (!client) throw new Error(`Servidor MCP '${serverName}' no conectado.`);
    return await client.listTools();
  }

  async callTool(serverName, toolName, args) {
    const client = this.clients.get(serverName);
    if (!client) throw new Error(`Servidor MCP '${serverName}' no conectado.`);
    return await client.callTool({ name: toolName, arguments: args });
  }
}

module.exports = MCPClientManager;