/**
 * MCP server bound to one Kerio mailbox connection.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { KerioClient } from './client.js';
import {
  getMailToolDefinitions,
  mailAttachmentLink,
  mailCreateDraft,
  mailFoldersList,
  mailGet,
  mailGetAttachment,
  mailSearch,
  mailUpdateDraft,
  type DownloadLinkIssuer,
  type ToolResult,
} from './mail-tools.js';
import { normalizeToolArguments } from './tool-arguments.js';
import { PACKAGE_VERSION } from './version.js';

export interface McpServerOptions {
  /** Remote mode only: issues download links for mail_attachment_link. */
  issueDownloadLink?: DownloadLinkIssuer;
}

async function callTool(client: KerioClient, name: string, args: Record<string, unknown>, options: McpServerOptions): Promise<ToolResult> {
  switch (name) {
    case 'mail_folders_list':
      return mailFoldersList(client);
    case 'mail_search':
      return mailSearch(client, args);
    case 'mail_get':
      return mailGet(client, args);
    case 'mail_get_attachment':
      return mailGetAttachment(client, args);
    case 'mail_attachment_link':
      if (!options.issueDownloadLink) return { text: `ERROR: Unknown tool: ${name}`, isError: true };
      return mailAttachmentLink(client, args, options.issueDownloadLink);
    case 'mail_create_draft':
      return mailCreateDraft(client, args);
    case 'mail_update_draft':
      return mailUpdateDraft(client, args);
    default:
      return { text: `ERROR: Unknown tool: ${name}`, isError: true };
  }
}

export function createMcpServer(client: KerioClient, options: McpServerOptions = {}): Server {
  const toolDefinitions = getMailToolDefinitions({ downloadLinks: Boolean(options.issueDownloadLink) });
  const server = new Server(
    { name: 'kerio-connect-mcp', version: PACKAGE_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const definition = toolDefinitions.find((tool) => tool.name === request.params.name);
    const args = normalizeToolArguments(request.params.arguments ?? {}, definition?.inputSchema);

    try {
      const result = await callTool(client, request.params.name, args, options);
      const images = (result.images ?? []).map((image) => ({ type: 'image' as const, ...image }));
      const links = (result.links ?? []).map((link) => ({ type: 'resource_link' as const, ...link }));
      return { content: [{ type: 'text' as const, text: result.text }, ...images, ...links], isError: result.isError ?? false };
    } catch (error) {
      const message = error instanceof z.ZodError
        ? `Invalid arguments:\n${z.prettifyError(error)}`
        : error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `ERROR: ${message}` }], isError: true };
    }
  });

  return server;
}
