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
  maxOutputTokens: number;
  temperatureBasisPoints: number;
};

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

export interface ExternalLlmTextPort {
  complete(request: ExternalLlmTextRequest): Promise<ExternalLlmTextResult>;
}
