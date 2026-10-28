import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpApp } from '../../dist/http-server.js';
import { createKerioDispatcher } from '../../dist/network.js';
import { testNetwork } from './clients.mjs';

export const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';

export async function startApp({ network: networkOverrides = {}, tokenKey = crypto.randomBytes(32) } = {}) {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://localhost:${server.address().port}`;
  const network = testNetwork(networkOverrides);
  const app = createHttpApp(
    { transport: 'http', network, publicUrl: new URL(baseUrl), port: 0, tokenKey },
    createKerioDispatcher(network)
  );
  server.on('request', app);
  return { baseUrl, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

export const form = (fields) => new URLSearchParams(fields).toString();

/** Walks through dynamic client registration, the sign-in form and the PKCE code exchange. */
export async function signIn(app, mock, { password = mock.password } = {}) {
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
    body: form({ request: authRequest, server: mock.url, username: mock.username, password }),
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

export async function mcpClient(app, accessToken) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${app.baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  }));
  return client;
}

