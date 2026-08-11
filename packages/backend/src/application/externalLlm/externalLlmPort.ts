import { createHash } from 'node:crypto';

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

function assertExternalLlmTextRequest(request: ExternalLlmTextRequest): void {
  const contexts = request.contextSections ?? [];
  const modelHasControl =
    typeof request.model === 'string' &&
    [...request.model].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    });
  if (
    (request.provider !== 'stub' && request.provider !== 'openai') ||
    typeof request.model !== 'string' ||
    request.model !== request.model.trim() ||
    request.model.length < 1 ||
    [...request.model].length > 200 ||
    modelHasControl ||
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

/**
 * Keeps Chat's legacy prompt byte-for-byte compatible when no context is
 * selected, while giving Knowledge one deterministic provider payload.
 */
export function renderExternalLlmUserPrompt(
  request: Pick<ExternalLlmTextRequest, 'userPrompt' | 'contextSections'>,
): string {
  const contextSections = request.contextSections ?? [];
  if (contextSections.length === 0) return request.userPrompt;
  const context = contextSections
    .map((content, index) => `[C${index + 1}]\n${content}`)
    .join('\n');
  return `${context}\n[U]\n${request.userPrompt}`;
}

/** Opaque binding for the exact request that an adapter prepares. */
export function externalLlmTextRequestFingerprint(
  request: ExternalLlmTextRequest,
): string {
  assertExternalLlmTextRequest(request);
  const hash = createHash('sha256');
  hash.update('erp4:external-llm:text-request:v1\0', 'utf8');
  for (const value of [
    request.provider,
    request.model,
    request.systemPrompt,
    request.userPrompt,
    String(request.maxOutputTokens),
    String(request.temperatureBasisPoints),
  ]) {
    updateFingerprintField(hash, value);
  }
  const contextSections = request.contextSections ?? [];
  updateFingerprintField(hash, String(contextSections.length));
  for (const context of contextSections) updateFingerprintField(hash, context);
  return hash.digest('hex');
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

export interface ExternalLlmTextPort {
  /** Performs every deterministic/pre-dispatch check without provider I/O. */
  prepare(
    request: ExternalLlmTextRequest,
  ): Promise<ExternalLlmPreparedTextRequest>;
}
