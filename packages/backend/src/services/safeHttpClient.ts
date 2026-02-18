import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

type DnsLookupResult = Array<{ address: string }>;

export type SafeHttpOptions = {
  allowHttp?: boolean;
  allowPrivateIp?: boolean;
  allowedHosts?: Iterable<string>;
  timeoutMs?: number;
  userAgent?: string;
  dnsLookupImpl?: (hostname: string) => Promise<DnsLookupResult>;
  fetchImpl?: typeof fetch;
};

export class SafeHttpError extends Error {
  code: string;

  constructor(code: string, message?: string) {
    super(message || code);
    this.code = code;
  }
}

function normalizeAllowedHosts(raw?: Iterable<string>) {
  if (!raw) return new Set<string>();
  const hosts = new Set<string>();
  for (const value of raw) {
    const trimmed = String(value).trim().toLowerCase();
    if (trimmed) hosts.add(trimmed);
  }
  return hosts;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((value) => Number(value));
  if (parts.length !== 4) return true;
  if (
    parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return true;
  }
  const [a, b, c, d] = parts;
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fec0:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('ff')) return true;
  if (normalized.startsWith('2001:db8')) return true;
  if (normalized.startsWith('::ffff:')) {
    const tail = normalized.slice('::ffff:'.length);
    if (isIP(tail) === 4) return isPrivateIPv4(tail);
  }
  return false;
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIPv4(address);
  if (version === 6) return isPrivateIPv6(address);
  return true;
}

async function ensurePublicHost(
  hostname: string,
  lookupImpl: (hostname: string) => Promise<DnsLookupResult>,
) {
  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new SafeHttpError('private_ip_blocked');
  }
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new SafeHttpError('private_ip_blocked');
    }
    return;
  }
  let resolved: DnsLookupResult;
  try {
    resolved = await lookupImpl(hostname);
  } catch {
    throw new SafeHttpError('dns_lookup_failed');
  }
  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new SafeHttpError('dns_lookup_failed');
  }
  if (resolved.some((entry) => isPrivateAddress(entry.address))) {
    throw new SafeHttpError('private_ip_blocked');
  }
}

function resolveDnsLookup(
  custom?: (hostname: string) => Promise<DnsLookupResult>,
) {
  if (custom) return custom;
  return async (hostname: string) => {
    const resolved = await dnsLookup(hostname, { all: true, verbatim: true });
    return resolved.map(({ address }) => ({ address }));
  };
}

export async function validateExternalUrl(
  rawUrl: string,
  options: SafeHttpOptions = {},
) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeHttpError('invalid_url');
  }
  const protocol = url.protocol.toLowerCase();
  const allowHttp = options.allowHttp === true;
  if (protocol !== 'https:' && !(allowHttp && protocol === 'http:')) {
    throw new SafeHttpError('insecure_scheme');
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname) {
    throw new SafeHttpError('missing_hostname');
  }

  const allowedHosts = normalizeAllowedHosts(options.allowedHosts);
  if (allowedHosts.size > 0 && !allowedHosts.has(hostname)) {
    throw new SafeHttpError('host_not_allowed');
  }

  if (options.allowPrivateIp !== true) {
    await ensurePublicHost(hostname, resolveDnsLookup(options.dnsLookupImpl));
  }
  return url;
}

export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: SafeHttpOptions = {},
) {
  const validatedUrl = await validateExternalUrl(rawUrl, options);
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.floor(options.timeoutMs as number))
    : 5000;
  const fetchImpl = options.fetchImpl || fetch;
  const userAgent = (options.userAgent || '').trim() || 'ITDO_ERP4/0.1';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers || {});
    if (!headers.has('User-Agent')) {
      headers.set('User-Agent', userAgent);
    }
    return await fetchImpl(validatedUrl.toString(), {
      ...init,
      headers,
      redirect: 'error',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
