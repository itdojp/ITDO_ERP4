const SENSITIVE_KEY_FRAGMENTS = [
  'authorization',
  'cookie',
  'token',
  'password',
  'passwd',
  'api_key',
  'apikey',
  'secret',
  'credential',
  'provider',
  'response_body',
  'error_body',
  'error_detail',
  'headers',
  'set-cookie',
];

const TOKEN_LIKE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\b(?:gho|ghp|github_pat|sk|xox[baprs])_[A-Za-z0-9_:-]{8,}\b/gi,
  /\b[A-Za-z0-9+/]{32,}={0,2}\b/g,
];

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[-\s]/g, '_');
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment),
  );
}

export function redactSensitiveText(value: string, maxLength = 500) {
  let redacted = value;
  for (const pattern of TOKEN_LIKE_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  redacted = redacted.replace(
    /([?&](?:token|api_key|apikey|secret|password)=)[^&\s]+/gi,
    '$1[REDACTED]',
  );
  if (redacted.length > maxLength) {
    return `${redacted.slice(0, maxLength)}…[truncated]`;
  }
  return redacted;
}

export function redactSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item));
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = isSensitiveKey(key)
        ? '[REDACTED]'
        : redactSensitiveValue(child);
    }
    return output;
  }
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }
  return value;
}

export async function readBoundedResponseText(
  response: Response,
  maxBytes = 2048,
) {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = maxBytes - total;
      const chunk =
        value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(Buffer.from(chunk));
      total += chunk.byteLength;
      if (value.byteLength > remaining) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
