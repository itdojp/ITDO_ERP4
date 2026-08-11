/**
 * Provider-neutral text generation boundary shared by bounded contexts.
 *
 * Callers own prompts, authorization, budgets, retries, idempotency and
 * persistence.  Adapters perform at most one provider dispatch per call.
 */
export type ExternalLlmProviderName = 'stub' | 'openai';

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

export type ExternalLlmTextResult = {
  provider: ExternalLlmProviderName;
  model: string;
  content: string;
  usage: ExternalLlmUsage | null;
};

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

export class ExternalLlmProviderError extends Error {
  readonly name = 'ExternalLlmProviderError';

  constructor(
    readonly code: ExternalLlmFailureCode,
    readonly outcome: ExternalLlmOutcomeCertainty,
    readonly providerStatus: number | null = null,
  ) {
    super(code);
  }
}

export interface ExternalLlmTextPort {
  complete(request: ExternalLlmTextRequest): Promise<ExternalLlmTextResult>;
}
