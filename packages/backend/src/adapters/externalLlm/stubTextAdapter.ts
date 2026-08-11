import type {
  ExternalLlmTextPort,
  ExternalLlmTextRequest,
  ExternalLlmTextResult,
} from '../../application/externalLlm/externalLlmPort.js';
import { ExternalLlmProviderError } from '../../application/externalLlm/externalLlmPort.js';

/**
 * Explicit test-only provider. It never echoes prompt material and never
 * performs network I/O. Runtime composition must opt in to provider=stub.
 */
export class StubExternalLlmTextAdapter implements ExternalLlmTextPort {
  async complete(
    request: ExternalLlmTextRequest,
  ): Promise<ExternalLlmTextResult> {
    if (request.provider !== 'stub') {
      throw new ExternalLlmProviderError(
        'rejected_before_dispatch',
        'not_dispatched',
      );
    }
    const inputBytes = Buffer.byteLength(
      `${request.systemPrompt}\n${request.userPrompt}`,
      'utf8',
    );
    return {
      provider: 'stub',
      model: request.model,
      content: 'Synthetic external LLM result.',
      usage: {
        inputTokens: Math.max(1, inputBytes * 2),
        outputTokens: 12,
      },
    };
  }
}
