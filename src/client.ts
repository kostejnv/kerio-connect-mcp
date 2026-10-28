/**
 * Kerio Connect client JSON-RPC API (/webmail/api/jsonrpc), limited to mail reading and
 * saving drafts. It cannot send e-mail.
 *
 * Every request goes through an allowlist of API methods. Read requests may be repeated once
 * after a session renewal or a network error; draft writes are never repeated automatically.
 */

import { request, type Dispatcher } from 'undici';
import type { NetworkConfig } from './config.js';
import { assertServerAllowed } from './network.js';
import { PACKAGE_VERSION } from './version.js';
import type {
  EmailAddress,
  JsonRpcResponse,
  KerioAttachment,
  KerioCredentials,
  KerioError,
  KerioFolder,
  KerioMail,
  MailsGetByIdResult,
  MailsGetResult,
  MailsWriteResult,
  SearchCondition,
} from './types.js';

/** API methods the connector may call in read-only mode (besides Session.login). */
const READ_METHODS = new Set(['Folders.get', 'Mails.get', 'Mails.getById']);
/** Attachments may only be downloaded from this path of the connected Kerio server. */
const ATTACHMENT_PATH_PREFIX = '/webmail/api/download/attachment/';
/** Mails.create saves a new draft, Mails.set changes one; both only ever with send: false. */
const DRAFT_METHODS = new Set(['Mails.create', 'Mails.set']);
const DRAFT_FIELDS = new Set(['send', 'from', 'to', 'cc', 'bcc', 'subject', 'displayableParts', 'attachments', 'headers']);

// Kerio reports an expired or invalid session with these JSON-RPC codes; HTTP 401 is treated the same way.
const SESSION_ERROR_CODES = new Set([-32001, -32002, -32003]);

const MAIL_LIST_FIELDS = [
  'id', 'folderId', 'from', 'to', 'cc', 'subject', 'receiveDate', 'sendDate',
  'isSeen', 'isFlagged', 'isAnswered', 'isDraft', 'hasAttachment', 'size',
];

/** The Kerio server answered with an error. */
export class KerioApiError extends Error {
  constructor(message: string, public readonly code?: number) {
    super(message);
    this.name = 'KerioApiError';
  }
}

export class KerioSessionError extends KerioApiError {
  constructor(message: string, code?: number) {
    super(message, code);
    this.name = 'KerioSessionError';
  }
}

export class KerioLoginError extends KerioApiError {
  constructor(message: string, code?: number) {
    super(message, code);
    this.name = 'KerioLoginError';
  }
}

/** The request was refused locally by the connector's policy; nothing was sent to Kerio. */
export class KerioPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KerioPolicyError';
  }
}

/** No usable answer from the server (connection, TLS, timeout, malformed response). */
export class KerioTransportError extends Error {
  constructor(message: string, public readonly mayHaveReachedServer: boolean) {
    super(message);
    this.name = 'KerioTransportError';
  }
}

export class AttachmentTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Attachment is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
    this.name = 'AttachmentTooLargeError';
  }
}

// Errors raised before the request body could have been delivered.
const CONNECT_PHASE_ERROR_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'EKERIO_BLOCKED_ADDRESS',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function toTransportError(error: unknown): KerioTransportError {
  const cause = error as { code?: string; cause?: { code?: string }; message?: string };
  const code = cause?.code ?? cause?.cause?.code ?? '';
  const message = cause?.message ?? String(error);
  return new KerioTransportError(
    `Connection to Kerio failed: ${message}${code ? ` (${code})` : ''}`,
    !CONNECT_PHASE_ERROR_CODES.has(code)
  );
}

export interface DraftMail {
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  subject: string;
  html: string;
  /** Attachments of mails already in the mailbox; Kerio copies them into the draft. */
  attachments: KerioAttachment[];
  /** Message-ID of the mail this draft replies to. */
  inReplyTo?: string;
}

export interface KerioClientOptions {
  credentials: KerioCredentials;
  network: NetworkConfig;
  dispatcher: Dispatcher;
}

interface Session {
  token: string;
  /** Cookie header with all cookies set at login (SESSION_CONNECT_WEBMAIL and any others). */
  cookies: string;
}

function describeErrors(errors: KerioError[]): string {
  return errors.map((error) => `${error.message ?? 'Unknown error'} (code: ${error.code ?? 'N/A'})`).join('; ');
}

export class KerioClient {
  private readonly serverOrigin: string;
  private readonly apiUrl: string;
  private readonly credentials: KerioCredentials;
  private readonly dispatcher: Dispatcher;
  private session: Session | null = null;
  private pendingLogin: Promise<Session> | null = null;
  private requestId = 1;

  constructor(options: KerioClientOptions) {
    assertServerAllowed(options.credentials.server, options.network);
    this.credentials = options.credentials;
    this.serverOrigin = new URL(options.credentials.server).origin;
    this.apiUrl = `${this.serverOrigin}/webmail/api/jsonrpc`;
    this.dispatcher = options.dispatcher;
  }

