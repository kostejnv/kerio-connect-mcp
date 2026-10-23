/**
 * MCP server bound to one Kerio mailbox connection.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { KerioClient } from './client.js';
import {
  getMailToolDefinitions,
  mailFoldersList,
  mailGet,
  mailGetAttachment,
  mailSearch,
  mailSend,
  type ToolResult,
} from './mail-tools.js';
import { normalizeToolArguments } from './tool-arguments.js';
import { PACKAGE_VERSION } from './version.js';

async function callTool(client: KerioClient, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case 'mail_folders_list':
      return mailFoldersList(client);
    case 'mail_search':
      return mailSearch(client, args);
    case 'mail_get':
      return mailGet(client, args);
    case 'mail_get_attachment':
      return mailGetAttachment(client, args);
    case 'mail_send':
      // Not listed when sending is disabled; a direct call is refused before any request to Kerio.
      if (!client.sendEnabled) {
        return { text: 'ERROR: Sending e-mail is disabled for this connection. Nothing was sent.', isError: true };
      }
      return mailSend(client, args);
    default:
      return { text: `ERROR: Unknown tool: ${name}`, isError: true };
  }
}

export function createMcpServer(client: KerioClient): Server {
  const toolDefinitions = getMailToolDefinitions(client.sendEnabled);
  const server = new Server(
    { name: 'kerio-connect-mcp', version: PACKAGE_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const definition = toolDefinitions.find((tool) => tool.name === request.params.name);
    const args = normalizeToolArguments(request.params.arguments ?? {}, definition?.inputSchema);

    try {
      const result = await callTool(client, request.params.name, args);
      const images = (result.images ?? []).map((image) => ({ type: 'image' as const, ...image }));
      return { content: [{ type: 'text' as const, text: result.text }, ...images], isError: result.isError ?? false };
    } catch (error) {
      const message = error instanceof z.ZodError
        ? `Invalid arguments:\n${z.prettifyError(error)}`
        : error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `ERROR: ${message}` }], isError: true };
    }
  });

  return server;
}
