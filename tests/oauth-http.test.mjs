import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { textOf } from './helpers/clients.mjs';
import { REDIRECT_URI, form, mcpClient, signIn, startApp } from './helpers/http.mjs';
import { startMockKerio } from './helpers/mock-kerio.mjs';

describe('OAuth sign-in and remote MCP endpoint', () => {
  let mock;
  let app;
  before(async () => {
    mock = await startMockKerio();
    app = await startApp();
  });
  after(async () => {
    await app.close();
    await mock.close();
  });

  test('the server address opens a landing page that explains how to connect', async () => {
    const response = await fetch(`${app.baseUrl}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    const page = await response.text();
    assert.ok(page.includes(`${app.baseUrl}/mcp`), 'shows the MCP address of this server');
    assert.doesNotMatch(page, /%MCP_URL%|%HOST%/);
    for (const tool of ['mail_search', 'mail_get', 'mail_get_attachment', 'mail_attachment_link', 'mail_create_draft', 'mail_update_draft']) {
      assert.ok(page.includes(tool), tool);
    }
    assert.doesNotMatch(page, /mail_send/);
    for (const asset of ['system.js', 'glyphs.js', 'landing.js', 'system.css', 'favicon.svg']) {
      assert.equal((await fetch(`${app.baseUrl}/assets/${asset}`)).status, 200, asset);
    }
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

  test('the sign-in page asks only for server, login and password', async () => {
    const { page } = await signIn(app, mock, { password: 'wrong' });
    assert.match(page, /name="server"/);
    assert.match(page, /name="username"/);
    assert.match(page, /name="password"/);
    assert.doesNotMatch(page, /type="checkbox"|allowSend/);
    assert.match(page, /claude\.ai/);
  });

  test('wrong Kerio credentials do not produce an authorization code', async () => {
    const { login } = await signIn(app, mock, { password: 'wrong' });
    assert.equal(login.status, 400);
    const page = await login.text();
    assert.match(page, /Kerio sign-in failed/);
    assert.match(page, /Přihlášení ke Keriu se nezdařilo/, 'Czech variant is available through the language switch');
    assert.doesNotMatch(page, /wrong/);
  });

  test('a successful sign-in yields tokens that work with an MCP client', async () => {
    const { location, tokens, tokenResponse } = await signIn(app, mock);
    assert.equal(location.origin + location.pathname, REDIRECT_URI);
    assert.equal(location.searchParams.get('state'), 'state-123');
    assert.equal(tokenResponse.status, 200);
    assert.equal(tokens.expires_in, 3600);
    assert.ok(tokens.refresh_token);
    assert.ok(!JSON.stringify(tokens).includes(mock.password), 'tokens must not contain the password in clear text');

    const client = await mcpClient(app, tokens.access_token);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), [
      'mail_folders_list', 'mail_search', 'mail_get', 'mail_get_attachment', 'mail_attachment_link', 'mail_create_draft', 'mail_update_draft',
    ]);
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
    assert.equal((await client.listTools()).tools.length, 7);
    await client.close();
  });

  test('there is no way to send: a mail_send call is refused as an unknown tool', async () => {
    const { tokens } = await signIn(app, mock);
    const client = await mcpClient(app, tokens.access_token);
    const result = await client.callTool({ name: 'mail_send', arguments: { to: ['a@example.org'], subject: 's', body: 'b' } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Unknown tool/);
    assert.equal(mock.callsOf('Mails.create').length, 0);
    await client.close();
  });

  test('a draft can be saved through the remote endpoint', async () => {
    const { tokens } = await signIn(app, mock);
    const client = await mcpClient(app, tokens.access_token);
    const result = await client.callTool({
      name: 'mail_create_draft',
      arguments: { to: ['a@example.org'], subject: 'Hello', body: 'Text' },
    });
    assert.match(textOf(result), /^Draft saved in the Drafts folder\./);
    const [create] = mock.callsOf('Mails.create');
    assert.equal(create.params.mails[0].send, false);
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
