import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectMcp, makeClient, textOf } from './helpers/clients.mjs';
import { CONTACTS, FOLDERS, startMockKerio } from './helpers/mock-kerio.mjs';

const originalContact = () => ({
  id: 'person-1', folderId: CONTACTS, type: 'ctContact', watermark: '42',
  commonName: 'Jan Novák', firstName: 'Jan', surName: 'Novák', companyName: 'Acme',
  emailAddresses: [{ address: 'jan@acme.cz', type: 'EmailWork' }, { address: 'jan@home.cz', type: 'EmailHome' }],
  phoneNumbers: [{ number: '+420 123 456 789', type: 'TypeMobile' }],
  postalAddresses: [{ locality: 'Praha', type: 'AddressWork' }],
  comment: 'Existing notes', birthDay: '19720514T000000+0000',
  urls: [{ address: 'https://example.com', type: 'UrlWork' }], photo: { id: 'photo' }, categories: ['Friends'],
});
async function setup(t, options = {}) {
  const mock = await startMockKerio({ contacts: [originalContact()], ...options });
  const kerio = makeClient(mock, options.clientOptions);
  const mcp = await connectMcp(kerio);
  t.after(async () => { await mcp.close(); await mock.close(); });
  const call = async (name, args = {}) => {
    const result = await mcp.callTool({ name, arguments: args });
    return { text: textOf(result), error: result.isError };
  };
  return { mock, kerio, mcp, call };
}

test('all five tools are discoverable with accurate write annotations', async (t) => {
  const { mcp } = await setup(t);
  const tools = (await mcp.listTools()).tools;
  assert.equal(tools.length, 11); // attachment links are remote-only
  for (const name of ['contacts_search', 'contacts_get']) assert.equal(tools.find((x) => x.name === name).annotations.readOnlyHint, true);
  for (const name of ['contacts_create', 'contacts_update', 'mail_set_read_status']) assert.equal(tools.find((x) => x.name === name).annotations.readOnlyHint, false);
  assert.equal(tools.find((x) => x.name === 'contacts_create').annotations.idempotentHint, false);
  assert.equal(tools.find((x) => x.name === 'mail_set_read_status').annotations.idempotentHint, true);
});

test('contact search matches names without accents, e-mail and formatted phones without writes', async (t) => {
  const { call, mock } = await setup(t);
  for (const query of ['novak', 'jan@home.cz', '+420123456789', 'Jan Novak']) {
    const result = await call('contacts_search', { query });
    assert.equal(result.error, false, result.text);
    assert.match(result.text, /person-1/);
    assert.match(result.text, /Search complete/);
    assert.match(result.text, /UNTRUSTED CONTACT DATA/);
  }
  const detail = await call('contacts_get', { id: 'person-1' });
  assert.match(detail.text, /1972-05-14/);
  assert.match(detail.text, /photo/);
  assert.deepEqual(mock.nonReadCalls(), []);
});

test('contact search continuation counts scanned records, including pages without matches', async (t) => {
  const contacts = Array.from({ length: 5010 }, (_, index) => ({
    ...originalContact(), id: `p-${String(index).padStart(5, '0')}`,
    commonName: index === 5005 ? 'Rare Target' : 'Ordinary', firstName: '', surName: '',
  }));
  const { call } = await setup(t, { contacts });
  const first = await call('contacts_search', { query: 'Rare Target' });
  assert.match(first.text, /Search NOT finished\. nextOffset: 5000/);
  const second = await call('contacts_search', { query: 'Rare Target', offset: 5000 });
  assert.match(second.text, /p-05005/);
  assert.match(second.text, /Search complete/);
  const page = await call('contacts_search', { limit: 1 });
  assert.match(page.text, /nextOffset: 1/);
  const next = await call('contacts_search', { limit: 1, offset: 1 });
  assert.match(next.text, /p-00001/);
  assert.doesNotMatch(next.text, /p-00000/);
});

