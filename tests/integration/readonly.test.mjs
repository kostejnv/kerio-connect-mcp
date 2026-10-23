/**
 * Optional read-only check against a real Kerio Connect mailbox. Never sends e-mail.
 *
 *   KERIO_SERVER=mail.example.com KERIO_USERNAME=... KERIO_PASSWORD=... npm run test:integration
 *
 * Optional: KERIO_CA_FILE for a company CA.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, test } from 'node:test';

import { KerioClient } from '../../dist/client.js';
import { createKerioDispatcher, normalizeServerUrl } from '../../dist/network.js';
import { connectMcp, textOf } from '../helpers/clients.mjs';

const enabled = process.env.KERIO_INTEGRATION === '1' && process.env.KERIO_SERVER;

describe('real Kerio mailbox (read-only)', { skip: !enabled && 'set KERIO_INTEGRATION=1 and KERIO_* credentials' }, () => {
  let client;
  let mcp;
  let inbox;

  before(async () => {
    const network = {
      extraCaPem: process.env.KERIO_CA_FILE ? readFileSync(process.env.KERIO_CA_FILE, 'utf8') : undefined,
      allowedServers: [],
      allowPrivateNetwork: false,
      requestTimeoutMs: 30_000,
    };
    client = new KerioClient({
      credentials: {
        server: normalizeServerUrl(process.env.KERIO_SERVER),
        username: process.env.KERIO_USERNAME,
        password: process.env.KERIO_PASSWORD,
      },
      network,
      dispatcher: createKerioDispatcher(network),
      sendEnabled: false,
    });
    mcp = await connectMcp(client);
    const folders = await client.getMailFolders();
    inbox = folders.find((folder) => /^(inbox|doručená pošta)$/i.test(folder.name)) ?? folders[0];
  });

  test('lists folders and offers no send tool', async () => {
    const { tools } = await mcp.listTools();
    assert.ok(!tools.some((tool) => tool.name === 'mail_send'));
    assert.match(textOf(await mcp.callTool({ name: 'mail_folders_list', arguments: {} })), /mail folder\(s\)/);
  });

  test('reads the oldest inbox message by ID without changing its seen state', async () => {
    const { totalItems } = await client.getMails([inbox.id], { start: 0, limit: 1 });
    assert.ok(totalItems > 0, 'inbox is empty');
    const pick = async () => (await client.getMails([inbox.id], { start: totalItems - 1, limit: 1 })).list[0];

    const before = await pick();
    const text = textOf(await mcp.callTool({ name: 'mail_get', arguments: { id: before.id } }));
    assert.match(text, /COMPLETE|PARTIAL/);
    const after = await pick();

    assert.equal(after.id, before.id);
    assert.equal(after.isSeen, before.isSeen, 'reading must not change the seen state');
    assert.equal(after.isFlagged, before.isFlagged);
    assert.equal(after.folderId, before.folderId);
    console.log(`Oldest inbox message (${totalItems} total) read; seen=${after.isSeen}; date format: ${before.receiveDate}`);
  });

  test('server-side full-text search and pagination report totals', async () => {
    const text = textOf(await mcp.callTool({ name: 'mail_search', arguments: { limit: 5 } }));
    assert.match(text, /Showing results 1-\d+ of \d+ matching messages/);
  });
});
