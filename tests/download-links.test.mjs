import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { connectMcp, makeClient, textOf } from './helpers/clients.mjs';
import { mcpClient, signIn, startApp } from './helpers/http.mjs';
import { INBOX, attachmentFixture, makeMails, startMockKerio } from './helpers/mock-kerio.mjs';

const path = (name) => `/webmail/api/download/attachment/abc/14/0-1-0-${encodeURIComponent(name)}`;
const files = {
  'Faktura č. 118.pdf': attachmentFixture('sample.pdf'),
  'objednávka.xlsx': attachmentFixture('sample.xlsx'),
  'logo.png': attachmentFixture('sample.png'),
};
const mailId = 'keriostorage://mail/example.com/jan/inbox/7';

describe('mail_attachment_link and /download', () => {
  let mock;
  let app;
  let mcp;

  before(async () => {
    const [mail] = makeMails(1, () => ({
      id: mailId,
      folderId: INBOX,
      subject: 'Faktura a objednávka',
      hasAttachment: true,
      attachments: [
        { name: 'Faktura č. 118.pdf', contentType: 'application/pdf', size: files['Faktura č. 118.pdf'].length, url: path('Faktura č. 118.pdf') },
        { name: 'objednávka.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: files['objednávka.xlsx'].length, url: path('objednávka.xlsx') },
        { name: 'logo.png', contentType: 'image/png', contentId: 'logo@sig', size: files['logo.png'].length, url: path('logo.png') },
      ],
    }));
    mock = await startMockKerio({
      mails: [mail],
      files: Object.fromEntries(Object.entries(files).map(([name, data]) => [decodeURI(path(name)), data])),
    });
    app = await startApp();
    const { tokens } = await signIn(app, mock);
    mcp = await mcpClient(app, tokens.access_token);
  });
  after(async () => {
    await mcp.close();
    await app.close();
    await mock.close();
  });
  beforeEach(() => {
    mock.state.calls.length = 0;
  });

  const linksFor = async (args) => {
    const result = await mcp.callTool({ name: 'mail_attachment_link', arguments: { id: mailId, ...args } });
    return { text: textOf(result), links: result.content.filter((part) => part.type === 'resource_link'), result };
  };

  test('is offered on the remote endpoint, read-only', async () => {
    const tool = (await mcp.listTools()).tools.find((item) => item.name === 'mail_attachment_link');
    assert.ok(tool);
    assert.equal(tool.annotations.readOnlyHint, true);
  });

  test('is not offered without a public download endpoint (stdio)', async () => {
    const local = await connectMcp(makeClient(mock));
    assert.ok(!(await local.listTools()).tools.some((item) => item.name === 'mail_attachment_link'));
  });

  test('returns one link per attachment plus a ZIP, and skips signature images', async () => {
    const { text, links } = await linksFor({});
    assert.deepEqual(links.map((link) => link.name), ['Faktura č. 118.pdf', 'objednávka.xlsx', 'Faktura a objednávka.zip']);
    assert.match(text, /Skipped inline images.*\[3\] logo\.png/);
    assert.match(text, /Links work for 10 minutes/);
    assert.ok(links.every((link) => link.uri.startsWith(`${app.baseUrl}/download/v1.`)));
    assert.ok(!text.includes(mock.password), 'the password must not be readable in the link');
  });

  test('a link downloads the original file with its name', async () => {
    const { links } = await linksFor({ attachments: [1] });
    const response = await fetch(links[0].uri);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.match(response.headers.get('content-disposition'), /^attachment; filename="Faktura c\. 118\.pdf"; filename\*=UTF-8''Faktura%20%C4%8D\.%20118\.pdf$/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy'), /sandbox/);
    assert.equal(Buffer.from(await response.arrayBuffer()).compare(files['Faktura č. 118.pdf']), 0);
  });

  test('the ZIP link contains every selected file, byte for byte', async () => {
    const { links } = await linksFor({});
    const zip = Buffer.from(await (await fetch(links.at(-1).uri)).arrayBuffer());
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    for (const name of ['Faktura č. 118.pdf', 'objednávka.xlsx']) {
      const at = zip.indexOf(Buffer.from(name, 'utf8'));
      assert.ok(at > 0, `${name} is in the archive`);
      const size = zip.readUInt32LE(at - 30 + 18);
      assert.equal(zip.subarray(at + Buffer.byteLength(name), at + Buffer.byteLength(name) + size).compare(files[name]), 0);
    }
  });

  test('signature images can still be requested by number', async () => {
    const { links } = await linksFor({ attachments: [3] });
    assert.deepEqual(links.map((link) => link.name), ['logo.png']);
  });

  test('tampered or foreign links are refused without contacting Kerio', async () => {
    const { links } = await linksFor({ attachments: [1] });
    const tampered = links[0].uri.replace(/v1\.(.)/, (_, c) => `v1.${c === 'A' ? 'B' : 'A'}`);
    assert.equal((await fetch(tampered)).status, 404);
    assert.equal((await fetch(`${app.baseUrl}/download/not-a-ticket/x.pdf`)).status, 404);
    assert.equal(mock.callsOf('GET attachment').length, 0);
  });

  test('an access token is not accepted as a download link', async () => {
    const { tokens } = await signIn(app, mock);
    assert.equal((await fetch(`${app.baseUrl}/download/${tokens.access_token}/x.pdf`)).status, 404);
  });

  test('downloading changes nothing in the mailbox', async () => {
    const { links } = await linksFor({});
    for (const link of links) await (await fetch(link.uri)).arrayBuffer();
    assert.deepEqual(mock.nonReadCalls(), []);
  });

  test('reports unknown attachment numbers', async () => {
    const { result } = await linksFor({ attachments: [9] });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /there is no attachment 9/);
  });
});