test('partial contact update preserves omitted and unsupported fields; null and [] clear explicitly', async (t) => {
  const { call, mock } = await setup(t);
  const before = structuredClone(mock.state.contacts[0]);
  const updated = await call('contacts_update', { id: before.id, birthday: '1980-02-29', company: 'New company' });
  assert.equal(updated.error, false, updated.text);
  assert.deepEqual(mock.state.contacts[0], { ...before, birthDay: '19800229T000000+0000', companyName: 'New company' });
  const write = mock.callsOf('Contacts.set')[0].params.contacts[0];
  assert.deepEqual(Object.keys(write).sort(), ['id', 'folderId', 'birthDay', 'companyName'].sort());
  const cleared = await call('contacts_update', { id: before.id, notes: null, birthday: null, phoneNumbers: [] });
  assert.equal(cleared.error, false, cleared.text);
  assert.equal(mock.state.contacts[0].comment, '');
  assert.equal(mock.state.contacts[0].birthDay, '');
  assert.deepEqual(mock.state.contacts[0].phoneNumbers, []);
  assert.deepEqual(mock.state.contacts[0].emailAddresses, before.emailAddresses);
});

test('create writes typed phones, postal addresses, date and name into the selected contact folder', async (t) => {
  const { call, mock } = await setup(t);
  const result = await call('contacts_create', {
    firstName: 'Pavel', lastName: 'Dvořák', company: 'Company', jobTitle: 'Director', birthday: '1970-03-15', notes: 'From signature',
    emailAddresses: [{ address: 'pavel@example.org', type: 'EmailWork' }],
    phoneNumbers: [{ number: '+420 111 222 333', type: 'TypeMobile' }],
    postalAddresses: [{ street: 'Main 1', locality: 'Praha', zip: '11000', country: 'CZ', type: 'AddressWork' }],
  });
  assert.equal(result.error, false, result.text);
  assert.match(result.text, /Contact saved\. ID: contact-2/);
  assert.equal(mock.state.contacts[1].commonName, 'Pavel Dvořák');
  assert.equal(mock.state.contacts[1].profession, 'Director');
  assert.equal(mock.state.contacts[1].folderId, CONTACTS);
  assert.equal(mock.state.contacts[1].type, 'ctContact');
});

test('folder discovery handles multiple/absent folders without guessing or writing to mail folders', async (t) => {
  const other = { id: 'other-contacts', type: 'FContact', name: 'Shared contacts' };
  const { call, mock } = await setup(t, { folders: [...FOLDERS, other] });
  const ambiguous = await call('contacts_create', { firstName: 'New' });
  assert.equal(ambiguous.error, true);
  assert.match(ambiguous.text, /other-contacts/);
  assert.equal(mock.callsOf('Contacts.create').length, 0);
  assert.equal((await call('contacts_create', { firstName: 'New', folder: 'other-contacts' })).error, false);
  assert.equal((await call('contacts_create', { firstName: 'New', folder: FOLDERS.find((x) => x.type === 'FMail').id })).error, true);
  assert.equal((await call('contacts_search', { folder: 'missing' })).error, true);
  mock.state.folders = [];
  assert.match((await call('contacts_search')).text, /No accessible contact folders/);
  assert.equal((await call('contacts_create', { firstName: 'New' })).error, true);
});

test('invalid dates, missing changes, unknown fields and unsupported contacts cause no writes', async (t) => {
  const { call, mock } = await setup(t);
  for (const args of [
    { id: 'person-1', birthday: '2025-02-29' }, { id: 'person-1', birthday: '--05-14' },
    { id: 'person-1', birthday: '0000-01-01' }, { id: 'person-1' },
    { id: 'person-1', folderId: 'elsewhere' }, { id: 'missing', notes: 'New' },
    { id: 'person-1', emailAddresses: null }, { id: 'person-1', phoneNumbers: [{ number: '123', type: 'bad' }] },
  ]) assert.equal((await call('contacts_update', args)).error, true);
  for (const args of [{}, { firstName: 'New', type: 'ctDistributionList' }, { firstName: 'New', send: true }]) {
    assert.equal((await call('contacts_create', args)).error, true);
  }
  mock.state.contacts[0].isGalContact = true;
  assert.equal((await call('contacts_update', { id: 'person-1', notes: 'New' })).error, true);
  mock.state.contacts[0].isGalContact = false;
  mock.state.contacts[0].type = 'ctDistributionList';
  assert.equal((await call('contacts_update', { id: 'person-1', notes: 'New' })).error, true);
  assert.deepEqual(mock.nonReadCalls(), []);
});

