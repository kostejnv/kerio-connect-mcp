/**
 * Remote MCP endpoint (Streamable HTTP) protected by the stateless OAuth provider.
 *
 *   /mcp                      MCP endpoint (Bearer token)
 *   /authorize, /token, ...   OAuth endpoints provided by the MCP SDK
 *   /login                    sign-in form submission
 *   /download/:ticket/:name   attachment download by a short-lived sealed link
 *   /healthz                  liveness check
 *   /, /assets/*              landing page describing the server
 */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Dispatcher } from 'undici';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { KerioClient, KerioLoginError, KerioTransportError } from './client.js';
import type { HttpConfig } from './config.js';
import { MAX_ATTACHMENT_BYTES } from './attachment-text.js';
import { sendErrorPage, sendLoginPage, type LocalizedText } from './login-page.js';
import { DOWNLOAD_LINK_MINUTES, MAX_ZIP_BYTES, type DownloadLinkIssuer } from './mail-tools.js';
import { createMcpServer } from './mcp-server.js';
import { normalizeServerUrl, ServerNotAllowedError } from './network.js';
import { StatelessOAuthProvider, type Grant } from './oauth-provider.js';
import { TokenSealer } from './sealed-token.js';
import { createZip, uniqueNames } from './zip.js';

const IDLE_CLIENT_TTL_MS = 30 * 60 * 1000;
const PUBLIC_DIR = new URL('../public/', import.meta.url);

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
  // The master switch applies to every request, so turning it off also covers connections granted sending earlier.
  const newClient = (grant: Grant) =>
    new KerioClient({
      credentials: grant.credentials,
      network: config.network,
      dispatcher,
      sendEnabled: config.allowSend && grant.sendEnabled,
    });
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

  // Landing page for people who open the server address in a browser.
  const landingPage = readFileSync(new URL('index.html', PUBLIC_DIR), 'utf8')
    .replaceAll('%MCP_URL%', escapeHtml(mcpUrl.href))
    .replaceAll('%HOST%', escapeHtml(config.publicUrl.host));
  app.get('/', (_req, res) => {
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    }).send(landingPage);
  });
  app.use('/assets', express.static(fileURLToPath(PUBLIC_DIR), { index: false, maxAge: '1h' }));

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
    const issueDownloadLink: DownloadLinkIssuer = ({ mailId, attachments, zip, fileName }) => {
      const ticket: DownloadTicket = { credentials: grant.credentials, mailId, attachments, zip, fileName };
      const sealed = sealer.seal('download', ticket, DOWNLOAD_LINK_MINUTES * 60);
      return new URL(`/download/${sealed}/${encodeURIComponent(fileName)}`, config.publicUrl).href;
    };
    const server = createMcpServer(pool.get(grant), { issueDownloadLink });
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

  // The ticket is the authorization: sealed, short-lived, for the attachments of one mail only.
  app.get(
    '/download/:ticket/:name',
    rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }),
    async (req: Request, res: Response) => {
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
      const ticket = sealer.open<DownloadTicket>('download', String(req.params.ticket))?.data;
      if (!ticket) {
        res.status(404).type('text/plain').send('This download link has expired or is invalid. Ask the assistant for a new link.');
        return;
      }

      try {
        const file = await downloadTicketFile(pool.get({ credentials: ticket.credentials, sendEnabled: false }), ticket);
        res.set({
          'Content-Type': file.contentType,
          'Content-Disposition': contentDisposition(file.name),
          'Content-Length': String(file.data.length),
          'Content-Security-Policy': "sandbox; default-src 'none'",
        });
        res.send(file.data);
      } catch (error) {
        console.error(`[Download] Failed: ${error instanceof Error ? error.name : 'Error'}`);
        const status = error instanceof KerioLoginError ? 403 : error instanceof DownloadNotFoundError ? 404 : 502;
        res.status(status).type('text/plain').send(
          error instanceof KerioLoginError
            ? 'Signing in to Kerio failed (was the password changed?). Connect the assistant again.'
            : error instanceof DownloadNotFoundError
              ? error.message
              : 'The attachment could not be downloaded from Kerio. Try again later.'
        );
      }
    }
  );

  return app;
}

interface DownloadTicket {
  credentials: Grant['credentials'];
  mailId: string;
  /** 1-based attachment numbers as listed by mail_get. */
  attachments: number[];
  zip: boolean;
  fileName: string;
}

class DownloadNotFoundError extends Error {}

/** Fetches the ticket's attachment(s) from Kerio now: one file as it is, or several bundled into a ZIP. */
async function downloadTicketFile(client: KerioClient, ticket: DownloadTicket) {
  const { result } = await client.getMailsById([ticket.mailId]);
  const mail = result.find((item) => item.id === ticket.mailId);
  const attachments = ticket.attachments.map((number) => mail?.attachments?.[number - 1]);
  if (!mail || attachments.some((attachment) => !attachment?.url)) {
    throw new DownloadNotFoundError('The e-mail or attachment no longer exists.');
  }

  const files = [];
  let total = 0;
  for (const attachment of attachments) {
    const data = await client.downloadAttachment(attachment!.url!, MAX_ATTACHMENT_BYTES);
    total += data.length;
    if (total > MAX_ZIP_BYTES) throw new DownloadNotFoundError('The attachments are too large to download together.');
    files.push({ name: attachment!.name || 'attachment', contentType: attachment!.contentType, data });
  }

  if (ticket.zip) {
    const names = uniqueNames(files.map((file) => file.name));
    return { name: ticket.fileName, contentType: 'application/zip', data: createZip(files.map((file, i) => ({ name: names[i], data: file.data }))) };
  }
  const [file] = files;
  const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(file.contentType?.split(';')[0].trim() ?? '')
    ? file.contentType!.split(';')[0].trim()
    : 'application/octet-stream';
  return { name: ticket.fileName, contentType, data: file.data };
}

/** attachment; filename="ascii fallback"; filename*=UTF-8''exact name */
function contentDisposition(name: string): string {
  const ascii = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\- ()]+/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
