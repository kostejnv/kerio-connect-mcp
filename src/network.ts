/**
 * Outbound network policy for connections to Kerio servers.
 *
 * In HTTP mode, users type the Kerio server address themselves, so this server must not
 * become a proxy into private networks: only https, optional hostname allowlist, and
 * no loopback/private/link-local targets — checked again at connect time (DNS rebinding).
 */

import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import { Agent } from 'undici';
import type { NetworkConfig } from './config.js';

export class ServerNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerNotAllowedError';
  }
}

const nonPublicRanges = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  nonPublicRanges.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32],
] as const) {
  nonPublicRanges.addSubnet(address, prefix, 'ipv6');
}

export function isPublicAddress(address: string): boolean {
  const mappedIpv4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedIpv4) return isPublicAddress(mappedIpv4[1]);

  const family = net.isIP(address);
  if (family === 0) return false;
  return !nonPublicRanges.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Turns user input such as "mail.example.com" or "https://mail.example.com/webmail/"
 * into the server origin ("https://mail.example.com").
 */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ServerNotAllowedError('Invalid Kerio server address');
  }

  if (url.protocol !== 'https:') {
    throw new ServerNotAllowedError('Kerio server must use https');
  }
  if (url.username || url.password) {
    throw new ServerNotAllowedError('Kerio server address must not contain credentials');
  }
  return url.origin;
}

/** Checks that can be done without DNS; resolved addresses are checked by guardedLookup. */
export function assertServerAllowed(serverUrl: string, network: NetworkConfig): void {
  const hostname = new URL(serverUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (network.allowedServers.length > 0 && !network.allowedServers.includes(hostname)) {
    throw new ServerNotAllowedError(`Kerio server ${hostname} is not in the list of allowed servers`);
  }
  if (!network.allowPrivateNetwork && net.isIP(hostname) !== 0 && !isPublicAddress(hostname)) {
    throw new ServerNotAllowedError('Kerio server must not be on a private or local network');
  }
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: any, family?: number) => void;

function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, undefined);

    const blocked = addresses.find((entry) => !isPublicAddress(entry.address));
    if (blocked) {
      const blockedError: NodeJS.ErrnoException = new ServerNotAllowedError(
        `Kerio server ${hostname} resolves to a private or local address`
      );
      blockedError.code = 'EKERIO_BLOCKED_ADDRESS';
      return callback(blockedError, undefined);
    }

    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

/**
 * HTTP dispatcher used for all Kerio requests: certificate verification is always on
 * (system roots plus an optional company CA) and private targets are refused at connect time.
 */
export function createKerioDispatcher(network: NetworkConfig): Agent {
  return new Agent({
    connect: {
      ...(network.extraCaPem ? { ca: [...tls.rootCertificates, network.extraCaPem] } : {}),
      ...(network.allowPrivateNetwork ? {} : { lookup: guardedLookup }),
      timeout: network.requestTimeoutMs,
    },
    headersTimeout: network.requestTimeoutMs,
    bodyTimeout: network.requestTimeoutMs,
  });
}
