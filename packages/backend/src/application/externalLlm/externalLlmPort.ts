import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * Provider-neutral text generation boundary shared by bounded contexts.
 *
 * Callers own prompts, authorization, budgets, retries, idempotency and
 * persistence.  Adapters perform at most one provider dispatch per call.
 */
export type ExternalLlmProviderName = 'stub' | 'openai';

/** Conservative role/message framing allowance used by reservation estimates. */
export const externalLlmMessageFramingTokens = 64;

export type ExternalLlmTextRequest = {
  provider: ExternalLlmProviderName;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  /** Ordered, caller-authorized context. Adapters render this deterministically. */
  contextSections?: readonly string[];
  maxOutputTokens: number;
  temperatureBasisPoints: number;
};

/**
 * Version of the canonical OpenAI-compatible JSON request representation.
 * Changing its fields, order, or numeric rendering requires a new version.
 */
export const externalLlmTextRequestSerializationSchemaVersion =
  'openai-chat-completions-v2';

/**
 * The request fingerprint authorizes one exact payload over one exact
 * transport contract. Bump this version whenever a field is added, removed,
 * or interpreted differently.
 */
export const externalLlmTextTransportBindingSchemaVersion =
  'external-llm-text-transport-v1';

export type ExternalLlmTextTransportBinding =
  | {
      kind: 'local_stub';
      destination: 'local://erp4/external-llm/stub/v1';
    }
  | {
      kind: 'openai_compatible_http';
      /** Canonical final request URL, never persisted outside its hash. */
      destination: string;
      allowedHosts: readonly string[];
      allowHttp: boolean;
      allowPrivateIp: boolean;
      timeoutMs: number;
      maximumResponseBytes: number;
      malformedSuccessPolicy: 'reject' | 'empty';
      usagePolicy: 'strict' | 'ignore';
    };

function hasUnpairedUtf16Surrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
  }
  return false;
}

// Unicode 15.0 General_Category=Format (Cf). Keep this explicit list aligned
// with the PostgreSQL model validator so Node/ICU upgrades cannot silently
// change the persisted provider identity contract.
export const externalLlmUnicode15FormatCodePointRanges = [
  [0x00ad, 0x00ad],
  [0x0600, 0x0605],
  [0x061c, 0x061c],
  [0x06dd, 0x06dd],
  [0x070f, 0x070f],
  [0x0890, 0x0891],
  [0x08e2, 0x08e2],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x206f],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
  [0x110bd, 0x110bd],
  [0x110cd, 0x110cd],
  [0x13430, 0x1343f],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0001, 0xe0001],
  [0xe0020, 0xe007f],
] as const;

function isUnicode15FormatCodePoint(codePoint: number): boolean {
  return externalLlmUnicode15FormatCodePointRanges.some(
    ([first, last]) => codePoint >= first && codePoint <= last,
  );
}

/**
 * Canonical provider model identity shared by configuration, requests,
 * budget persistence and mandatory audit validation.
 *
 * PostgreSQL enforces the same ECMAScript TrimString character set in
 * `erp4_knowledge_llm_model_valid`. Keep both definitions covered by the
 * direct-insert integration test when this contract changes.
 */
export function isCanonicalExternalLlmModel(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.trim()) return false;
  const characters = [...value];
  if (characters.length < 1 || characters.length > 200) return false;
  if (hasUnpairedUtf16Surrogate(value)) return false;
  return characters.every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return !(
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      isUnicode15FormatCodePoint(codePoint)
    );
  });
}

export function canonicalExternalLlmAllowedHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Validate the raw value before Unicode case folding. Characters such as
  // U+212A fold to ASCII and must not become an implicit allowlist grant.
  if (!/^[\x21-\x7e]+$/.test(trimmed)) return null;
  if (isIP(trimmed) === 6) {
    // WHATWG URL produces one normalized representation for equivalent IPv6
    // literals. The allowlist contract is deliberately unbracketed, matching
    // safeHttpClient's comparison and DNS/pinning boundary.
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

/**
 * Canonicalizes one complete allowlist without silently discarding malformed
 * or duplicate entries. Every caller must pass raw entries here before case
 * folding so Unicode lookalikes cannot become implicit host grants.
 */
export function canonicalExternalLlmAllowedHosts(
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
  const result = values.map(canonicalExternalLlmAllowedHost);
  if (
    result.some((host) => host === null) ||
    new Set(result).size !== result.length
  ) {
    return null;
  }
  return (result as string[]).sort();
}

/** Canonical host identity for an already parsed provider endpoint URL. */
export function canonicalExternalLlmUrlHostname(url: URL): string | null {
  const rawHostname = url.hostname;
  return canonicalExternalLlmAllowedHost(
    rawHostname.startsWith('[') && rawHostname.endsWith(']')
      ? rawHostname.slice(1, -1)
      : rawHostname,
  );
}

/** Text that can be hashed and persisted without UTF-8/SQL normalization. */
export function isPersistenceCompatibleExternalLlmText(
  value: unknown,
): value is string {
  return (
    typeof value === 'string' &&
    !value.includes('\u0000') &&
    !hasUnpairedUtf16Surrogate(value)
  );
}

function assertExternalLlmTextRequest(request: ExternalLlmTextRequest): void {
  const contexts = request.contextSections ?? [];
  if (
    (request.provider !== 'stub' && request.provider !== 'openai') ||
    !isCanonicalExternalLlmModel(request.model) ||
    typeof request.systemPrompt !== 'string' ||
    typeof request.userPrompt !== 'string' ||
    !Array.isArray(contexts) ||
    contexts.length > 64 ||
    contexts.some((content) => typeof content !== 'string') ||
    !Number.isSafeInteger(request.maxOutputTokens) ||
    request.maxOutputTokens < 1 ||
    request.maxOutputTokens > 1_000_000 ||
    !Number.isSafeInteger(request.temperatureBasisPoints) ||
    request.temperatureBasisPoints < 0 ||
    request.temperatureBasisPoints > 10_000
  ) {
    throw new Error('external_llm_request_invalid');
  }
  if (
    hasUnpairedUtf16Surrogate(request.systemPrompt) ||
    hasUnpairedUtf16Surrogate(request.userPrompt) ||
    contexts.some(hasUnpairedUtf16Surrogate)
  ) {
    // Buffer.from replaces unpaired surrogates with U+FFFD while JSON.stringify
    // preserves them as escapes. Reject them so fingerprint bytes and the
    // provider payload cannot disagree.
    throw new Error('external_llm_request_invalid');
  }
  const promptBytes =
    Buffer.byteLength(request.systemPrompt, 'utf8') +
    Buffer.byteLength(request.userPrompt, 'utf8') +
    contexts.reduce(
      (total, content) => total + Buffer.byteLength(content, 'utf8'),
      0,
    );
  if (!Number.isSafeInteger(promptBytes) || promptBytes > 2 * 1024 * 1024) {
    throw new Error('external_llm_request_invalid');
  }
}

function updateFingerprintField(
  hash: ReturnType<typeof createHash>,
  value: string,
) {
  const encoded = Buffer.from(value, 'utf8');
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(encoded.byteLength);
  hash.update(length);
  hash.update(encoded);
}

type ExternalLlmMessage = {
  role: 'system' | 'user';
  content: string;
};

/**
 * Keeps Chat's two-message payload byte-for-byte compatible when no context
 * is selected. Knowledge context is represented by distinct messages so
 * delimiter-like text inside a source cannot collide with another source
 * boundary or with the final user prompt.
 */
function externalLlmMessages(
  request: Pick<
    ExternalLlmTextRequest,
    'systemPrompt' | 'userPrompt' | 'contextSections'
  >,
): ExternalLlmMessage[] {
  const contextSections = request.contextSections ?? [];
  if (contextSections.length === 0) {
    return [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.userPrompt },
    ];
  }
  return [
    { role: 'system', content: request.systemPrompt },
    ...contextSections.map((content, index) => ({
      role: 'user' as const,
      content: `[C${index + 1}]\n${content}`,
    })),
    { role: 'user', content: `[U]\n${request.userPrompt}` },
  ];
}

/**
 * Builds the exact canonical UTF-8 JSON body used by the OpenAI-compatible
 * adapter. The fixed object construction order is part of the schema version.
 */
export function serializeExternalLlmTextRequestBody(
  request: ExternalLlmTextRequest,
): string {
  assertExternalLlmTextRequest(request);
  return JSON.stringify({
    model: request.model,
    temperature: request.temperatureBasisPoints / 10_000,
    messages: externalLlmMessages(request),
    max_tokens: request.maxOutputTokens,
  });
}

/** Canonical body plus opaque binding for one validated request snapshot. */
export function bindExternalLlmTextRequest(request: ExternalLlmTextRequest): {
  serializedBody: string;
  requestFingerprint: string;
} {
  const serializedBody = serializeExternalLlmTextRequestBody(request);
  const hash = createHash('sha256');
  hash.update('erp4:external-llm:text-request-fingerprint:v2\0', 'utf8');
  updateFingerprintField(hash, request.provider);
  updateFingerprintField(
    hash,
    externalLlmTextRequestSerializationSchemaVersion,
  );
  // This is the same byte sequence passed as prepareSafeFetch's string body.
  updateFingerprintField(hash, serializedBody);
  return {
    serializedBody,
    requestFingerprint: hash.digest('hex'),
  };
}

