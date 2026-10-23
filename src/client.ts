/**
 * Kerio Connect client JSON-RPC API (/webmail/api/jsonrpc), limited to mail reading and,
 * when explicitly enabled, sending.
 *
 * Every request goes through an allowlist of API methods. Read requests may be repeated once
 * after a session renewal or a network error; sending is never repeated automatically.
 */

import { request, type Dispatcher } from 'undici';
import type { NetworkConfig } from './config.js';
import { assertServerAllowed } from './network.js';
import { PACKAGE_VERSION } from './version.js';
import type {
  JsonRpcResponse,
  KerioCredentials,
  KerioError,
  KerioFolder,
  KerioMail,
  MailsCreateResult,
  MailsGetByIdResult,
  MailsGetResult,
  SearchCondition,
} from './types.js';

/** API methods the connector may call in read-only mode (besides Session.login). */
const READ_METHODS = new Set(['Folders.get', 'Mails.get', 'Mails.getById']);
const SEND_METHOD = 'Mails.create';
const OUTGOING_MAIL_FIELDS = new Set(['send', 'from', 'to', 'cc', 'bcc', 'subject', 'displayableParts']);

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

export type SendOutcome =
  | { status: 'sent' }
  | { status: 'sent_with_warnings'; warnings: string[] }
  | { status: 'failed'; reason: string }
  | { status: 'not_sent'; reason: string }
  | { status: 'unknown'; reason: string };

export interface OutgoingMail {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
}

export interface KerioClientOptions {
  credentials: KerioCredentials;
  network: NetworkConfig;
  dispatcher: Dispatcher;
  sendEnabled: boolean;
}

interface Session {
  token: string;
  cookie: string;
}

function describeErrors(errors: KerioError[]): string {
  return errors.map((error) => `${error.message ?? 'Unknown error'} (code: ${error.code ?? 'N/A'})`).join('; ');
}

export class KerioClient {
  private readonly apiUrl: string;
  private readonly credentials: KerioCredentials;
  private readonly dispatcher: Dispatcher;
  public readonly sendEnabled: boolean;
  private session: Session | null = null;
  private pendingLogin: Promise<Session> | null = null;
  private requestId = 1;

  constructor(options: KerioClientOptions) {
    assertServerAllowed(options.credentials.server, options.network);
    this.credentials = options.credentials;
    this.apiUrl = `${options.credentials.server.replace(/\/$/, '')}/webmail/api/jsonrpc`;
    this.dispatcher = options.dispatcher;
    this.sendEnabled = options.sendEnabled;
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

  /** Fetches mails directly by ID (works for any age of message). */
  public async getMailsById(ids: string[]): Promise<MailsGetByIdResult> {
    const result = await this.read<MailsGetByIdResult>('Mails.getById', { ids });
    return { result: result.result ?? [], errors: result.errors ?? [] };
  }

  /**
   * Sends one plain-text mail. Never retried: an unclear result is reported as "unknown".
   */
  public async sendMail(mail: OutgoingMail): Promise<SendOutcome> {
    if (!this.sendEnabled) {
      throw new KerioPolicyError('Sending e-mail is disabled for this connection.');
    }

    const toAddresses = (list: string[] = []) => list.map((address) => ({ address, name: '' }));
    const params = {
      mails: [{
        send: true,
        ...(this.credentials.username.includes('@') ? { from: { address: this.credentials.username, name: '' } } : {}),
        to: toAddresses(mail.to),
        cc: toAddresses(mail.cc),
        bcc: toAddresses(mail.bcc),
        subject: mail.subject,
        displayableParts: [{ contentType: 'ctTextPlain', content: mail.body }],
      }],
    };

    // Renew an expired session with a harmless read first, so the send itself needs no retry.
    await this.read('Folders.get', {});

    let result: MailsCreateResult;
    try {
      result = await this.post<MailsCreateResult>(SEND_METHOD, params, this.session);
    } catch (error) {
      if (error instanceof KerioTransportError) {
        return error.mayHaveReachedServer
          ? { status: 'unknown', reason: error.message }
          : { status: 'not_sent', reason: error.message };
      }
      if (error instanceof KerioSessionError) {
        return { status: 'not_sent', reason: `Kerio session was not accepted: ${error.message}` };
      }
      if (error instanceof KerioApiError) {
        return { status: 'failed', reason: error.message };
      }
      throw error;
    }

    const errors = result.errors ?? [];
    if (errors.length === 0) {
      return { status: 'sent' };
    }
    const partialSuccess = errors.some((error) => /partial/i.test(`${error.code ?? ''} ${error.message ?? ''}`));
    if (partialSuccess) {
      return { status: 'sent_with_warnings', warnings: errors.map((error) => error.message ?? String(error.code)) };
    }
    return { status: 'failed', reason: describeErrors(errors) };
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
    let cookie: string | undefined;
    try {
      const result = await this.post<{ token?: string }>('Session.login', params, null, (headers) => {
        const setCookie = headers['set-cookie'];
        for (const value of Array.isArray(setCookie) ? setCookie : [setCookie ?? '']) {
          cookie = value.match(/SESSION_CONNECT_WEBMAIL=([^;]+)/)?.[1] ?? cookie;
        }
      });
      token = result.token;
    } catch (error) {
      if (error instanceof KerioApiError) {
        throw new KerioLoginError(`Kerio login failed: ${error.message}`, error.code);
      }
      throw error;
    }

    if (!token || !cookie) {
      throw new KerioLoginError('Kerio login failed: the server did not return a session');
    }
    this.session = { token, cookie };
    return this.session;
  }

  private async post<T>(
    method: string,
    params: unknown,
    session: Session | null,
    onHeaders?: (headers: Record<string, string | string[] | undefined>) => void
  ): Promise<T> {
    if (method === SEND_METHOD) {
      this.assertOutgoingMail(params);
    } else if (method !== 'Session.login' && !READ_METHODS.has(method)) {
      throw new KerioPolicyError(`Kerio API method ${method} is not allowed`);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (session) {
      headers['Cookie'] = `SESSION_CONNECT_WEBMAIL=${session.cookie}`;
      headers['X-Token'] = session.token;
    }

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

  /** Mails.create is only allowed for sending exactly one new mail, never for drafts or templates. */
  private assertOutgoingMail(params: unknown): void {
    if (!this.sendEnabled) {
      throw new KerioPolicyError('Sending e-mail is disabled for this connection.');
    }
    const mails = (params as { mails?: unknown[] })?.mails;
    const mail = Array.isArray(mails) && mails.length === 1 ? (mails[0] as Record<string, unknown>) : null;
    const isPlainOutgoingMail =
      mail !== null &&
      mail.send === true &&
      Object.keys(mail).every((key) => OUTGOING_MAIL_FIELDS.has(key));
    if (!isPlainOutgoingMail) {
      throw new KerioPolicyError('Mails.create is only allowed for sending a single new e-mail');
    }
  }
}
