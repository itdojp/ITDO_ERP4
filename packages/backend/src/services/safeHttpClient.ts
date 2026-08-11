import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';

export type DnsLookupResult = Array<{ address: string; family?: number }>;

type ValidatedExternalUrl = {
  url: URL;
  pinnedAddresses: DnsLookupResult;
};

export type SafeHttpOptions = {
  allowHttp?: boolean;
  allowPrivateIp?: boolean;
  allowedHosts?: Iterable<string>;
  timeoutMs?: number;
  userAgent?: string;
  dnsLookupImpl?: (hostname: string) => Promise<DnsLookupResult>;
};

export class SafeHttpError extends Error {
  code: string;
  status: number | null;

  constructor(code: string, message?: string, status: number | null = null) {
    super(message || code);
    this.code = code;
    this.status = status;
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

const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::', 96],
  // Reject every IPv4-mapped address. Node may otherwise translate a compact
  // mapped literal such as ::ffff:7f00:1 into a loopback socket destination.
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blockedIpv6.addSubnet(network, prefix, 'ipv6');
}

function isPrivateIPv6(ip: string): boolean {
  try {
    return blockedIpv6.check(ip, 'ipv6');
  } catch {
    return true;
  }
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIPv4(address);
  if (version === 6) return isPrivateIPv6(address);
  return true;
}

function normalizeResolvedAddresses(resolved: DnsLookupResult) {
  return resolved.map((entry) => {
    const version = isIP(entry.address);
    const declaredFamily = entry.family ?? version;
    return {
      address: entry.address,
      family:
        (version === 4 || version === 6) && declaredFamily === version
          ? version
          : 0,
    };
  });
}

async function ensurePublicHost(
  hostname: string,
  lookupImpl: (hostname: string) => Promise<DnsLookupResult>,
): Promise<DnsLookupResult> {
  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new SafeHttpError('private_ip_blocked');
  }
  const literalVersion = isIP(hostname);
  if (literalVersion) {
    if (isPrivateAddress(hostname)) {
      throw new SafeHttpError('private_ip_blocked');
    }
    return [{ address: hostname, family: literalVersion }];
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
  const normalized = normalizeResolvedAddresses(resolved);
  if (
    normalized.some((entry) => !entry.family || isPrivateAddress(entry.address))
  ) {
    throw new SafeHttpError('private_ip_blocked');
  }
  return normalized;
}

async function resolvePermittedHost(
  hostname: string,
  lookupImpl: (hostname: string) => Promise<DnsLookupResult>,
): Promise<DnsLookupResult> {
  const literalVersion = isIP(hostname);
  if (literalVersion) {
    return [{ address: hostname, family: literalVersion }];
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
  const normalized = normalizeResolvedAddresses(resolved);
  if (normalized.some((entry) => !entry.family)) {
    throw new SafeHttpError('dns_lookup_failed');
  }
  return normalized;
}

function resolveDnsLookup(
  custom?: (hostname: string) => Promise<DnsLookupResult>,
) {
  if (custom) return custom;
  return async (hostname: string) => {
    const resolved = await dnsLookup(hostname, { all: true, verbatim: true });
    return resolved.map(({ address, family }) => ({ address, family }));
  };
}

async function validateExternalUrlForFetch(
  rawUrl: string,
  options: SafeHttpOptions = {},
): Promise<ValidatedExternalUrl> {
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
  const rawHostname = url.hostname.toLowerCase();
  const hostname =
    rawHostname.startsWith('[') && rawHostname.endsWith(']')
      ? rawHostname.slice(1, -1)
      : rawHostname;
  if (!hostname) {
    throw new SafeHttpError('missing_hostname');
  }

  const allowedHosts = normalizeAllowedHosts(options.allowedHosts);
  if (allowedHosts.size > 0 && !allowedHosts.has(hostname)) {
    throw new SafeHttpError('host_not_allowed');
  }

  const lookup = resolveDnsLookup(options.dnsLookupImpl);
  const pinnedAddresses =
    options.allowPrivateIp === true
      ? await resolvePermittedHost(hostname, lookup)
      : await ensurePublicHost(hostname, lookup);
  return { url, pinnedAddresses };
}

export async function validateExternalUrl(
  rawUrl: string,
  options: SafeHttpOptions = {},
) {
  const { url } = await validateExternalUrlForFetch(rawUrl, options);
  return url;
}

export function createPinnedLookupForTest(pinnedAddresses: DnsLookupResult) {
  const normalized = normalizeResolvedAddresses(pinnedAddresses).filter(
    (entry) => entry.family === 4 || entry.family === 6,
  );
  if (normalized.length === 0) return undefined;
  return (
    _hostname: string,
    options: number | { all?: boolean; family?: number | string },
    callback: (
      error: NodeJS.ErrnoException | null,
      address?: string | DnsLookupResult,
      family?: number,
    ) => void,
  ) => {
    const requestedFamily =
      typeof options === 'number'
        ? options
        : options?.family === 'IPv4'
          ? 4
          : options?.family === 'IPv6'
            ? 6
            : Number(options?.family || 0);
    const matching = requestedFamily
      ? normalized.filter((entry) => entry.family === requestedFamily)
      : normalized;
    if (matching.length === 0) {
      const error = new Error(
        'pinned address family unavailable',
      ) as NodeJS.ErrnoException;
      error.code = 'EAI_ADDRFAMILY';
      callback(error);
      return;
    }
    if (typeof options === 'object' && options?.all === true) {
      callback(
        null,
        matching.map((entry) => ({
          address: entry.address,
          family: entry.family,
        })),
      );
      return;
    }
    const pinned = matching.find((entry) => entry.family === 4) ?? matching[0];
    callback(null, pinned.address, pinned.family);
  };
}

async function requestBodyToBuffer(body: RequestInit['body']) {
  if (body == null) return undefined;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }
  throw new SafeHttpError('unsupported_body');
}

function headersToObject(headers: Headers) {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

function responseHeadersFromNode(
  headers: Record<string, number | string | string[] | undefined>,
) {
  const output = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) output.append(key, item);
    } else {
      output.set(key, String(value));
    }
  }
  return output;
}

