/**
 * Configuration for the Kerio Connect MCP server, read from environment variables.
 *
 * Two transports:
 * - http  (deployment): users sign in through OAuth with their own Kerio server, login and password.
 *                       No Kerio credentials live in the server configuration.
 * - stdio (local use):  one mailbox configured through KERIO_SERVER / KERIO_USERNAME / KERIO_PASSWORD.
 */

import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * Boolean switch that only accepts "true" or "false".
 * Anything else fails startup, so a typo can never silently enable a feature.
 */
const strictBoolean = (name: string) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '' || value === 'false') return false;
      if (value === 'true') return true;
      ctx.addIssue({ code: 'custom', message: `${name} must be "true" or "false"` });
      return z.NEVER;
    });

const optionalList = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );

const CommonEnvSchema = z.object({
  MCP_TRANSPORT: z.enum(['stdio', 'http']).optional().default('stdio'),
  KERIO_CA_FILE: z.string().optional(),
  KERIO_ALLOWED_SERVERS: optionalList,
  KERIO_ALLOW_PRIVATE_NETWORK: strictBoolean('KERIO_ALLOW_PRIVATE_NETWORK'),
  KERIO_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(30_000),
});

const HttpEnvSchema = z.object({
  PUBLIC_URL: z.string().url('PUBLIC_URL must be the public https URL of this server'),
  PORT: z.coerce.number().int().positive().optional().default(3000),
  MCP_TOKEN_KEY: z.string().min(1, 'MCP_TOKEN_KEY is required (generate with: openssl rand -base64 32)'),
});

const StdioEnvSchema = z.object({
  KERIO_SERVER: z.string().min(1, 'KERIO_SERVER is required'),
  KERIO_USERNAME: z.string().min(1, 'KERIO_USERNAME is required'),
  KERIO_PASSWORD: z.string().min(1, 'KERIO_PASSWORD is required'),
});

export interface NetworkConfig {
  /** Extra trusted CA certificates (PEM), added to the system roots. */
  extraCaPem?: string;
  /** Hostnames users may connect to. Empty means any public host. */
  allowedServers: string[];
  /** Allow Kerio servers on loopback/private addresses (local development only). */
  allowPrivateNetwork: boolean;
  requestTimeoutMs: number;
}

export interface HttpConfig {
  transport: 'http';
  network: NetworkConfig;
  publicUrl: URL;
  port: number;
  tokenKey: Buffer;
}

export interface StdioConfig {
  transport: 'stdio';
  network: NetworkConfig;
  credentials: { server: string; username: string; password: string };
}

export type AppConfig = HttpConfig | StdioConfig;

function parseOrThrow<T extends z.ZodType>(schema: T, env: NodeJS.ProcessEnv): z.output<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const messages = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Configuration validation failed:\n${messages.join('\n')}`);
  }
  return result.data;
}

export function parseTokenKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error('MCP_TOKEN_KEY must be 32 random bytes encoded as base64 (openssl rand -base64 32)');
  }
  return key;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const common = parseOrThrow(CommonEnvSchema, env);
  const network: NetworkConfig = {
    extraCaPem: common.KERIO_CA_FILE ? readFileSync(common.KERIO_CA_FILE, 'utf8') : undefined,
    allowedServers: common.KERIO_ALLOWED_SERVERS,
    allowPrivateNetwork: common.KERIO_ALLOW_PRIVATE_NETWORK,
    requestTimeoutMs: common.KERIO_REQUEST_TIMEOUT_MS,
  };

  if (common.MCP_TRANSPORT === 'http') {
    const http = parseOrThrow(HttpEnvSchema, env);
    return {
      transport: 'http',
      network,
      publicUrl: new URL(http.PUBLIC_URL),
      port: http.PORT,
      tokenKey: parseTokenKey(http.MCP_TOKEN_KEY),
    };
  }

  const stdio = parseOrThrow(StdioEnvSchema, env);
  return {
    transport: 'stdio',
    network,
    credentials: {
      server: stdio.KERIO_SERVER,
      username: stdio.KERIO_USERNAME,
      password: stdio.KERIO_PASSWORD,
    },
  };
}
