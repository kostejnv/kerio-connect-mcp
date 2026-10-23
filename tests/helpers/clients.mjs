import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { KerioClient } from '../../dist/client.js';
import { createMcpServer } from '../../dist/mcp-server.js';
import { createKerioDispatcher } from '../../dist/network.js';
import { TEST_CA } from './mock-kerio.mjs';

export function testNetwork(overrides = {}) {
  return { extraCaPem: TEST_CA, allowedServers: [], allowPrivateNetwork: true, requestTimeoutMs: 2000, ...overrides };
}

export function makeClient(mock, { sendEnabled = false, network = {}, server = mock.url, password = mock.password } = {}) {
  const config = testNetwork(network);
  return new KerioClient({
    credentials: { server, username: mock.username, password },
    network: config,
    dispatcher: createKerioDispatcher(config),
    sendEnabled,
  });
}

/** An MCP client connected in memory to the MCP server for the given Kerio client. */
export async function connectMcp(kerioClient) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createMcpServer(kerioClient).connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

export const textOf = (result) => result.content.map((part) => part.text).join('\n');
