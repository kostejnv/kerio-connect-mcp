import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { KerioPolicyError } from '../dist/client.js';
import { connectMcp, makeClient, textOf } from './helpers/clients.mjs';
import { startMockKerio } from './helpers/mock-kerio.mjs';

const message = { to: ['recipient@example.org'], cc: ['cc@example.org'], bcc: ['bcc@example.org'], subject: 'Hello', body: 'Plain text body' };

describe('sending disabled (default)', () => {
  let mock;
  let client;
  let mcp;
  before(async () => {
    mock = await startMockKerio();
    client = makeClient(mock);
    mcp = await connectMcp(client);
  });
  after(() => mock.close());

  test('mail_send is not offered', async () => {
    const { tools } = await mcp.listTools();
    assert.ok(!tools.some((tool) => tool.name === 'mail_send'));
  });

  test('a direct mail_send call is refused before any request to Kerio', async () => {
    const result = await mcp.callTool({ name: 'mail_send', arguments: message });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /disabled.*Nothing was sent/);
    assert.deepEqual(mock.state.calls, []);
  });

  test('the client layer refuses sending and Mails.create on its own', async () => {
    await assert.rejects(client.sendMail(message), KerioPolicyError);
    await assert.rejects(client.post('Mails.create', { mails: [{ send: true, to: [] }] }, null), KerioPolicyError);
    assert.deepEqual(mock.state.calls, []);
  });

  test('nothing in the mailbox changed: no drafts, no sent mail, no write calls', () => {
    assert.equal(mock.state.sent.length, 0);
    assert.deepEqual(mock.nonReadCalls(), []);
  });
});

describe('sending enabled explicitly', () => {
  let mock;
  let client;
  let mcp;
  before(async () => {
    mock = await startMockKerio();
    client = makeClient(mock, { sendEnabled: true, network: { requestTimeoutMs: 400 } });
    mcp = await connectMcp(client);
  });
  after(() => mock.close());
  beforeEach(() => {
    mock.state.calls.length = 0;
    mock.state.sent.length = 0;
    mock.state.sendBehavior = 'ok';
  });

  const send = async () => {
    const result = await mcp.callTool({ name: 'mail_send', arguments: message });
    return { text: textOf(result), isError: result.isError, creates: mock.callsOf('Mails.create').length };
  };

  test('mail_send is offered and marked destructive', async () => {
    const { tools } = await mcp.listTools();
    const tool = tools.find((item) => item.name === 'mail_send');
    assert.ok(tool);
    assert.equal(tool.annotations.readOnlyHint, false);
    assert.equal(tool.annotations.destructiveHint, true);
    assert.equal(tool.annotations.idempotentHint, false);
  });

  test('sends one plain-text message with to, cc and bcc', async () => {
    const { text, isError, creates } = await send();
    assert.equal(isError, false);
    assert.match(text, /^SENT\./);
    assert.equal(creates, 1);

    const sent = mock.state.sent[0];
    assert.equal(sent.send, true);
    assert.deepEqual(sent.to.map((a) => a.address), message.to);
    assert.deepEqual(sent.cc.map((a) => a.address), message.cc);
    assert.deepEqual(sent.bcc.map((a) => a.address), message.bcc);
    assert.deepEqual(sent.displayableParts, [{ contentType: 'ctTextPlain', content: message.body }]);
    assert.deepEqual(sent.from, { address: 'jan@example.com', name: '' });
  });

  test('partial success is reported as sent, with a warning not to resend', async () => {
    mock.state.sendBehavior = 'partial';
    const { text, isError, creates } = await send();
    assert.equal(isError, false);
    assert.match(text, /SENT WITH WARNINGS.*Sent Items.*Do NOT send it again/s);
    assert.equal(creates, 1);
  });

  test('a reported sending failure is not retried', async () => {
    mock.state.sendBehavior = 'fail';
    const { text, isError, creates } = await send();
    assert.equal(isError, true);
    assert.match(text, /NOT SENT.*Sending failed.*Do not retry automatically/s);
    assert.equal(creates, 1);
  });

  test('a timeout gives an UNKNOWN result and is never retried', async () => {
    mock.state.sendBehavior = 'hang';
    const { text, isError, creates } = await send();
    assert.equal(isError, true);
    assert.match(text, /RESULT UNKNOWN.*MAY have been sent.*Do NOT send it again/s);
    assert.equal(creates, 1);
  });

  test('a dropped connection gives an UNKNOWN result and is never retried', async () => {
    mock.state.sendBehavior = 'drop';
    const { text, creates } = await send();
    assert.match(text, /RESULT UNKNOWN/);
    assert.equal(creates, 1);
  });

  test('an expired session is renewed by a read before sending, so the message is sent once', async () => {
    await client.getMailFolders();
    mock.expireSessions();
    mock.state.calls.length = 0;

    const { text, creates } = await send();
    assert.match(text, /^SENT\./);
    assert.equal(creates, 1);
    assert.deepEqual(mock.state.calls.map((call) => call.method), ['Folders.get', 'Session.login', 'Folders.get', 'Mails.create']);
  });

  test('a session rejected at send time is reported as not sent and not retried', async () => {
    mock.state.sendBehavior = 'session-expired';
    const { text, creates } = await send();
    assert.match(text, /NOT SENT/);
    assert.equal(creates, 1);
  });

  test('Mails.create cannot be used for drafts or templates even when sending is enabled', async () => {
    await client.ensureAuthenticated();
    await assert.rejects(client.post('Mails.create', { mails: [{ send: false, to: [] }] }, null), KerioPolicyError);
    await assert.rejects(client.post('Mails.create', { mails: [{ send: true, folderId: 'x' }] }, null), KerioPolicyError);
    assert.equal(mock.callsOf('Mails.create').length, 0);
  });

  test('invalid recipients are rejected before anything is sent', async () => {
    const result = await mcp.callTool({ name: 'mail_send', arguments: { ...message, to: ['not-an-address'] } });
    assert.equal(result.isError, true);
    assert.equal(mock.callsOf('Mails.create').length, 0);
  });
});
