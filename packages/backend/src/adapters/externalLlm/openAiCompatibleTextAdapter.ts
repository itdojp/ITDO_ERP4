import type {
  ExternalLlmTextPort,
  ExternalLlmTextRequest,
  ExternalLlmTextResult,
  ExternalLlmUsageResult,
} from '../../application/externalLlm/externalLlmPort.js';
import { ExternalLlmProviderError } from '../../application/externalLlm/externalLlmPort.js';
import { safeFetch } from '../../services/safeHttpClient.js';
import { readBoundedResponseText } from '../../services/redaction.js';

export type OpenAiCompatibleTextAdapterConfig = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  allowedHosts: string[];
  allowHttp: boolean;
  allowPrivateIp: boolean;
  maximumResponseBytes?: number;
  malformedSuccessPolicy?: 'reject' | 'empty';
  usagePolicy?: 'strict' | 'ignore';
};

const defaultMaximumResponseBytes = 1024 * 1024;

function strictNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function parseOptionalUsage(value: unknown): ExternalLlmUsageResult {
  if (value === undefined) return { usageStatus: 'missing', usage: null };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { usageStatus: 'invalid', usage: null };
  }
  const usage = value as Record<string, unknown>;
  const inputTokens = strictNonNegativeInteger(usage.prompt_tokens);
  const outputTokens = strictNonNegativeInteger(usage.completion_tokens);
  if (inputTokens === null || outputTokens === null) {
    return { usageStatus: 'invalid', usage: null };
  }
  return {
    usageStatus: 'reported',
    usage: { inputTokens, outputTokens },
  };
}

function responseContent(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExternalLlmProviderError('malformed_response', 'known_response');
  }
  const choices = (value as Record<string, unknown>).choices;
  if (!Array.isArray(choices)) {
    throw new ExternalLlmProviderError('malformed_response', 'known_response');
  }
  const first = choices[0];
  if (first === null || typeof first !== 'object' || Array.isArray(first)) {
    return '';
  }
  const message = (first as Record<string, unknown>).message;
  if (
    message === null ||
    typeof message !== 'object' ||
    Array.isArray(message)
  ) {
    return '';
  }
  const content = (message as Record<string, unknown>).content;
  return typeof content === 'string' ? content.trim() : '';
}

async function readJsonBounded(response: Response, maximumBytes: number) {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    /^(0|[1-9][0-9]*)$/.test(contentLength) &&
    BigInt(contentLength) > BigInt(maximumBytes)
  ) {
    throw new ExternalLlmProviderError(
      'response_oversize',
      'known_response',
      response.status,
    );
  }
  // The shared diagnostic reader intentionally truncates. Read one byte past
  // this adapter's contract so truncation cannot turn an oversized response
  // into valid JSON or misclassify it as merely malformed.
  const text = await readBoundedResponseText(response, maximumBytes + 1);
  if (Buffer.byteLength(text, 'utf8') > maximumBytes) {
    throw new ExternalLlmProviderError(
      'response_oversize',
      'known_response',
      response.status,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ExternalLlmProviderError(
      'malformed_response',
      'known_response',
      response.status,
    );
  }
}

/**
 * Single-dispatch OpenAI-compatible transport.  It deliberately does not
 * retry, choose another model/provider or decide whether missing usage is
 * acceptable; bounded-context callers own those policies.
 */
export class OpenAiCompatibleTextAdapter implements ExternalLlmTextPort {
  constructor(private readonly config: OpenAiCompatibleTextAdapterConfig) {}

  async complete(
    request: ExternalLlmTextRequest,
  ): Promise<ExternalLlmTextResult> {
    if (request.provider !== 'openai') {
      throw new ExternalLlmProviderError(
        'rejected_before_dispatch',
        'not_dispatched',
      );
    }

    let response: Response;
    try {
      response = await safeFetch(
        `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: request.model,
            temperature: request.temperatureBasisPoints / 10_000,
            messages: [
              { role: 'system', content: request.systemPrompt },
              { role: 'user', content: request.userPrompt },
            ],
            max_tokens: request.maxOutputTokens,
          }),
        },
        {
          timeoutMs: this.config.timeoutMs,
          allowedHosts: this.config.allowedHosts,
          allowHttp: this.config.allowHttp,
          allowPrivateIp: this.config.allowPrivateIp,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/timeout|abort/i.test(message)) {
        throw new ExternalLlmProviderError(
          'timeout_outcome_unknown',
          'unknown',
        );
      }
      if (
        /host_not_allowed|private_ip_blocked|http_not_allowed|invalid_url/i.test(
          message,
        )
      ) {
        // Preserve the established safeFetch diagnostic contract for the Chat
        // compatibility wrapper without exposing request material.
        throw error;
      }
      throw new ExternalLlmProviderError(
        'connection_outcome_unknown',
        'unknown',
      );
    }

    if (!response.ok) {
      // Provider error bodies are untrusted and may reflect prompts or
      // credentials. Discard them instead of attaching even a redacted suffix
      // to an error that can reach application logs or mandatory audit.
      try {
        await response.body?.cancel();
      } catch {
        // The normalized status/certainty contract does not depend on whether
        // an untrusted diagnostic body can be cancelled.
      }
      throw new ExternalLlmProviderError(
        response.status >= 500 ? 'provider_5xx' : 'provider_4xx',
        'known_response',
        response.status,
      );
    }

    let body: unknown;
    let content: string;
    try {
      body = await readJsonBounded(
        response,
        this.config.maximumResponseBytes ?? defaultMaximumResponseBytes,
      );
      content = responseContent(body);
    } catch (error) {
      if (
        this.config.malformedSuccessPolicy === 'empty' &&
        error instanceof ExternalLlmProviderError &&
        error.code === 'malformed_response'
      ) {
        return {
          provider: 'openai',
          model: request.model,
          content: '',
          usageStatus:
            this.config.usagePolicy === 'ignore' ? 'ignored' : 'missing',
          usage: null,
        };
      }
      throw error;
    }
    const usageResult =
      this.config.usagePolicy === 'ignore'
        ? ({ usageStatus: 'ignored', usage: null } as const)
        : parseOptionalUsage(
            body && typeof body === 'object' && !Array.isArray(body)
              ? (body as Record<string, unknown>).usage
              : undefined,
          );
    return {
      provider: 'openai',
      model: request.model,
      content,
      ...usageResult,
    };
  }
}