  /** The login name; the mailbox address when the login is an e-mail address. */
  public get username(): string {
    return this.credentials.username;
  }

  /** Logs in (or reuses the current session). Throws KerioLoginError for rejected credentials. */
  public async ensureAuthenticated(): Promise<void> {
    await this.getSession();
  }

  public async getMailFolders(): Promise<KerioFolder[]> {
    const result = await this.read<{ list: KerioFolder[] }>('Folders.get', {});
    return result.list.filter((folder) => folder.type === 'FMail');
  }

  /** One page of mails from the given folders, newest first. totalItems counts all matches. */
  public async getMails(
    folderIds: string[],
    page: { start: number; limit: number; conditions?: SearchCondition[] }
  ): Promise<MailsGetResult> {
    const query: Record<string, unknown> = {
      fields: MAIL_LIST_FIELDS,
      start: page.start,
      limit: page.limit,
      orderBy: [{ columnName: 'receiveDate', direction: 'Desc', caseSensitive: true }],
    };
    if (page.conditions && page.conditions.length > 0) {
      query.conditions = page.conditions;
      query.combining = 'And';
    }
    const result = await this.read<MailsGetResult>('Mails.get', { folderIds, query });
    return { list: result.list ?? [], totalItems: result.totalItems ?? 0 };
  }

  /** Fetches mails directly by ID (works for any age of message), including text parts and attachments. */
  public async getMailsById(ids: string[]): Promise<MailsGetByIdResult> {
    const result = await this.read<MailsGetByIdResult>('Mails.getById', { ids });
    return { result: result.result ?? [], errors: result.errors ?? [] };
  }

  /**
   * Downloads an attachment by the URL Kerio reports for it. Only attachment downloads from the
   * connected server are allowed; the size is capped while reading.
   */
  public async downloadAttachment(url: string, maxBytes: number): Promise<Buffer> {
    const target = new URL(url, this.serverOrigin);
    if (target.origin !== this.serverOrigin || !target.pathname.startsWith(ATTACHMENT_PATH_PREFIX)) {
      throw new KerioPolicyError('Attachment URL is not an attachment download of the connected Kerio server');
    }

    const session = await this.getSession();
    try {
      return await this.download(target.href, session, maxBytes);
    } catch (error) {
      if (!(error instanceof KerioSessionError)) throw error;
      this.dropSession(session);
      return this.download(target.href, await this.getSession(), maxBytes);
    }
  }

  /** Saves a new draft in the Drafts folder and returns its ID. Never sends. */
  public async createDraft(draft: DraftMail): Promise<string> {
    const result = await this.writeDraft('Mails.create', this.draftFields(draft));
    const id = result.result?.[0]?.id;
    if (!id) throw new KerioApiError('Kerio did not return the ID of the saved draft');
    return id;
  }

  /** Replaces the content of an existing draft. Never sends. */
  public async updateDraft(id: string, draft: DraftMail): Promise<void> {
    await this.writeDraft('Mails.set', { id, ...this.draftFields(draft) });
  }

  private draftFields(draft: DraftMail): Record<string, unknown> {
    const addresses = (list: EmailAddress[]) => list.map(({ address, name }) => ({ address: address ?? '', name: name ?? '' }));
    return {
      send: false,
      ...(this.credentials.username.includes('@') ? { from: { address: this.credentials.username, name: '' } } : {}),
      to: addresses(draft.to),
      cc: addresses(draft.cc),
      bcc: addresses(draft.bcc),
      subject: draft.subject,
      displayableParts: [{ contentType: 'ctTextHtml', content: draft.html }],
      attachments: draft.attachments.map(({ id, name, contentType, size }) => ({ id, name, contentType, size })),
      ...(draft.inReplyTo ? { headers: [{ type: 'mhInReplayTo', value: draft.inReplyTo }] } : {}),
    };
  }

  /**
   * Draft write: renews an expired session with a harmless read first, then writes once.
   * Not repeated, so an unclear outcome never leaves two copies of a draft.
   */
  private async writeDraft(method: string, mail: Record<string, unknown>): Promise<MailsWriteResult> {
    await this.read('Folders.get', {});
    const result = await this.post<MailsWriteResult>(method, { mails: [mail] }, this.session);
    if ((result.errors ?? []).length > 0) {
      throw new KerioApiError(`Kerio did not save the draft: ${describeErrors(result.errors)}`);
    }
    return result;
  }

  /** Read request: allowlisted, repeated once after session renewal or a network error. */
  private async read<T>(method: string, params: unknown): Promise<T> {
    if (!READ_METHODS.has(method)) {
      throw new KerioPolicyError(`Kerio API method ${method} is not allowed`);
    }

    const session = await this.getSession();
    try {
      return await this.post<T>(method, params, session);
    } catch (error) {
      if (error instanceof KerioSessionError) {
        this.dropSession(session);
      } else if (!(error instanceof KerioTransportError)) {
        throw error;
      }
      return this.post<T>(method, params, await this.getSession());
    }
  }

  private dropSession(session: Session): void {
    if (this.session === session) this.session = null;
  }

