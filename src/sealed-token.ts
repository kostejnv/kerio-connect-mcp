/**
 * Encrypted, self-contained tokens (AES-256-GCM).
 *
 * The OAuth layer keeps no server-side state: client registrations, authorization codes and
 * access/refresh tokens are sealed payloads that only this server can open. Each token type
 * uses its own purpose as associated data, so a token of one type is never accepted as another.
 */

import crypto from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type TokenPurpose = 'client' | 'auth-request' | 'code' | 'access' | 'refresh' | 'download';

interface Envelope<T> {
  exp?: number;
  data: T;
}

export class TokenSealer {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('Token key must be 32 bytes');
  }

  /** @param ttlSeconds omit for tokens without expiry */
  seal<T>(purpose: TokenPurpose, data: T, ttlSeconds?: number): string {
    const envelope: Envelope<T> = {
      ...(ttlSeconds ? { exp: Math.floor(Date.now() / 1000) + ttlSeconds } : {}),
      data,
    };
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`kerio-mcp:${purpose}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(envelope), 'utf8'), cipher.final()]);
    return `${VERSION}.${Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64url')}`;
  }

  /** Returns the payload and its expiry, or null for tampered, foreign, expired or malformed tokens. */
  open<T>(purpose: TokenPurpose, token: string): { data: T; exp?: number } | null {
    const [version, encoded] = token.split('.');
    if (version !== VERSION || !encoded) return null;

    try {
      const raw = Buffer.from(encoded, 'base64url');
      if (raw.length <= IV_BYTES + TAG_BYTES) return null;
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, IV_BYTES));
      decipher.setAAD(Buffer.from(`kerio-mcp:${purpose}`));
      decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
      const plaintext = Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]);
      const envelope = JSON.parse(plaintext.toString('utf8')) as Envelope<T>;

      if (envelope.exp !== undefined && envelope.exp < Math.floor(Date.now() / 1000)) return null;
      return { data: envelope.data, exp: envelope.exp };
    } catch {
      return null;
    }
  }
}