function canonicalAllowedHosts(hosts: readonly string[]): string[] {
  const result = canonicalExternalLlmAllowedHosts(hosts, 100);
  if (result === null) {
    throw new Error('external_llm_transport_binding_invalid');
  }
  return result;
}

function canonicalHttpDestination(destination: string): string {
  let parsed: URL;
  try {
    parsed = new URL(destination);
  } catch {
    throw new Error('external_llm_transport_binding_invalid');
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    Buffer.byteLength(parsed.href, 'utf8') > 2_048
  ) {
    throw new Error('external_llm_transport_binding_invalid');
  }
  return parsed.href;
}

/**
 * Binds the exact canonical provider body to its non-secret destination and
 * transport policy. Only the SHA-256 result crosses into run persistence or
 * audit; raw URLs, allowlists and credentials do not.
 */
export function bindExternalLlmTextTransportRequest(
  request: ExternalLlmTextRequest,
  transport: ExternalLlmTextTransportBinding,
): { serializedBody: string; requestFingerprint: string } {
  const serializedBody = serializeExternalLlmTextRequestBody(request);
  const hash = createHash('sha256');
  hash.update('erp4:external-llm:text-transport-fingerprint:v1\0', 'utf8');
  updateFingerprintField(hash, request.provider);
  updateFingerprintField(
    hash,
    externalLlmTextRequestSerializationSchemaVersion,
  );
  updateFingerprintField(hash, externalLlmTextTransportBindingSchemaVersion);
  updateFingerprintField(hash, transport.kind);

  if (transport.kind === 'local_stub') {
    if (transport.destination !== 'local://erp4/external-llm/stub/v1') {
      throw new Error('external_llm_transport_binding_invalid');
    }
    updateFingerprintField(hash, transport.destination);
  } else {
    const destination = canonicalHttpDestination(transport.destination);
    const allowedHosts = canonicalAllowedHosts(transport.allowedHosts);
    if (
      typeof transport.allowHttp !== 'boolean' ||
      typeof transport.allowPrivateIp !== 'boolean' ||
      !Number.isSafeInteger(transport.timeoutMs) ||
      transport.timeoutMs < 1 ||
      !Number.isSafeInteger(transport.maximumResponseBytes) ||
      transport.maximumResponseBytes < 1 ||
      transport.maximumResponseBytes > 1024 * 1024 ||
      (transport.malformedSuccessPolicy !== 'reject' &&
        transport.malformedSuccessPolicy !== 'empty') ||
      (transport.usagePolicy !== 'strict' && transport.usagePolicy !== 'ignore')
    ) {
      throw new Error('external_llm_transport_binding_invalid');
    }
    updateFingerprintField(hash, destination);
    updateFingerprintField(hash, String(allowedHosts.length));
    for (const host of allowedHosts) updateFingerprintField(hash, host);
    updateFingerprintField(hash, String(transport.allowHttp));
    updateFingerprintField(hash, String(transport.allowPrivateIp));
    updateFingerprintField(hash, String(transport.timeoutMs));
    updateFingerprintField(hash, String(transport.maximumResponseBytes));
    updateFingerprintField(hash, transport.malformedSuccessPolicy);
    updateFingerprintField(hash, transport.usagePolicy);
  }

  // This is the exact byte sequence passed as prepareSafeFetch's string body.
  updateFingerprintField(hash, serializedBody);
  return { serializedBody, requestFingerprint: hash.digest('hex') };
}

/**
 * Body-only serialization fingerprint retained for canonical payload tests.
 * Dispatch authorization must use an adapter's transport-bound `bind()`.
 */
export function externalLlmTextRequestFingerprint(
  request: ExternalLlmTextRequest,
): string {
  return bindExternalLlmTextRequest(request).requestFingerprint;
}

/**
 * Conservative reservation estimate. This is deliberately not described as
 * the provider tokenizer: two tokens per UTF-8 byte plus explicit framing is
 * an over-reservation boundary.
 */
