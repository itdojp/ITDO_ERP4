import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

const NATIVE_FETCH = globalThis.fetch;

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

function normalizeResolvedAddresses(resolved: DnsLookupResult) {
  return resolved.map((entry) => {
    const version = isIP(entry.address);
    return {
      address: entry.address,
      family: entry.family || (version === 6 ? 6 : version === 4 ? 4 : 0),
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
  const hostname = url.hostname.toLowerCase();
  if (!hostname) {
    throw new SafeHttpError('missing_hostname');
  }

  const allowedHosts = normalizeAllowedHosts(options.allowedHosts);
  if (allowedHosts.size > 0 && !allowedHosts.has(hostname)) {
    throw new SafeHttpError('host_not_allowed');
  }

  const pinnedAddresses =
    options.allowPrivateIp === true
      ? []
      : await ensurePublicHost(
          hostname,
          resolveDnsLookup(options.dnsLookupImpl),
        );
  return { url, pinnedAddresses };
}

export async function validateExternalUrl(
  rawUrl: string,
  options: SafeHttpOptions = {},
) {
  const { url } = await validateExternalUrlForFetch(rawUrl, options);
  return url;
}

function pinnedAddressForLookup(pinnedAddresses: DnsLookupResult) {
  const preferred =
    pinnedAddresses.find((entry) => entry.family === 4) || pinnedAddresses[0];
  if (!preferred?.address || !preferred.family) {
    return null;
  }
  return preferred;
}

export function createPinnedLookupForTest(pinnedAddresses: DnsLookupResult) {
  const pinned = pinnedAddressForLookup(pinnedAddresses);
  if (!pinned) return undefined;
  return (
    _hostname: string,
    _options: unknown,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string,
      family: number,
    ) => void,
  ) => {
    callback(null, pinned.address, pinned.family || 4);
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

async function pinnedRequestFetch(
  url: URL,
  init: RequestInit,
  options: {
    pinnedAddresses: DnsLookupResult;
    timeoutMs: number;
    headers: Headers;
  },
) {
  const body = await requestBodyToBuffer(init.body);
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
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          reject(new SafeHttpError('redirect_blocked'));
          return;
        }
        const webStream = Readable.toWeb(response) as unknown as BodyInit;
        resolve(
          new Response(webStream, {
            status,
            statusText: response.statusMessage,
            headers: responseHeadersFromNode(response.headers),
          }),
        );
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

export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: SafeHttpOptions = {},
) {
  const { url: validatedUrl, pinnedAddresses } =
    await validateExternalUrlForFetch(rawUrl, options);
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.floor(options.timeoutMs as number))
    : 5000;
  const fetchImpl =
    options.fetchImpl ||
    (globalThis.fetch !== NATIVE_FETCH ? globalThis.fetch : undefined);
  const userAgent = (options.userAgent || '').trim() || 'ITDO_ERP4/0.1';

  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => {
    controller.abort();
  };
  if (callerSignal) {
    if (callerSignal.aborted) {
      abortFromCaller();
    } else {
      callerSignal.addEventListener('abort', abortFromCaller, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers || {});
    if (!headers.has('User-Agent')) {
      headers.set('User-Agent', userAgent);
    }
    if (fetchImpl) {
      return await fetchImpl(validatedUrl.toString(), {
        ...init,
        headers,
        redirect: 'error',
        signal: controller.signal,
      });
    }
    return await pinnedRequestFetch(
      validatedUrl,
      { ...init, signal: controller.signal },
      { pinnedAddresses, timeoutMs, headers },
    );
  } finally {
    clearTimeout(timer);
    if (callerSignal) {
      callerSignal.removeEventListener('abort', abortFromCaller);
    }
  }
}
