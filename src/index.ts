#!/usr/bin/env node

/**
 * Kerio Connect MCP Server — read (and optionally send) Kerio Connect mail via MCP.
 *
 * MCP_TRANSPORT=stdio (default): local use with one mailbox from KERIO_SERVER/KERIO_USERNAME/KERIO_PASSWORD.
 * MCP_TRANSPORT=http:            remote MCP endpoint; users sign in with their own Kerio account via OAuth.
 */

// Local development convenience; quiet so nothing is written to stdout (the stdio MCP channel).
import { config as loadDotenv } from 'dotenv';
loadDotenv({ quiet: true });

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { KerioClient } from './client.js';
import { loadConfig, type HttpConfig, type StdioConfig } from './config.js';
import { createHttpApp } from './http-server.js';
import { createMcpServer } from './mcp-server.js';
import { createKerioDispatcher, normalizeServerUrl } from './network.js';

async function runStdio(config: StdioConfig): Promise<void> {
  const client = new KerioClient({
    credentials: { ...config.credentials, server: normalizeServerUrl(config.credentials.server) },
    network: config.network,
    dispatcher: createKerioDispatcher(config.network),
    sendEnabled: config.sendEnabled,
  });

  console.error(`[Server] Connecting to ${config.credentials.server} as ${config.credentials.username}...`);
  await client.ensureAuthenticated();
  console.error(`[Server] Authenticated. Sending e-mail is ${config.sendEnabled ? 'ENABLED' : 'disabled'}.`);

  await createMcpServer(client).connect(new StdioServerTransport());
  console.error('[Server] Kerio MCP server running on stdio');
}

function runHttp(config: HttpConfig): void {
  const app = createHttpApp(config, createKerioDispatcher(config.network));
  app.listen(config.port, () => {
    console.error(`[Server] Kerio MCP server listening on port ${config.port}, public URL ${new URL('/mcp', config.publicUrl).href}`);
    console.error(`[Server] Sending e-mail can be enabled per connection: ${config.allowSend ? 'yes' : 'no'}`);
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.transport === 'http') {
    runHttp(config);
  } else {
    await runStdio(config);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => process.exit(0));
}

main().catch((error) => {
  console.error('[Server] Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