export function externalLlmConservativeInputTokens(
  request: Pick<
    ExternalLlmTextRequest,
    'systemPrompt' | 'userPrompt' | 'contextSections'
  >,
  sourceFramingTokens = 16,
): number {
  const contextSections = request.contextSections ?? [];
  if (
    typeof request.systemPrompt !== 'string' ||
    typeof request.userPrompt !== 'string' ||
    !Array.isArray(contextSections) ||
    contextSections.some((content) => typeof content !== 'string') ||
    !Number.isSafeInteger(sourceFramingTokens) ||
    sourceFramingTokens < 0
  ) {
    throw new Error('external_llm_token_estimate_invalid');
  }
  if (
    hasUnpairedUtf16Surrogate(request.systemPrompt) ||
    hasUnpairedUtf16Surrogate(request.userPrompt) ||
    contextSections.some(hasUnpairedUtf16Surrogate)
  ) {
    throw new Error('external_llm_token_estimate_invalid');
  }
  const rawBytes =
    Buffer.byteLength(request.systemPrompt, 'utf8') +
    Buffer.byteLength(request.userPrompt, 'utf8') +
    contextSections.reduce(
      (total, content) => total + Buffer.byteLength(content, 'utf8'),
      0,
    );
  const estimate =
    rawBytes * 2 +
    contextSections.length * sourceFramingTokens +
    externalLlmMessageFramingTokens;
  if (!Number.isSafeInteger(estimate) || estimate < 1) {
    throw new Error('external_llm_token_estimate_invalid');
  }
  return estimate;
}

export type ExternalLlmUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ExternalLlmUsageStatus =
  'reported' | 'missing' | 'invalid' | 'ignored';

export type ExternalLlmUsageResult =
  | { usageStatus: 'reported'; usage: ExternalLlmUsage }
  | { usageStatus: 'missing' | 'invalid' | 'ignored'; usage: null };

type ExternalLlmTextResultBase = {
  provider: ExternalLlmProviderName;
  model: string;
  content: string;
};

/**
 * Successful provider content and usage accounting are deliberately separate.
 * A valid result remains capturable when usage is missing or malformed, while
 * callers must handle that state as usage-unknown rather than normal success.
 */
export type ExternalLlmTextResult = ExternalLlmTextResultBase &
  ExternalLlmUsageResult;

export type ExternalLlmFailureCode =
  | 'disabled'
  | 'rejected_before_dispatch'
  | 'timeout_outcome_unknown'
  | 'connection_outcome_unknown'
  | 'provider_4xx'
  | 'provider_5xx'
  | 'malformed_response'
  | 'response_oversize'
  | 'empty_result'
  | 'usage_missing'
  | 'usage_invalid';

export type ExternalLlmOutcomeCertainty =
  'not_dispatched' | 'known_response' | 'unknown';

export type ExternalLlmPreDispatchDiagnostic =
  | 'dns_lookup_failed'
  | 'host_not_allowed'
  | 'private_ip_blocked'
  | 'insecure_scheme'
  | 'invalid_url'
  | 'missing_hostname'
  | 'pre_dispatch_timeout'
  | 'unsupported_body';

export class ExternalLlmProviderError extends Error {
  readonly name = 'ExternalLlmProviderError';
  readonly preDispatchDiagnostic!: ExternalLlmPreDispatchDiagnostic | null;

  constructor(
    readonly code: ExternalLlmFailureCode,
    readonly outcome: ExternalLlmOutcomeCertainty,
    readonly providerStatus: number | null = null,
    preDispatchDiagnostic: ExternalLlmPreDispatchDiagnostic | null = null,
  ) {
    super(code);
    Object.defineProperty(this, 'preDispatchDiagnostic', {
      configurable: false,
      enumerable: false,
      value: preDispatchDiagnostic,
      writable: false,
    });
  }
}

export type ExternalLlmPreparedTextRequest = {
  /** Must match the exact request persisted before dispatch. */
  requestFingerprint: string;
  /** Single-use network/local dispatch. No validation that can safely release a reservation remains. */
  dispatch(): Promise<ExternalLlmTextResult>;
};

export type ExternalLlmBoundTextRequest = {
  /** Opaque SHA-256 over the exact body, destination and transport policy. */
  requestFingerprint: string;
};

export interface ExternalLlmTextRequestBindingPort {
  /** Deterministic and provider-I/O-free binding used before budget reserve. */
  bind(request: ExternalLlmTextRequest): ExternalLlmBoundTextRequest;
}

export interface ExternalLlmTextPort extends ExternalLlmTextRequestBindingPort {
  /** Performs every deterministic/pre-dispatch check without provider I/O. */
  prepare(
    request: ExternalLlmTextRequest,
  ): Promise<ExternalLlmPreparedTextRequest>;
}
