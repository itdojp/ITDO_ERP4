import type {
  ExternalLlmPreparedTextRequest,
  ExternalLlmTextPort,
  ExternalLlmTextRequest,
  ExternalLlmTextResult,
} from '../../application/externalLlm/externalLlmPort.js';
import {
  bindExternalLlmTextRequest,
  ExternalLlmProviderError,
  externalLlmConservativeInputTokens,
} from '../../application/externalLlm/externalLlmPort.js';

/**
 * Explicit test-only provider. It never echoes prompt material and never
 * performs network I/O. Runtime composition must opt in to provider=stub.
 */
export class StubExternalLlmTextAdapter implements ExternalLlmTextPort {
  async prepare(
    request: ExternalLlmTextRequest,
  ): Promise<ExternalLlmPreparedTextRequest> {
    const requestSnapshot: ExternalLlmTextRequest = {
      provider: request.provider,
      model: request.model,
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      contextSections:
        request.contextSections === undefined
          ? undefined
          : [...request.contextSections],
      maxOutputTokens: request.maxOutputTokens,
      temperatureBasisPoints: request.temperatureBasisPoints,
    };
    if (requestSnapshot.provider !== 'stub') {
      throw new ExternalLlmProviderError(
        'rejected_before_dispatch',
        'not_dispatched',
      );
    }
    if (
      !Number.isSafeInteger(requestSnapshot.maxOutputTokens) ||
      requestSnapshot.maxOutputTokens < 1
    ) {
      throw new ExternalLlmProviderError(
        'rejected_before_dispatch',
        'not_dispatched',
      );
    }
    let requestFingerprint: string;
    let inputTokens: number;
    const model = requestSnapshot.model;
    const maxOutputTokens = requestSnapshot.maxOutputTokens;
    try {
      requestFingerprint =
        bindExternalLlmTextRequest(requestSnapshot).requestFingerprint;
      inputTokens = externalLlmConservativeInputTokens(requestSnapshot);
    } catch {
      throw new ExternalLlmProviderError(
        'rejected_before_dispatch',
        'not_dispatched',
      );
    }
    const outputTokens = Math.min(12, maxOutputTokens);
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
          model,
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
