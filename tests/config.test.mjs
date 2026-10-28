import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { loadConfig } from '../dist/config.js';
import { TokenSealer } from '../dist/sealed-token.js';

const stdioEnv = { KERIO_SERVER: 'mail.example.com', KERIO_USERNAME: 'jan@example.com', KERIO_PASSWORD: 'secret' };
const httpEnv = { MCP_TRANSPORT: 'http', PUBLIC_URL: 'https://kerio.example.com', MCP_TOKEN_KEY: crypto.randomBytes(32).toString('base64') };

test('switches are off when missing or false, and only the exact value "true" turns them on', () => {
  assert.equal(loadConfig(stdioEnv).network.allowPrivateNetwork, false);
  assert.equal(loadConfig({ ...stdioEnv, KERIO_ALLOW_PRIVATE_NETWORK: 'false' }).network.allowPrivateNetwork, false);
  assert.equal(loadConfig({ ...httpEnv, KERIO_ALLOW_PRIVATE_NETWORK: 'true' }).network.allowPrivateNetwork, true);
});

test('invalid switch values stop startup instead of enabling anything', () => {
  for (const value of ['TRUE', 'yes', '1', 'on', ' true']) {
    assert.throws(
      () => loadConfig({ ...stdioEnv, KERIO_ALLOW_PRIVATE_NETWORK: value }),
      /KERIO_ALLOW_PRIVATE_NETWORK must be "true" or "false"/
    );
  }
});

test('http mode requires a 32-byte token key and needs no Kerio credentials', () => {
  const config = loadConfig(httpEnv);
  assert.equal(config.transport, 'http');
  assert.equal(config.tokenKey.length, 32);
  assert.throws(() => loadConfig({ ...httpEnv, MCP_TOKEN_KEY: 'c2hvcnQ=' }), /32 random bytes/);
});

test('sealed tokens reject tampering, other purposes, expiry and other keys', () => {
  const key = crypto.randomBytes(32);
  const sealer = new TokenSealer(key);
  const token = sealer.seal('access', { user: 'jan' }, 60);

  assert.deepEqual(sealer.open('access', token).data, { user: 'jan' });
  assert.equal(sealer.open('refresh', token), null);
  assert.equal(new TokenSealer(crypto.randomBytes(32)).open('access', token), null);

  const tampered = token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  assert.equal(sealer.open('access', tampered), null);

  const expired = sealer.seal('access', { user: 'jan' }, -1);
  assert.equal(sealer.open('access', expired), null);

  assert.doesNotMatch(Buffer.from(token.slice(3), 'base64url').toString('latin1'), /jan/);
});