test('read-state tool assigns both states, deduplicates IDs and preserves all other mail fields', async (t) => {
  const { call, mock } = await setup(t);
  const before = structuredClone(mock.state.mails[0]);
  for (const read of [false, false, true]) {
    const result = await call('mail_set_read_status', { ids: [before.id, before.id], read });
    assert.equal(result.error, false, result.text);
    assert.match(result.text, /1\/1 succeeded/);
    assert.deepEqual(mock.state.mails[0], { ...before, isSeen: read });
  }
  assert.equal(mock.callsOf('Mails.set').length, 3);
  for (const { params } of mock.callsOf('Mails.set')) assert.deepEqual(Object.keys(params.mails[0]).sort(), ['id', 'isSeen']);
});

test('read-state tool reports partial failure per ID and rejects invalid payloads before writes', async (t) => {
  const { call, mock } = await setup(t);
  const id = mock.state.mails[0].id;
  for (const args of [{ ids: [], read: true }, { ids: [id] }, { ids: [id], read: true, subject: 'changed' },
    { ids: Array(101).fill(id), read: true }]) assert.equal((await call('mail_set_read_status', args)).error, true);
  assert.equal(mock.callsOf('Mails.set').length, 0);
  const result = await call('mail_set_read_status', { ids: [id, 'missing', mock.state.mails[1].id], read: false });
  assert.equal(result.error, true);
  assert.match(result.text, /2\/3 succeeded/);
  assert.match(result.text, /"missing": ERROR/);
  assert.equal(mock.state.mails[1].isSeen, false);
});

test('new writes renew expired sessions and refuse API bypasses', async (t) => {
  const { kerio, call, mock } = await setup(t);
  await call('contacts_get', { id: 'person-1' });
  mock.expireSessions();
  assert.equal((await call('contacts_update', { id: 'person-1', notes: 'Changed' })).error, false);
  mock.expireSessions();
  assert.equal((await call('mail_set_read_status', { ids: [mock.state.mails[0].id], read: false })).error, false);
  for (const [method, params] of [
    ['Contacts.create', { contacts: [{ folderId: CONTACTS, firstName: 'Bypass' }] }],
    ['Contacts.remove', { ids: ['person-1'] }],
    ['Mails.set', { mails: [{ id: mock.state.mails[0].id, isSeen: true }] }],
    ['Mails.setAllSeen', { folderId: FOLDERS[1].id }],
  ]) await assert.rejects(kerio.post(method, params, null), /allowed|single draft/);
  await assert.rejects(kerio.saveContact({ folderId: CONTACTS, send: true }), /Invalid contact/);
  for (const method of ['Contacts.create', 'Contacts.set', 'Mails.set']) {
    await assert.rejects(kerio.read(method, {}), /not allowed/);
  }
});

test('failed and unknown writes are not retried or reported as saved', async (t) => {
  const { call, mock } = await setup(t, { clientOptions: { network: { requestTimeoutMs: 100 } } });
  mock.state.writeBehavior = 'fail';
  assert.equal((await call('contacts_create', { firstName: 'New' })).error, true);
  assert.equal((await call('contacts_update', { id: 'person-1', notes: 'New' })).error, true);
  assert.equal((await call('mail_set_read_status', { ids: [mock.state.mails[0].id], read: false })).error, true);
  mock.state.writeBehavior = 'hang';
  assert.match((await call('contacts_create', { firstName: 'New' })).text, /UNKNOWN/);
  assert.match((await call('contacts_update', { id: 'person-1', notes: 'New' })).text, /UNKNOWN/);
  assert.match((await call('mail_set_read_status', { ids: [mock.state.mails[0].id], read: false })).text, /UNKNOWN/);
  assert.equal(mock.callsOf('Contacts.create').length, 2);
  assert.equal(mock.callsOf('Contacts.set').length, 2);
  assert.equal(mock.callsOf('Mails.set').length, 2);
});


test('silent ignored updates produce UNKNOWN rather than a false success', async (t) => {
  const { call, mock } = await setup(t);
  mock.state.ignoreStatusUpdates = true;
  const status = await call('mail_set_read_status', { ids: [mock.state.mails[0].id], read: false });
  assert.equal(status.error, true);
  assert.match(status.text, /UNKNOWN/);
  mock.state.ignoreContactUpdates = true;
  const contact = await call('contacts_update', { id: 'person-1', company: 'Ignored company' });
  assert.equal(contact.error, true);
  assert.match(contact.text, /UNKNOWN.*companyName/);
  assert.equal(mock.callsOf('Contacts.set').length, 1);
  assert.equal(mock.callsOf('Mails.set').length, 1);
});
