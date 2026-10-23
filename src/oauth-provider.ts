/**
 * Stateless OAuth 2.1 authorization server for MCP clients (Claude, ChatGPT, ...).
 *
 * The user signs in with their Kerio server, login and password. Those credentials are only
 * ever stored inside encrypted tokens held by the MCP client; the server persists nothing.
 */

import crypto from 'node:crypto';
import type { Response } from 'express';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { TokenSealer } from './sealed-token.js';
import type { KerioCredentials } from './types.js';

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;
const AUTH_REQUEST_TTL_SECONDS = 15 * 60;
const CODE_TTL_SECONDS = 5 * 60;

/** What a signed-in connection may do. Carried inside codes and tokens. */
export interface Grant {
  credentials: KerioCredentials;
  sendEnabled: boolean;
}

export interface PendingAuthorization {
  clientId: string;
  clientName?: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  scopes: string[];
  resource?: string;
}

interface CodePayload {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource?: string;
  grant: Grant;
}

interface TokenPayload {
  clientId: string;
  scopes: string[];
  resource?: string;
  grant: Grant;
}

export type RenderLoginPage = (res: Response, pending: PendingAuthorization, authRequest: string) => void;

export class StatelessOAuthProvider implements OAuthServerProvider {
  /** Hashes of redeemed authorization codes, kept only until the codes would expire anyway. */
  private readonly redeemedCodes = new Map<string, number>();

  constructor(
    private readonly sealer: TokenSealer,
    private readonly renderLoginPage: RenderLoginPage
  ) {}

  readonly clientsStore: OAuthRegisteredClientsStore = {
    getClient: (clientId) => {
      const opened = this.sealer.open<Omit<OAuthClientInformationFull, 'client_id'>>('client', clientId);
      return opened ? { ...opened.data, client_id: clientId } : undefined;
    },
    registerClient: (client) => {
      const { client_id: _ignored, ...metadata } = client as OAuthClientInformationFull;
      return { ...metadata, client_id: this.sealer.seal('client', metadata) };
    },
  };

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const pending: PendingAuthorization = {
      clientId: client.client_id,
      clientName: client.client_name,
      redirectUri: params.redirectUri,
      state: params.state,
      codeChallenge: params.codeChallenge,
      scopes: params.scopes ?? [],
      resource: params.resource?.href,
    };
    this.renderLoginPage(res, pending, this.sealer.seal('auth-request', pending, AUTH_REQUEST_TTL_SECONDS));
  }

  openAuthRequest(authRequest: string): PendingAuthorization | null {
    return this.sealer.open<PendingAuthorization>('auth-request', authRequest)?.data ?? null;
  }

  /** Called after the user signed in successfully; returns where to send the browser. */
  completeAuthorization(pending: PendingAuthorization, grant: Grant): string {
    const payload: CodePayload = {
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      scopes: pending.scopes,
      resource: pending.resource,
      grant,
    };
    const redirect = new URL(pending.redirectUri);
    redirect.searchParams.set('code', this.sealer.seal('code', payload, CODE_TTL_SECONDS));
    if (pending.state !== undefined) redirect.searchParams.set('state', pending.state);
    return redirect.href;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    return this.openCode(client, code).codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _codeVerifier?: string,
    redirectUri?: string
  ): Promise<OAuthTokens> {
    const payload = this.openCode(client, code);
    if (redirectUri !== undefined && redirectUri !== payload.redirectUri) {
      throw new InvalidGrantError('redirect_uri does not match the authorization request');
    }
    this.markRedeemed(code);
    return this.issueTokens({
      clientId: payload.clientId,
      scopes: payload.scopes,
      resource: payload.resource,
      grant: payload.grant,
    });
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const opened = this.sealer.open<TokenPayload>('refresh', refreshToken);
    if (!opened || opened.data.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid or expired refresh token');
    }
    return this.issueTokens(opened.data);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const opened = this.sealer.open<TokenPayload>('access', token);
    if (!opened) throw new InvalidTokenError('Invalid or expired access token');
    return {
      token,
      clientId: opened.data.clientId,
      scopes: opened.data.scopes,
      expiresAt: opened.exp,
      resource: opened.data.resource ? new URL(opened.data.resource) : undefined,
      extra: { grant: opened.data.grant },
    };
  }

  private issueTokens(payload: TokenPayload): OAuthTokens {
    return {
      access_token: this.sealer.seal('access', payload, ACCESS_TOKEN_TTL_SECONDS),
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: this.sealer.seal('refresh', payload, REFRESH_TOKEN_TTL_SECONDS),
      ...(payload.scopes.length > 0 ? { scope: payload.scopes.join(' ') } : {}),
    };
  }

  private openCode(client: OAuthClientInformationFull, code: string): CodePayload {
    const opened = this.sealer.open<CodePayload>('code', code);
    if (!opened || opened.data.clientId !== client.client_id || this.redeemedCodes.has(hash(code))) {
      throw new InvalidGrantError('Invalid, expired or already used authorization code');
    }
    return opened.data;
  }

  private markRedeemed(code: string): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.redeemedCodes) {
      if (expiresAt < now) this.redeemedCodes.delete(key);
    }
    this.redeemedCodes.set(hash(code), now + CODE_TTL_SECONDS * 1000);
  }
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