  private async getSession(): Promise<Session> {
    if (this.session) return this.session;
    if (!this.pendingLogin) {
      this.pendingLogin = this.login().finally(() => {
        this.pendingLogin = null;
      });
    }
    return this.pendingLogin;
  }

  private async login(): Promise<Session> {
    const params = {
      userName: this.credentials.username,
      password: this.credentials.password,
      application: { name: 'Kerio MCP Server', vendor: 'MCP', version: PACKAGE_VERSION },
    };

    let token: string | undefined;
    const cookies = new Map<string, string>();
    try {
      const result = await this.post<{ token?: string }>('Session.login', params, null, (headers) => {
        const setCookie = headers['set-cookie'];
        for (const value of Array.isArray(setCookie) ? setCookie : [setCookie ?? '']) {
          const pair = value.match(/^\s*([^=;\s]+)=([^;]*)/);
          if (pair) cookies.set(pair[1], pair[2]);
        }
      });
      token = result.token;
    } catch (error) {
      if (error instanceof KerioApiError) {
        throw new KerioLoginError(`Kerio login failed: ${error.message}`, error.code);
      }
      throw error;
    }

    if (!token || !cookies.has('SESSION_CONNECT_WEBMAIL')) {
      throw new KerioLoginError('Kerio login failed: the server did not return a session');
    }
    this.session = { token, cookies: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') };
    return this.session;
  }

  private sessionHeaders(session: Session): Record<string, string> {
    return { Cookie: session.cookies, 'X-Token': session.token };
  }

  private async download(url: string, session: Session, maxBytes: number): Promise<Buffer> {
    let response: Dispatcher.ResponseData;
    try {
      response = await request(url, { method: 'GET', headers: this.sessionHeaders(session), dispatcher: this.dispatcher });
    } catch (error) {
      throw toTransportError(error);
    }

    if (response.statusCode === 401 || response.statusCode === 403) {
      await response.body.dump();
      throw new KerioSessionError(`Kerio refused the download (HTTP ${response.statusCode})`);
    }
    if (response.statusCode !== 200) {
      await response.body.dump();
      throw new KerioApiError(`Attachment download failed (HTTP ${response.statusCode})`);
    }
    if (Number(response.headers['content-length'] ?? 0) > maxBytes) {
      response.body.destroy();
      throw new AttachmentTooLargeError(maxBytes);
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) {
        response.body.destroy();
        throw new AttachmentTooLargeError(maxBytes);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  private async post<T>(
    method: string,
    params: unknown,
    session: Session | null,
    onHeaders?: (headers: Record<string, string | string[] | undefined>) => void
  ): Promise<T> {
    if (DRAFT_METHODS.has(method)) {
      assertDraftOnly(method, params);
    } else if (method !== 'Session.login' && !READ_METHODS.has(method)) {
      throw new KerioPolicyError(`Kerio API method ${method} is not allowed`);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (session) Object.assign(headers, this.sessionHeaders(session));

    let response: Dispatcher.ResponseData;
    try {
      response = await request(this.apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: this.requestId++, method, params }),
        dispatcher: this.dispatcher,
      });
    } catch (error) {
      throw toTransportError(error);
    }

    onHeaders?.(response.headers);

    let data: JsonRpcResponse<T>;
    try {
      data = (await response.body.json()) as JsonRpcResponse<T>;
    } catch (error) {
      if (response.statusCode === 401) {
        throw new KerioSessionError('Kerio session is not valid (HTTP 401)');
      }
      throw new KerioTransportError(`Unexpected response from Kerio (HTTP ${response.statusCode})`, true);
    }

    if (data.error) {
      const message = `Kerio API error: ${data.error.message} (code: ${data.error.code})`;
      if (SESSION_ERROR_CODES.has(data.error.code) || response.statusCode === 401) {
        throw new KerioSessionError(message, data.error.code);
      }
      throw new KerioApiError(message, data.error.code);
    }
    if (data.result === undefined || data.result === null) {
      throw new KerioTransportError(`Kerio returned no result (HTTP ${response.statusCode})`, true);
    }
    return data.result;
  }
}

/**
 * Mails.create and Mails.set may only save exactly one draft: send must be false, and only draft
 * content fields are allowed. Mails.set must name the draft; Mails.create must not.
 */
function assertDraftOnly(method: string, params: unknown): void {
  const mails = (params as { mails?: unknown[] })?.mails;
  const mail = Array.isArray(mails) && mails.length === 1 ? (mails[0] as Record<string, unknown>) : null;
  const allowedKeys = method === 'Mails.set' ? new Set([...DRAFT_FIELDS, 'id']) : DRAFT_FIELDS;
  const isDraft =
    mail !== null &&
    mail.send === false &&
    (method === 'Mails.set') === (typeof mail.id === 'string' && mail.id !== '') &&
    Object.keys(mail).every((key) => allowedKeys.has(key));
  if (!isDraft) {
    throw new KerioPolicyError(`${method} is only allowed for saving a single draft, never for sending`);
  }
}
