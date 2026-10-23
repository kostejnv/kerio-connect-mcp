/**
 * Remote MCP endpoint (Streamable HTTP) protected by the stateless OAuth provider.
 *
 *   /mcp                      MCP endpoint (Bearer token)
 *   /authorize, /token, ...   OAuth endpoints provided by the MCP SDK
 *   /login                    sign-in form submission
 *   /healthz                  liveness check
 */

import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Dispatcher } from 'undici';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { KerioClient, KerioLoginError, KerioTransportError } from './client.js';
import type { HttpConfig } from './config.js';
import { sendErrorPage, sendLoginPage, type LocalizedText } from './login-page.js';
import { createMcpServer } from './mcp-server.js';
import { normalizeServerUrl, ServerNotAllowedError } from './network.js';
import { StatelessOAuthProvider, type Grant } from './oauth-provider.js';
import { TokenSealer } from './sealed-token.js';

const IDLE_CLIENT_TTL_MS = 30 * 60 * 1000;

/**
 * Kerio clients (and their sessions) kept in memory between requests of the same connection.
 * Losing them is harmless: the next request logs in again with the credentials from the token.
 */
class KerioClientPool {
  private readonly clients = new Map<string, { client: KerioClient; lastUsed: number }>();

  constructor(private readonly createClient: (grant: Grant) => KerioClient) {
    setInterval(() => this.evictIdle(), 60_000).unref();
  }

  get(grant: Grant): KerioClient {
    const entry = this.clients.get(this.keyOf(grant));
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.client;
    }
    return this.put(grant, this.createClient(grant));
  }

  put(grant: Grant, client: KerioClient): KerioClient {
    this.clients.set(this.keyOf(grant), { client, lastUsed: Date.now() });
    return client;
  }

  private keyOf(grant: Grant): string {
    const { server, username, password } = grant.credentials;
    return crypto.createHash('sha256').update(JSON.stringify([server, username, password, grant.sendEnabled])).digest('hex');
  }

  private evictIdle(): void {
    const cutoff = Date.now() - IDLE_CLIENT_TTL_MS;
    for (const [key, entry] of this.clients) {
      if (entry.lastUsed < cutoff) this.clients.delete(key);
    }
  }
}

function loginErrorMessage(error: unknown): LocalizedText {
  if (error instanceof ServerNotAllowedError) {
    return { en: error.message, cs: `Tento Kerio server nelze použít (${error.message}).` };
  }
  if (error instanceof KerioLoginError) {
    return {
      en: 'Kerio sign-in failed. Check your username and password.',
      cs: 'Přihlášení ke Keriu se nezdařilo. Zkontrolujte uživatelské jméno a heslo.',
    };
  }
  if (error instanceof KerioTransportError) {
    return { en: `Kerio server is not reachable: ${error.message}`, cs: `Kerio server není dostupný: ${error.message}` };
  }
  return { en: 'Sign-in failed because of an unexpected error.', cs: 'Přihlášení se nezdařilo kvůli neočekávané chybě.' };
}

export function createHttpApp(config: HttpConfig, dispatcher: Dispatcher) {
  const mcpUrl = new URL('/mcp', config.publicUrl);
  const sealer = new TokenSealer(config.tokenKey);
  const newClient = (grant: Grant) =>
    new KerioClient({ credentials: grant.credentials, network: config.network, dispatcher, sendEnabled: grant.sendEnabled });
  const pool = new KerioClientPool(newClient);

  const provider = new StatelessOAuthProvider(sealer, (res, pending, authRequest) =>
    sendLoginPage(res, { pending, authRequest, sendOptionAvailable: config.allowSend })
  );

  const app = express();
  app.disable('x-powered-by');
  // Behind Caddy: use X-Forwarded-For for rate limiting.
  app.set('trust proxy', 1);

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: config.publicUrl,
      resourceServerUrl: mcpUrl,
      resourceName: 'Kerio Connect mail',
      // Registered clients must keep working as long as their refresh tokens do.
      clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
    })
  );

  app.post(
    '/login',
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }),
    express.urlencoded({ extended: false, limit: '20kb' }),
    async (req: Request, res: Response) => {
      const body = req.body as Record<string, string | undefined>;
      const pending = provider.openAuthRequest(body.request ?? '');
      if (!pending) {
        sendErrorPage(res, 400, {
          en: 'This sign-in request has expired or is invalid. Start connecting again from your app.',
          cs: 'Přihlašovací požadavek vypršel nebo je neplatný. Začněte připojení znovu ve své aplikaci.',
        });
        return;
      }

      const values = { server: body.server ?? '', username: body.username ?? '' };
      try {
        const grant: Grant = {
          credentials: { server: normalizeServerUrl(values.server), username: values.username.trim(), password: body.password ?? '' },
          sendEnabled: config.allowSend && body.allowSend === 'on',
        };
        // Only verified credentials end up in a token (and in the client pool).
        const client = newClient(grant);
        await client.ensureAuthenticated();
        pool.put(grant, client);
        console.error(`[Auth] Connected mailbox on ${new URL(grant.credentials.server).host} (send ${grant.sendEnabled ? 'enabled' : 'disabled'})`);
        res.redirect(302, provider.completeAuthorization(pending, grant));
      } catch (error) {
        console.error(`[Auth] Sign-in failed: ${error instanceof Error ? error.name : 'Error'}`);
        sendLoginPage(
          res,
          { pending, authRequest: body.request!, sendOptionAvailable: config.allowSend, values, error: loginErrorMessage(error) },
          400
        );
      }
    }
  );

  const bearerAuth = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
  });

  app.post('/mcp', bearerAuth, express.json({ limit: '1mb' }), async (req: Request, res: Response) => {
    const grant = req.auth?.extra?.grant as Grant;
    const server = createMcpServer(pool.get(grant));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(`[MCP] Request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });

  // Stateless server: no standalone SSE stream and no sessions to delete.
  app.all('/mcp', bearerAuth, (_req, res) => {
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  });

  return app;
}
