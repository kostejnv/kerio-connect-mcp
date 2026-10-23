import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { connectMcp, makeClient, textOf } from './helpers/clients.mjs';
import { INBOX, attachmentFixture, makeMails, startMockKerio } from './helpers/mock-kerio.mjs';

const path = (name) => `/webmail/api/download/attachment/abc/14/0-1-0-${name}`;
const attachment = (name, contentType, data, extra = {}) => ({ name, contentType, size: data.length, url: path(name), ...extra });

const files = {
  'invoice.pdf': attachmentFixture('sample.pdf'),
  'minutes.docx': attachmentFixture('sample.docx'),
  'order.xlsx': attachmentFixture('sample.xlsx'),
  'logo.png': attachmentFixture('sample.png'),
  'notes.txt': Buffer.from('Poznámka: dodat do pátku', 'utf8'),
  'archive.zip': Buffer.from('PK...'),
  'long.txt': Buffer.from('Řádek dlouhé přílohy.\n'.repeat(3000), 'utf8'),
};

describe('mail_get_attachment', () => {
  let mock;
  let mcp;
  const mailId = 'keriostorage://mail/example.com/jan/inbox/1';

  before(async () => {
    const [mail] = makeMails(1, () => ({
      id: mailId,
      folderId: INBOX,
      hasAttachment: true,
      attachments: [
        attachment('invoice.pdf', 'application/pdf', files['invoice.pdf']),
        attachment('minutes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', files['minutes.docx']),
        attachment('order.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', files['order.xlsx']),
        attachment('logo.png', 'image/png', files['logo.png'], { contentId: 'logo@1' }),
        attachment('notes.txt', 'text/plain; charset=utf-8', files['notes.txt']),
        attachment('archive.zip', 'application/zip', files['archive.zip']),
        { name: 'huge.pdf', contentType: 'application/pdf', size: 30 * 1024 * 1024, url: path('huge.pdf') },
        { name: 'elsewhere.pdf', contentType: 'application/pdf', size: 10, url: 'https://attacker.example/file.pdf' },
        { name: 'admin.pdf', contentType: 'application/pdf', size: 10, url: '/admin/api/jsonrpc' },
        attachment('long.txt', 'text/plain', files['long.txt']),
      ],
    }));
    mock = await startMockKerio({
      mails: [mail],
      files: Object.fromEntries(Object.entries(files).map(([name, data]) => [path(name), data])),
    });
    mcp = await connectMcp(makeClient(mock));
  });
  after(() => mock.close());
  beforeEach(() => {
    mock.state.calls.length = 0;
  });

  const get = (number, extra = {}) => mcp.callTool({ name: 'mail_get_attachment', arguments: { id: mailId, attachment: number, ...extra } });

  test('mail_get lists numbered attachments', async () => {
    const text = textOf(await mcp.callTool({ name: 'mail_get', arguments: { id: mailId } }));
    assert.match(text, /\[1\] invoice\.pdf \(application\/pdf/);
    assert.match(text, /\[6\] archive\.zip/);
  });

  test('extracts PDF text page by page', async () => {
    const text = textOf(await get(1));
    assert.match(text, /Extracted text: \d+ characters\. COMPLETE\./);
    assert.match(text, /--- Page 1 of 2 ---\nInvoice 2026-118 total 1234 CZK/);
    assert.match(text, /Payment due 2026-11-30/);
    assert.match(text, /<<<BEGIN UNTRUSTED EMAIL CONTENT>>>/);
  });

  test('extracts Word and Excel content, including Czech text', async () => {
    assert.match(textOf(await get(2)), /Zápis z porady\n\nTermín dodání: 30\. 11\. 2026/);
    const sheet = textOf(await get(3));
    assert.match(sheet, /--- Sheet: Objednávka ---\nPoložka,Množství\nGranule,120/);
    assert.match(sheet, /--- Sheet: Souhrn ---\nCelkem,165/);
  });

  test('returns images as image content', async () => {
    const result = await get(4);
    const image = result.content.find((part) => part.type === 'image');
    assert.equal(image.mimeType, 'image/png');
    assert.equal(Buffer.from(image.data, 'base64').compare(files['logo.png']), 0);
  });

  test('decodes text attachments with their charset', async () => {
    assert.match(textOf(await get(5)), /Poznámka: dodat do pátku/);
  });

  test('long extracted text comes in parts with continuation until complete', async () => {
    const expected = files['long.txt'].toString('utf8');
    let offset = 0;
    let collected = '';
    for (let round = 0; round < 10; round++) {
      const text = textOf(await get(10, { offset, maxChars: 30000 }));
      collected += text.split('<<<BEGIN UNTRUSTED EMAIL CONTENT>>>\n')[1].split('\n<<<END UNTRUSTED EMAIL CONTENT>>>')[0];
      const next = text.match(/nextOffset: (\d+)/);
      if (!next) {
        assert.match(text, /final part/);
        break;
      }
      offset = Number(next[1]);
    }
    assert.equal(collected, expected);
  });

  test('unsupported formats are described, not downloaded', async () => {
    const text = textOf(await get(6));
    assert.match(text, /cannot be read\. Readable formats: PDF/);
    assert.equal(mock.callsOf('GET attachment').length, 0);
  });

  test('refuses oversized attachments before downloading', async () => {
    const result = await get(7);
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Too large/);
    assert.equal(mock.callsOf('GET attachment').length, 0);
  });

  test('only downloads attachment URLs of the connected Kerio server', async () => {
    for (const number of [8, 9]) {
      const result = await get(number);
      assert.equal(result.isError, true);
      assert.match(textOf(result), /not an attachment download of the connected Kerio server/);
    }
    assert.equal(mock.callsOf('GET attachment').length, 0);
  });

  test('reports a missing attachment number', async () => {
    const result = await get(42);
    assert.equal(result.isError, true);
    assert.match(textOf(result), /has 10 attachment\(s\); there is no attachment 42/);
  });

  test('keeps working after the Kerio session expired', async () => {
    await get(5);
    mock.expireSessions();
    assert.match(textOf(await get(5)), /Poznámka/);
  });

  test('reading attachments changes nothing in the mailbox', async () => {
    for (const number of [1, 2, 3, 4, 5]) await get(number);
    assert.deepEqual(mock.nonReadCalls(), []);
    assert.equal(mock.state.mails[0].isSeen, true);
  });
});
