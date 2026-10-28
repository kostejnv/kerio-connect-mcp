import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { KerioPolicyError } from '../dist/client.js';
import { connectMcp, makeClient, textOf } from './helpers/clients.mjs';
import { DRAFTS, INBOX, SENT, startMockKerio } from './helpers/mock-kerio.mjs';

const owner = { name: 'Jan', address: 'jan@example.com' };
const customer = { name: 'Client', address: 'client@customer.example' };
const colleague = { name: 'Colleague', address: 'colleague@example.com' };
const boss = { name: 'Boss', address: 'boss@customer.example' };

const question = {
  id: 'mail-question',
  folderId: INBOX,
  from: customer,
  to: [owner, colleague],
  cc: [boss],
  subject: 'Question',
  receiveDate: '20261024T182500+0200',
  isSeen: true,
  displayableParts: [{ contentType: 'ctTextPlain', content: 'Can you send the <b>form</b>?' }],
  attachments: [{
    id: 'keriostorage://attachment/example.com/jan/inbox/question/0-1',
    url: '/webmail/api/download/attachment/example.com/jan/inbox/question/0-1/form.pdf',
    name: 'form.pdf',
    contentType: 'application/pdf',
    size: 1234,
  }],
  headers: [{ type: 'mhMessageID', value: '<question@customer.example>' }],
};
const ownSent = {
  id: 'mail-own-sent',
  folderId: SENT,
  from: owner,
  to: [customer],
  cc: [],
  subject: 'RE: Offer',
  receiveDate: '20261020T090000+0200',
  isSeen: true,
  displayableParts: [{ contentType: 'ctTextHtml', content: '<p>Our offer</p>' }],
  headers: [{ type: 'mhMessageID', value: '<offer@example.com>' }],
};

