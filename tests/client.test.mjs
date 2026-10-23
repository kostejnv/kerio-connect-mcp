import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { KerioLoginError, KerioPolicyError, KerioTransportError } from '../dist/client.js';
import { ServerNotAllowedError, normalizeServerUrl } from '../dist/network.js';
import { makeClient } from './helpers/clients.mjs';
import { makeMails, startMockKerio } from './helpers/mock-kerio.mjs';

describe('Kerio client', () => {
  let mock;
  before(async () => {
    mock = await startMockKerio({ mails: makeMails(1200) });
  });
  after(() => mock.close());

  test('reads a message far beyond the newest 500 directly by ID', async () => {
    const client = makeClient(mock);
    const oldest = mock.state.mails[1199];

    const { result, errors } = await client.getMailsById([oldest.id]);

    assert.equal(errors.length, 0);
    assert.equal(result[0].id, oldest.id);
    assert.equal(mock.callsOf('Mails.get').length, 0, 'must not page through the folder');
  });

  test('renews an expired session once and repeats the read', async () => {
    const client = makeClient(mock);
    await client.getMailFolders();
    const loginsBefore = mock.state.logins;

    mock.expireSessions();
    const folders = await client.getMailFolders();

    assert.ok(folders.length > 0);
    assert.equal(mock.state.logins, loginsBefore + 1);
  });

  test('rejects wrong credentials with a login error', async () => {
    const client = makeClient(mock, { password: 'wrong' });
    await assert.rejects(client.ensureAuthenticated(), KerioLoginError);
  });

  test('refuses API methods outside the allowlist before sending any request', async () => {
    const client = makeClient(mock);
    const callsBefore = mock.state.calls.length;

    await assert.rejects(client.read('Mails.remove', { ids: ['x'] }), KerioPolicyError);
    await assert.rejects(client.post('Mails.set', { mails: [] }, null), KerioPolicyError);
    assert.equal(mock.state.calls.length, callsBefore);
  });
});

describe('TLS and network policy', () => {
  let mock;
  before(async () => {
    mock = await startMockKerio();
  });
  after(() => mock.close());

  test('verifies certificates by default: an untrusted CA is refused', async () => {
    const client = makeClient(mock, { network: { extraCaPem: undefined } });
    await assert.rejects(client.ensureAuthenticated(), (error) => {
      assert.ok(error instanceof KerioTransportError);
      assert.match(error.message, /certificate|self.signed|SELF_SIGNED|UNABLE_TO/i);
      assert.equal(error.mayHaveReachedServer, false);
      return true;
    });
    assert.equal(mock.state.logins, 0);
  });

  test('trusts a configured company CA', async () => {
    const client = makeClient(mock);
    await client.ensureAuthenticated();
    assert.equal(mock.state.logins, 1);
  });

  test('blocks private IP literals unless explicitly allowed', () => {
    assert.throws(() => makeClient(mock, { server: mock.ipUrl, network: { allowPrivateNetwork: false } }), ServerNotAllowedError);
  });

  test('blocks host names resolving to private addresses at connect time', async () => {
    const client = makeClient(mock, { network: { allowPrivateNetwork: false } });
    await assert.rejects(client.ensureAuthenticated(), (error) => {
      assert.ok(error instanceof KerioTransportError);
      assert.match(error.message, /private or local address/);
      return true;
    });
  });

  test('enforces the allowed server list', () => {
    assert.throws(() => makeClient(mock, { network: { allowedServers: ['mail.example.com'] } }), ServerNotAllowedError);
    assert.doesNotThrow(() => makeClient(mock, { network: { allowedServers: ['localhost'] } }));
  });

  test('normalizes server addresses and requires https', () => {
    assert.equal(normalizeServerUrl('mail.example.com'), 'https://mail.example.com');
    assert.equal(normalizeServerUrl(' https://mail.example.com:8443/webmail/ '), 'https://mail.example.com:8443');
    assert.throws(() => normalizeServerUrl('http://mail.example.com'), ServerNotAllowedError);
    assert.throws(() => normalizeServerUrl('https://user:pw@mail.example.com'), ServerNotAllowedError);
  });
});
