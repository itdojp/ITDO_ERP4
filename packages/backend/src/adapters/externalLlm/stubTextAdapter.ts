import type {
  ExternalLlmPreparedTextRequest,
  ExternalLlmTextPort,
  ExternalLlmTextRequest,
  ExternalLlmTextResult,
} from '../../application/externalLlm/externalLlmPort.js';
import {
  ExternalLlmProviderError,
  externalLlmConservativeInputTokens,
  externalLlmTextRequestFingerprint,
} from '../../application/externalLlm/externalLlmPort.js';

/**
 * Explicit test-only provider. It never echoes prompt material and never
 * performs network I/O. Runtime composition must opt in to provider=stub.
 */
export class StubExternalLlmTextAdapter implements ExternalLlmTextPort {
  async prepare(
    request: ExternalLlmTextRequest,
  ): Promise<ExternalLlmPreparedTextRequest> {
    if (request.provider !== 'stub') {
      throw new ExternalLlmProviderError(
        'rejected_before_dispatch',
        'not_dispatched',
      );
    }
    if (
      !Number.isSafeInteger(request.maxOutputTokens) ||
      request.maxOutputTokens < 1
    ) {
      throw new ExternalLlmProviderError(
        'rejected_before_dispatch',
        'not_dispatched',
      );
    }
    let requestFingerprint: string;
    let inputTokens: number;
    try {
      requestFingerprint = externalLlmTextRequestFingerprint(request);
      inputTokens = externalLlmConservativeInputTokens(request);
    } catch {
      throw new ExternalLlmProviderError(
        'rejected_before_dispatch',
        'not_dispatched',
      );
    }
    const outputTokens = Math.min(12, request.maxOutputTokens);
    const content = 'Synthetic external LLM result.'.slice(0, outputTokens);
    let dispatched = false;
    return {
      requestFingerprint,
      async dispatch(): Promise<ExternalLlmTextResult> {
        if (dispatched) {
          throw new ExternalLlmProviderError(
            'connection_outcome_unknown',
            'unknown',
          );
        }
        dispatched = true;
        return {
          provider: 'stub',
          model: request.model,
          content,
          usageStatus: 'reported',
          usage: {
            inputTokens,
            outputTokens,
          },
        };
      },
    };
  }
}
