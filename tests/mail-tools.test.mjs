import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { connectMcp, makeClient, textOf } from './helpers/clients.mjs';
import { makeMails, startMockKerio } from './helpers/mock-kerio.mjs';

const PROJECTS = 'keriostorage://folder/example.com/jan/projects';
const nextOffsetOf = (text) => Number(text.match(/nextOffset: (\d+)/)?.[1] ?? NaN);
const idsIn = (text) => [...text.matchAll(/ID: (\S+)/g)].map((match) => match[1]);

describe('mail tools', () => {
  let mock;
  let mcp;
  const longBody = 'Lorem ipsum dolor sit amet. '.repeat(3000); // 84,000 characters

  before(async () => {
    mock = await startMockKerio({
      mails: makeMails(7000, (index) => ({
        ...(index === 1500 ? { from: { name: 'Old Customer', address: 'old.customer@client.cz' } } : {}),
        ...(index === 6900 ? { from: { name: 'Ancient Customer', address: 'ancient@client.cz' }, subject: 'Contract 2007' } : {}),
        ...(index === 3 ? { isSeen: false, displayableParts: [{ contentType: 'ctTextPlain', content: longBody }] } : {}),
        ...(index === 4 ? { displayableParts: [{ contentType: 'ctTextHtml', content: '<p>Hello&nbsp;<b>world</b></p><script>x()</script>' }] } : {}),
        ...(index % 100 === 0 ? { folderId: PROJECTS } : {}),
      })),
    });
    mcp = await connectMcp(makeClient(mock));
  });
  after(() => mock.close());
  beforeEach(() => {
    mock.state.calls.length = 0;
  });

  const call = async (name, args = {}) => textOf(await mcp.callTool({ name, arguments: args }));

  test('lists mail folders with paths, without other folder types', async () => {
    const text = await call('mail_folders_list');
    assert.match(text, /- Inbox\/Projects\n/);
    assert.doesNotMatch(text, /Calendar/);
  });

  test('pages through results with exact totals and nextOffset', async () => {
    const first = await call('mail_search', { limit: 50 });
    assert.match(first, /Showing results 1-50 of 7000 matching messages/);
    assert.equal(nextOffsetOf(first), 50);

    const last = await call('mail_search', { limit: 50, offset: 6950 });
    assert.match(last, /Showing results 6951-7000 of 7000/);
    assert.match(last, /Search complete/);
    assert.ok(Number.isNaN(nextOffsetOf(last)));
  });

  test('server-side full-text query reports a complete empty result', async () => {
    const text = await call('mail_search', { query: 'does-not-exist-anywhere' });
    assert.match(text, /No matching messages\. Search complete/);
  });

  test('filters find a match far beyond the first few hundred messages', async () => {
    const text = await call('mail_search', { from: 'old.customer@client.cz' });
    assert.deepEqual(idsIn(text), [mock.state.mails[1500].id]);
    assert.match(text, /Search NOT finished|Search complete/);
  });

  test('a filtered search that runs out of budget says so and can be continued to the end', async () => {
    const first = await call('mail_search', { subject: 'Contract 2007' });
    assert.match(first, /Search NOT finished/);
    assert.match(first, /No matches in the examined messages/);
    const offset = nextOffsetOf(first);
    assert.equal(offset, 5000);

    const second = await call('mail_search', { subject: 'Contract 2007', offset });
    assert.deepEqual(idsIn(second), [mock.state.mails[6900].id]);
    assert.match(second, /Search complete/);
  });

  test('filtered search with no match anywhere is only "complete" after examining everything', async () => {
    const first = await call('mail_search', { from: 'nobody@nowhere.test' });
    assert.match(first, /Search NOT finished/);
    const second = await call('mail_search', { from: 'nobody@nowhere.test', offset: nextOffsetOf(first) });
    assert.match(second, /Examined messages 5001-7000 of 7000/);
    assert.match(second, /Search complete: no further matches exist/);
  });

  test('filtered search pages by limit and continues without gaps or duplicates', async () => {
    const seen = [];
    let offset = 0;
    for (let round = 0; round < 10; round++) {
      const text = await call('mail_search', { folder: 'Projects', subject: 'Message', limit: 25, offset });
      seen.push(...idsIn(text));
      if (/Search complete/.test(text)) break;
      offset = nextOffsetOf(text);
    }
    const expected = mock.state.mails
      .filter((mail) => mail.folderId === PROJECTS && mail.subject.includes('Message'))
      .map((mail) => mail.id);
    assert.deepEqual(seen, expected);
  });

  test('date range stops early once results are older than dateFrom', async () => {
    const text = await call('mail_search', { dateFrom: '2026-09-25', dateTo: '2026-09-28' });
    assert.equal(idsIn(text).length, 4);
    assert.match(text, /Search complete/);
    assert.equal(mock.callsOf('Mails.get').length, 1);
  });

  test('unread filter', async () => {
    const text = await call('mail_search', { unreadOnly: true, dateFrom: '2026-01-01' });
    assert.deepEqual(idsIn(text), [mock.state.mails[3].id]);
  });

  test('mail_get returns a long body completely in parts with explicit continuation', async () => {
    const id = mock.state.mails[3].id;
    let offset = 0;
    let collected = '';
    for (let round = 0; round < 10; round++) {
      const text = await call('mail_get', { id, offset, maxChars: 30000 });
      collected += text.split('<<<BEGIN UNTRUSTED EMAIL CONTENT>>>\n')[1].split('\n<<<END UNTRUSTED EMAIL CONTENT>>>')[0];
      if (!/PARTIAL/.test(text)) {
        assert.match(text, /final part/);
        break;
      }
      offset = nextOffsetOf(text);
    }
    assert.equal(collected, longBody);

    const whole = await call('mail_get', { id, maxChars: 100000 });
    assert.match(whole, /Body: 84000 characters\. COMPLETE\./);
  });

  test('mail_get reads very old messages and converts HTML to text', async () => {
    const old = await call('mail_get', { id: mock.state.mails[6999].id });
    assert.match(old, /Body of message 6999/);
    assert.match(old, /COMPLETE/);
    assert.equal(mock.callsOf('Mails.get').length, 0);

    const html = await call('mail_get', { id: mock.state.mails[4].id });
    assert.match(html, /Hello world/);
    assert.doesNotMatch(html, /<b>|x\(\)/);
  });

  test('mail_get reports a missing message as an error', async () => {
    const result = await mcp.callTool({ name: 'mail_get', arguments: { id: 'keriostorage://mail/example.com/jan/inbox/1' } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Message not found/);
  });

  test('reading never calls mutating API methods and leaves seen state unchanged', async () => {
    const unread = mock.state.mails[3];
    await call('mail_folders_list');
    await call('mail_search', { query: 'Message' });
    await call('mail_search', { unreadOnly: true, dateFrom: '2026-01-01' });
    await call('mail_get', { id: unread.id });

    assert.deepEqual(mock.nonReadCalls(), []);
    assert.equal(unread.isSeen, false);
    assert.equal(mock.state.sent.length, 0);
  });

  test('accepts stringified arguments from weaker tool-calling models', async () => {
    const text = await call('mail_search', { limit: '5', unreadOnly: 'false' });
    assert.match(text, /Showing results 1-5 of 7000/);
  });

  test('marks read tools as read-only', async () => {
    const { tools } = await mcp.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ['mail_folders_list', 'mail_search', 'mail_get']);
    for (const tool of tools) {
      assert.equal(tool.annotations.readOnlyHint, true);
      assert.equal(tool.annotations.destructiveHint, false);
    }
  });
});