describe('drafts', () => {
  let mock;
  let client;
  let mcp;
  before(async () => {
    mock = await startMockKerio({ mails: [question, ownSent] });
    client = makeClient(mock, { network: { requestTimeoutMs: 400 } });
    mcp = await connectMcp(client);
  });
  after(() => mock.close());
  beforeEach(() => {
    mock.state.calls.length = 0;
    mock.state.writeBehavior = 'ok';
  });

  const call = async (name, args) => {
    const result = await mcp.callTool({ name, arguments: args });
    return { text: textOf(result), isError: result.isError ?? false };
  };
  const lastWrite = (method) => mock.callsOf(method).at(-1).params.mails[0];
  const draftById = (id) => mock.state.mails.find((mail) => mail.id === id);
  const idIn = (text) => text.match(/^ID: (.+)$/m)[1];
  const htmlOf = (mail) => mail.displayableParts[0].content;

  test('saves a new draft in Drafts with send: false and an HTML body; nothing is sent', async () => {
    const { text, isError } = await call('mail_create_draft', {
      to: ['recipient@example.org'], cc: ['cc@example.org'], bcc: ['bcc@example.org'],
      subject: 'Hello', body: 'Dobrý den,\n\nposílám **podklady**.\n\nS pozdravem\nJan',
    });
    assert.equal(isError, false);
    assert.match(text, /^Draft saved in the Drafts folder\.\nID: keriostorage:\/\/mail\//);
    assert.match(text, /NOT sent/);

    const written = lastWrite('Mails.create');
    assert.equal(written.send, false);
    assert.deepEqual(written.from, { address: 'jan@example.com', name: '' });
    assert.deepEqual(written.to, [{ address: 'recipient@example.org', name: '' }]);
    assert.deepEqual(written.cc.map((a) => a.address), ['cc@example.org']);
    assert.deepEqual(written.bcc.map((a) => a.address), ['bcc@example.org']);
    assert.equal(written.displayableParts[0].contentType, 'ctTextHtml');
    assert.equal(
      written.displayableParts[0].content,
      '<html><body><p>Dobrý den,</p><p>posílám <strong>podklady</strong>.</p><p>S pozdravem<br>Jan</p></body></html>'
    );
    assert.equal(written.headers, undefined);
    assert.equal(draftById(idIn(text)).folderId, DRAFTS);
    assert.deepEqual(mock.nonReadCalls().map((c) => c.method), ['Mails.create']);
  });

  test('a reply goes to the sender, with "RE:" subject, In-Reply-To and the quoted original', async () => {
    const { text } = await call('mail_create_draft', { replyToId: question.id, body: 'Here it is.' });
    assert.match(text, /To: Client <client@customer\.example>/);
    assert.match(text, /Subject: RE: Question/);
    assert.match(text, /Threaded with In-Reply-To/);

    const written = lastWrite('Mails.create');
    assert.deepEqual(written.to.map((a) => a.address), ['client@customer.example']);
    assert.deepEqual(written.cc, []);
    assert.deepEqual(written.headers, [{ type: 'mhInReplayTo', value: '<question@customer.example>' }]);
    const html = written.displayableParts[0].content;
    assert.match(html, /^<html><body><p>Here it is\.<\/p><div class="kerio-mcp-quote"><br>24\. 10\. 2026 18:25, Client &lt;client@customer\.example&gt;:<blockquote/);
    assert.match(html, /Can you send the &lt;b&gt;form&lt;\/b&gt;\?/, 'the quoted original is escaped text');
  });

  test('reply all copies the other recipients, but not the mailbox owner', async () => {
    await call('mail_create_draft', { replyToId: question.id, replyAll: true, body: 'Thanks.' });
    const written = lastWrite('Mails.create');
    assert.deepEqual(written.to.map((a) => a.address), ['client@customer.example']);
    assert.deepEqual(written.cc.map((a) => a.address), ['colleague@example.com', 'boss@customer.example']);
  });

  test('a reply to one\'s own sent mail goes to its recipients; given to and subject win', async () => {
    await call('mail_create_draft', { replyToId: ownSent.id, body: 'Any news?' });
    assert.deepEqual(lastWrite('Mails.create').to.map((a) => a.address), ['client@customer.example']);
    assert.equal(lastWrite('Mails.create').subject, 'RE: Offer', 'an existing RE: is not repeated');

    await call('mail_create_draft', { replyToId: ownSent.id, to: ['other@example.org'], subject: 'Follow-up', body: 'Hi.' });
    assert.deepEqual(lastWrite('Mails.create').to.map((a) => a.address), ['other@example.org']);
    assert.equal(lastWrite('Mails.create').subject, 'Follow-up');
  });

  test('attaches files from e-mails already in the mailbox by their Kerio IDs', async () => {
    const { text } = await call('mail_create_draft', {
      to: ['a@example.org'], subject: 'Form', body: 'Attached.', attachments: [{ fromMail: question.id, attachment: 1 }],
    });
    assert.match(text, /Attachments: form\.pdf/);
    assert.deepEqual(lastWrite('Mails.create').attachments, [{
      id: question.attachments[0].id, name: 'form.pdf', contentType: 'application/pdf', size: 1234,
    }]);
    assert.equal(mock.callsOf('GET attachment').length, 0, 'the file itself is not downloaded');
  });

  test('a missing attachment or recipient is reported and nothing is saved', async () => {
    const missing = await call('mail_create_draft', {
      to: ['a@example.org'], subject: 'Form', body: 'x', attachments: [{ fromMail: question.id, attachment: 2 }],
    });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /has 1 attachment\(s\); there is no attachment 2\. Nothing was saved/);

    const noRecipient = await call('mail_create_draft', { subject: 'x', body: 'x' });
    assert.equal(noRecipient.isError, true);
    assert.match(noRecipient.text, /No recipient/);

    const invalid = await call('mail_create_draft', { to: ['not-an-address'], subject: 'x', body: 'x' });
    assert.equal(invalid.isError, true);
    assert.deepEqual(mock.nonReadCalls(), []);
  });

  test('updating changes only the given fields and keeps text, quote and attachments', async () => {
    const created = await call('mail_create_draft', {
      replyToId: question.id, body: 'First version.', attachments: [{ fromMail: question.id, attachment: 1 }],
    });
    const id = idIn(created.text);
    const quote = htmlOf(draftById(id)).match(/<div class="kerio-mcp-quote">.*<\/div>/)[0];

    await call('mail_update_draft', { id, subject: 'RE: Question (form)' });
    let written = lastWrite('Mails.set');
    assert.equal(written.id, id);
    assert.equal(written.send, false);
    assert.equal(written.subject, 'RE: Question (form)');
    assert.deepEqual(written.to.map((a) => a.address), ['client@customer.example']);
    assert.equal(written.displayableParts[0].content, htmlOf(draftById(id)));
    assert.deepEqual(written.attachments.map((a) => a.name), ['form.pdf']);
    assert.deepEqual(written.headers, [{ type: 'mhInReplayTo', value: '<question@customer.example>' }]);

    const { text } = await call('mail_update_draft', { id, body: 'Second *version*.', cc: ['boss@customer.example'] });
    assert.match(text, /^Draft updated\./);
    written = lastWrite('Mails.set');
    assert.equal(written.displayableParts[0].content, `<html><body><p>Second <em>version</em>.</p>${quote}</body></html>`);
    assert.deepEqual(written.cc.map((a) => a.address), ['boss@customer.example']);

    await call('mail_update_draft', { id, attachments: [] });
    assert.deepEqual(lastWrite('Mails.set').attachments, []);
  });

  test('only drafts in the Drafts folder can be changed', async () => {
    for (const id of [question.id, ownSent.id]) {
      const { text, isError } = await call('mail_update_draft', { id, subject: 'Changed' });
      assert.equal(isError, true);
      assert.match(text, /not a draft.*nothing was changed/);
    }
    assert.deepEqual(mock.nonReadCalls(), []);
  });

  test('an expired session is renewed by a read, so the draft is written once', async () => {
    await client.getMailFolders();
    mock.expireSessions();
    const { text } = await call('mail_create_draft', { to: ['a@example.org'], subject: 'x', body: 'x' });
    assert.match(text, /^Draft saved/);
    assert.equal(mock.callsOf('Mails.create').length, 1);
  });

  test('a failed or unanswered write is reported and never repeated', async () => {
    mock.state.writeBehavior = 'fail';
    const failed = await call('mail_create_draft', { to: ['a@example.org'], subject: 'x', body: 'x' });
    assert.equal(failed.isError, true);
    assert.match(failed.text, /did not save the draft: Saving failed/);

    mock.state.writeBehavior = 'hang';
    const hung = await call('mail_create_draft', { to: ['a@example.org'], subject: 'x', body: 'x' });
    assert.equal(hung.isError, true);
    assert.equal(mock.callsOf('Mails.create').length, 2);
  });

  test('the client refuses anything but saving a single draft, before contacting Kerio', async () => {
    await client.ensureAuthenticated();
    mock.state.calls.length = 0;
    const refused = [
      ['Mails.create', { mails: [{ send: true, to: [] }] }],
      ['Mails.create', { mails: [{ to: [] }] }],
      ['Mails.create', { mails: [{ send: false, id: 'x' }] }],
      ['Mails.create', { mails: [{ send: false, folderId: 'x' }] }],
      ['Mails.create', { mails: [{ send: false }, { send: false }] }],
      ['Mails.set', { mails: [{ send: false, subject: 'no id' }] }],
      ['Mails.set', { mails: [{ id: 'x', send: true }] }],
      ['Mails.set', { mails: [{ id: 'x', send: false, isSeen: true }] }],
      ['Mails.remove', { ids: ['x'] }],
      ['Mails.send', {}],
    ];
    for (const [method, params] of refused) {
      await assert.rejects(client.post(method, params, null), KerioPolicyError, `${method} ${JSON.stringify(params)}`);
    }
    assert.deepEqual(mock.state.calls, []);
  });
});
