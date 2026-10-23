import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpApp } from '../dist/http-server.js';
import { createKerioDispatcher } from '../dist/network.js';
import { testNetwork, textOf } from './helpers/clients.mjs';
import { startMockKerio } from './helpers/mock-kerio.mjs';

const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';

async function startApp({ allowSend = false, network: networkOverrides = {} } = {}) {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://localhost:${server.address().port}`;
  const network = testNetwork(networkOverrides);
  const app = createHttpApp(
    { transport: 'http', network, publicUrl: new URL(baseUrl), port: 0, tokenKey: crypto.randomBytes(32), allowSend },
    createKerioDispatcher(network)
  );
  server.on('request', app);
  return { baseUrl, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

const form = (fields) => new URLSearchParams(fields).toString();

/** Walks through dynamic client registration, the sign-in form and the PKCE code exchange. */
async function signIn(app, mock, { password = mock.password, allowSend = false } = {}) {
  const registration = await fetch(`${app.baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Claude',
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  assert.equal(registration.status, 201);
  const { client_id: clientId } = await registration.json();

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const authorizeUrl = new URL(`${app.baseUrl}/authorize`);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT_URI,
    code_challenge: challenge, code_challenge_method: 'S256', state: 'state-123',
  }).toString();
  const page = await (await fetch(authorizeUrl)).text();
  const authRequest = page.match(/name="request" value="([^"]+)"/)[1];

  const login = await fetch(`${app.baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ request: authRequest, server: mock.url, username: mock.username, password, ...(allowSend ? { allowSend: 'on' } : {}) }),
  });
  if (login.status !== 302) return { login, page };

  const location = new URL(login.headers.get('location'));
  const tokenResponse = await fetch(`${app.baseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      grant_type: 'authorization_code', code: location.searchParams.get('code'), code_verifier: verifier,
      client_id: clientId, redirect_uri: REDIRECT_URI,
    }),
  });
  return { login, page, location, clientId, verifier, tokenResponse, tokens: await tokenResponse.clone().json() };
}

async function mcpClient(app, accessToken) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${app.baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  }));
  return client;
}

describe('OAuth sign-in and remote MCP endpoint', () => {
  let mock;
  let app;
  before(async () => {
    mock = await startMockKerio();
    app = await startApp({ allowSend: false });
  });
  after(async () => {
    await app.close();
    await mock.close();
  });

  test('publishes OAuth metadata for MCP clients', async () => {
    const resource = await (await fetch(`${app.baseUrl}/.well-known/oauth-protected-resource/mcp`)).json();
    assert.equal(resource.resource, `${app.baseUrl}/mcp`);
    const metadata = await (await fetch(`${app.baseUrl}/.well-known/oauth-authorization-server`)).json();
    assert.equal(metadata.registration_endpoint, `${app.baseUrl}/register`);
    assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
  });

  test('rejects MCP requests without a valid token', async () => {
    const response = await fetch(`${app.baseUrl}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate'), /resource_metadata=/);

    const forged = await fetch(`${app.baseUrl}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer v1.AAAA' }, body: '{}' });
    assert.equal(forged.status, 401);
  });

  test('the sign-in page asks for server, login and password, with no send option by default', async () => {
    const { page } = await signIn(app, mock, { password: 'wrong' });
    assert.match(page, /name="server"/);
    assert.match(page, /name="username"/);
    assert.match(page, /name="password"/);
    assert.doesNotMatch(page, /allowSend/);
    assert.match(page, /claude\.ai/);
  });

  test('wrong Kerio credentials do not produce an authorization code', async () => {
    const { login } = await signIn(app, mock, { password: 'wrong' });
    assert.equal(login.status, 400);
    const page = await login.text();
    assert.match(page, /Přihlášení ke Keriu se nezdařilo/);
    assert.doesNotMatch(page, /wrong/);
  });

  test('a successful sign-in yields tokens that work with an MCP client, read-only', async () => {
    const { location, tokens, tokenResponse } = await signIn(app, mock);
    assert.equal(location.origin + location.pathname, REDIRECT_URI);
    assert.equal(location.searchParams.get('state'), 'state-123');
    assert.equal(tokenResponse.status, 200);
    assert.equal(tokens.expires_in, 3600);
    assert.ok(tokens.refresh_token);
    assert.ok(!JSON.stringify(tokens).includes(mock.password), 'tokens must not contain the password in clear text');

    const client = await mcpClient(app, tokens.access_token);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ['mail_folders_list', 'mail_search', 'mail_get']);
    const result = await client.callTool({ name: 'mail_search', arguments: { limit: 3 } });
    assert.match(textOf(result), /Showing results 1-3 of 10/);
    await client.close();
  });

  test('authorization codes are single-use and require the PKCE verifier', async () => {
    const { location, clientId, verifier } = await signIn(app, mock);
    const code = location.searchParams.get('code');
    const exchange = (codeVerifier) => fetch(`${app.baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, client_id: clientId, redirect_uri: REDIRECT_URI }),
    });
    assert.equal((await exchange('x'.repeat(43))).status, 400);
    assert.equal((await exchange(verifier)).status, 400, 'code was already redeemed during sign-in');
  });

  test('refresh tokens issue new working access tokens (90-day lifetime)', async () => {
    const { tokens, clientId } = await signIn(app, mock);
    const refreshed = await fetch(`${app.baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }),
    });
    assert.equal(refreshed.status, 200);
    const next = await refreshed.json();
    const client = await mcpClient(app, next.access_token);
    assert.equal((await client.listTools()).tools.length, 3);
    await client.close();
  });

  test('the send checkbox has no effect when the server does not allow sending', async () => {
    const { tokens } = await signIn(app, mock, { allowSend: true });
    const client = await mcpClient(app, tokens.access_token);
    assert.ok(!(await client.listTools()).tools.some((tool) => tool.name === 'mail_send'));
    const result = await client.callTool({ name: 'mail_send', arguments: { to: ['a@example.org'], subject: 's', body: 'b' } });
    assert.equal(result.isError, true);
    assert.equal(mock.callsOf('Mails.create').length, 0);
    await client.close();
  });

  test('rejects plain http and private addresses typed into the sign-in form', async () => {
    const strictApp = await startApp({ network: { allowPrivateNetwork: false } });
    try {
      for (const server of ['http://mail.example.com', mock.ipUrl]) {
        const { page } = await signIn(strictApp, mock, {});
        const authRequest = page.match(/name="request" value="([^"]+)"/)[1];
        const login = await fetch(`${strictApp.baseUrl}/login`, {
          method: 'POST', redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form({ request: authRequest, server, username: mock.username, password: mock.password }),
        });
        assert.equal(login.status, 400);
      }
    } finally {
      await strictApp.close();
    }
  });
});

describe('sending enabled on the server', () => {
  let mock;
  let app;
  before(async () => {
    mock = await startMockKerio();
    app = await startApp({ allowSend: true });
  });
  after(async () => {
    await app.close();
    await mock.close();
  });

  test('the user opts in per connection with the checkbox; unchecked stays read-only', async () => {
    const readOnly = await signIn(app, mock);
    assert.match(readOnly.page, /name="allowSend"/);
    const readClient = await mcpClient(app, readOnly.tokens.access_token);
    assert.ok(!(await readClient.listTools()).tools.some((tool) => tool.name === 'mail_send'));
    await readClient.close();

    const withSend = await signIn(app, mock, { allowSend: true });
    const sendClient = await mcpClient(app, withSend.tokens.access_token);
    assert.ok((await sendClient.listTools()).tools.some((tool) => tool.name === 'mail_send'));
    const result = await sendClient.callTool({ name: 'mail_send', arguments: { to: ['a@example.org'], subject: 's', body: 'b' } });
    assert.match(textOf(result), /^SENT\./);
    assert.equal(mock.callsOf('Mails.create').length, 1);
    await sendClient.close();
  });
});
