import { isIP } from 'node:net';

/** Canonical ASCII host identity before case folding or URL/IDNA parsing. */
export function canonicalExternalHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^[\x21-\x7e]+$/.test(trimmed)) return null;
  if (isIP(trimmed) === 6) {
    const hostname = new URL(`http://[${trimmed}]/`).hostname;
    return hostname.slice(1, -1).toLowerCase();
  }
  const normalized = trimmed.toLowerCase();
  if (
    normalized.length < 1 ||
    normalized.length > 253 ||
    !/^[A-Za-z0-9.-]+$/.test(trimmed) ||
    normalized.startsWith('.') ||
    normalized.endsWith('.') ||
    normalized.includes('..')
  ) {
    return null;
  }
  return normalized;
}

export function canonicalExternalHosts(
  values: readonly unknown[],
  maximumHosts = 100,
): string[] | null {
  if (
    !Array.isArray(values) ||
    !Number.isSafeInteger(maximumHosts) ||
    maximumHosts < 0 ||
    values.length > maximumHosts
  ) {
    return null;
  }
  const result = values.map(canonicalExternalHost);
  if (
    result.some((host) => host === null) ||
    new Set(result).size !== result.length
  ) {
    return null;
  }
  return (result as string[]).sort();
}

function rawAuthorityHost(rawUrl: string): string | null {
  const match = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/.exec(rawUrl);
  if (!match) return null;
  const authority = match[1];
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (hostPort.startsWith('[')) {
    const closing = hostPort.indexOf(']');
    if (closing < 0 || !/^(?::[0-9]+)?$/.test(hostPort.slice(closing + 1))) {
      return null;
    }
    return hostPort.slice(1, closing);
  }
  const firstColon = hostPort.indexOf(':');
  const lastColon = hostPort.lastIndexOf(':');
  if (firstColon !== lastColon) return null;
  if (lastColon < 0) return hostPort;
  if (!/^[0-9]+$/.test(hostPort.slice(lastColon + 1))) return null;
  return hostPort.slice(0, lastColon);
}

/**
 * Validates the raw authority before WHATWG case folding/IDNA conversion.
 * Unicode remains permitted outside the authority (for example path/query).
 */
export function canonicalExternalUrl(
  value: unknown,
): { url: URL; hostname: string } | null {
  if (typeof value !== 'string') return null;
  const rawUrl = value.trim();
  const rawCanonicalHost = canonicalExternalHost(rawAuthorityHost(rawUrl));
  if (rawCanonicalHost === null) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const parsedHostname = url.hostname;
  const parsedCanonicalHost = canonicalExternalHost(
    parsedHostname.startsWith('[') && parsedHostname.endsWith(']')
      ? parsedHostname.slice(1, -1)
      : parsedHostname,
  );
  if (
    parsedCanonicalHost === null ||
    parsedCanonicalHost !== rawCanonicalHost
  ) {
    return null;
  }
  return { url, hostname: parsedCanonicalHost };
}