async function withPreDispatchTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new SafeHttpError('pre_dispatch_timeout')),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, expired]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function pinnedRequestFetch(
  url: URL,
  init: RequestInit,
  options: {
    body: Buffer | undefined;
    pinnedAddresses: DnsLookupResult;
    timeoutMs: number;
    headers: Headers;
    onResponseSettled: () => void;
  },
) {
  const body = options.body;
  const requestImpl = url.protocol === 'http:' ? httpRequest : httpsRequest;
  const lookup = createPinnedLookupForTest(options.pinnedAddresses);

  return await new Promise<Response>((resolve, reject) => {
    const request = requestImpl(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: init.method || (body ? 'POST' : 'GET'),
        headers: headersToObject(options.headers),
        lookup: lookup as any,
      },
      (response) => {
        const responseSettled = () => options.onResponseSettled();
        response.once('end', responseSettled);
        response.once('close', responseSettled);
        response.once('error', responseSettled);
        const callerSignal = init.signal;
        const abortResponse = () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          response.destroy(error);
        };
        if (callerSignal) {
          if (callerSignal.aborted) {
            abortResponse();
          } else {
            callerSignal.addEventListener('abort', abortResponse, {
              once: true,
            });
            response.once('close', () => {
              callerSignal.removeEventListener('abort', abortResponse);
            });
          }
        }
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400) {
          response.destroy();
          reject(new SafeHttpError('redirect_blocked', undefined, status));
          return;
        }
        try {
          const responseInit = {
            status,
            statusText: response.statusMessage,
            headers: responseHeadersFromNode(response.headers),
          };
          if (status === 204 || status === 205) {
            response.destroy();
            resolve(new Response(null, responseInit));
            return;
          }
          const webStream = Readable.toWeb(response) as unknown as BodyInit;
          resolve(new Response(webStream, responseInit));
        } catch {
          response.destroy();
          reject(new SafeHttpError('invalid_response'));
        }
      },
    );
    request.on('error', reject);
    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new SafeHttpError('request_timeout'));
    });

    const callerSignal = init.signal;
    const abortFromCaller = () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      request.destroy(error);
    };
    if (callerSignal) {
      if (callerSignal.aborted) {
        abortFromCaller();
      } else {
        callerSignal.addEventListener('abort', abortFromCaller, { once: true });
        request.on('close', () => {
          callerSignal.removeEventListener('abort', abortFromCaller);
        });
      }
    }

    if (body) request.write(body);
    request.end();
  });
}

export type PreparedSafeHttpRequest = {
  /** A prepared request is single-use so callers cannot accidentally retry. */
  dispatch(): Promise<Response>;
};

export async function prepareSafeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: SafeHttpOptions = {},
): Promise<PreparedSafeHttpRequest> {
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.floor(options.timeoutMs as number))
    : 5000;
  const startedAt = Date.now();
  const [{ url: validatedUrl, pinnedAddresses }, body] =
    await withPreDispatchTimeout(
      Promise.all([
        validateExternalUrlForFetch(rawUrl, options),
        requestBodyToBuffer(init.body),
      ]),
      timeoutMs,
    );
  const deadlineAt = startedAt + timeoutMs;
  const userAgent = (options.userAgent || '').trim() || 'ITDO_ERP4/0.1';
  const headers = new Headers(init.headers || {});
  if (!headers.has('User-Agent')) {
    headers.set('User-Agent', userAgent);
  }
  let dispatched = false;
  return {
    async dispatch() {
      if (dispatched) throw new SafeHttpError('request_already_dispatched');
      dispatched = true;
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) throw new SafeHttpError('request_timeout');
      const remainingTimeoutMs = Math.max(1, remaining);
      const controller = new AbortController();
      const callerSignal = init.signal;
      const abortFromCaller = () => {
        controller.abort();
      };
      if (callerSignal) {
        if (callerSignal.aborted) {
          abortFromCaller();
        } else {
          callerSignal.addEventListener('abort', abortFromCaller, {
            once: true,
          });
        }
      }
      const timer = setTimeout(() => controller.abort(), remainingTimeoutMs);
      timer.unref?.();
      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearTimeout(timer);
        if (callerSignal) {
          callerSignal.removeEventListener('abort', abortFromCaller);
        }
      };
      try {
        return await pinnedRequestFetch(
          validatedUrl,
          { ...init, body: undefined, signal: controller.signal },
          {
            body,
            pinnedAddresses,
            timeoutMs: remainingTimeoutMs,
            headers,
            onResponseSettled: cleanup,
          },
        );
      } catch (error) {
        cleanup();
        throw error;
      }
    },
  };
}

export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: SafeHttpOptions = {},
) {
  const prepared = await prepareSafeFetch(rawUrl, init, options);
  return prepared.dispatch();
}
