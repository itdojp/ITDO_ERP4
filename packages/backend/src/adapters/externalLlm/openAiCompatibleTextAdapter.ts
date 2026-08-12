import type {
  ExternalLlmPreparedTextRequest,
  ExternalLlmTextPort,
  ExternalLlmTextRequest,
  ExternalLlmTextResult,
  ExternalLlmUsageResult,
} from '../../application/externalLlm/externalLlmPort.js';
import {
  bindExternalLlmTextTransportRequest,
  canonicalExternalLlmAllowedHost,
  ExternalLlmProviderError,
  isPersistenceCompatibleExternalLlmText,
} from '../../application/externalLlm/externalLlmPort.js';
import {
  prepareSafeFetch,
  SafeHttpError,
  type SafeHttpOptions,
} from '../../services/safeHttpClient.js';
import { readBoundedResponseTextWithLimit } from '../../services/redaction.js';

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
  /** Deterministic test seam; runtime composition uses the shared DNS resolver. */
  dnsLookupImpl?: SafeHttpOptions['dnsLookupImpl'];
};

// Knowledge provider outcomes are persisted behind a 256 KiB database bound.
// Keep the strict shared default at that boundary so a successful transport
// result can always enter the Knowledge finalization path. Chat opts into its
// historical 1 MiB response limit explicitly at composition time.
const defaultMaximumResponseBytes = 256 * 1024;
const maximumAllowedResponseBytes = 1024 * 1024;

type OpenAiRequestSnapshot = {
  request: ExternalLlmTextRequest;
  endpoint: string;
  apiKey: string;
  timeoutMs: number;
  allowedHosts: string[];
  allowHttp: boolean;
  allowPrivateIp: boolean;
  maximumResponseBytes: number;
  malformedSuccessPolicy: 'reject' | 'empty';
  usagePolicy: 'strict' | 'ignore';
  dnsLookupImpl: SafeHttpOptions['dnsLookupImpl'];
};

function normalizeMaximumResponseBytes(value: number | undefined) {
  const normalized = value ?? defaultMaximumResponseBytes;
  return Number.isSafeInteger(normalized) &&
    normalized >= 1 &&
    normalized <= maximumAllowedResponseBytes
    ? normalized
    : null;
}

function normalizeTimeoutMs(value: number) {
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function canonicalEndpoint(baseUrl: string): string | null {
  try {
    const parsed = new URL(`${baseUrl.replace(/\/$/, '')}/chat/completions`);
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function canonicalAllowedHosts(
  values: readonly string[],
  endpoint: string,
): string[] | null {
  const hosts = [
    ...new Set(
      values
        .map(canonicalExternalLlmAllowedHost)
        .filter((value) => value !== null),
    ),
  ].sort();
  if (hosts.length !== values.length) return null;
  const rawEndpointHost = new URL(endpoint).hostname;
  const endpointHost = canonicalExternalLlmAllowedHost(
    rawEndpointHost.startsWith('[') && rawEndpointHost.endsWith(']')
      ? rawEndpointHost.slice(1, -1)
      : rawEndpointHost,
  );
  if (endpointHost === null) return null;
  return hosts.length > 0 && hosts.includes(endpointHost) ? hosts : null;
}

function snapshotRequest(
  request: ExternalLlmTextRequest,
): ExternalLlmTextRequest {
  return {
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
}

const maximumPostgresInteger = 2_147_483_647;

function strictNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximumPostgresInteger
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

function responseContent(value: unknown, providerStatus: number): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExternalLlmProviderError('malformed_response', 'known_response');
  }
  const choices = (value as Record<string, unknown>).choices;
  if (!Array.isArray(choices)) {
    throw new ExternalLlmProviderError('malformed_response', 'known_response');
  }
  const first = choices[0];
  if (first === null || typeof first !== 'object' || Array.isArray(first)) {
    throw new ExternalLlmProviderError(
      'empty_result',
      'known_response',
      providerStatus,
    );
  }
  const message = (first as Record<string, unknown>).message;
  if (
    message === null ||
    typeof message !== 'object' ||
    Array.isArray(message)
  ) {
    throw new ExternalLlmProviderError(
      'empty_result',
      'known_response',
      providerStatus,
    );
  }
  const content = (message as Record<string, unknown>).content;
  const normalized = typeof content === 'string' ? content.trim() : '';
  if (!normalized) {
    throw new ExternalLlmProviderError(
      'empty_result',
      'known_response',
      providerStatus,
    );
  }
  if (!isPersistenceCompatibleExternalLlmText(normalized)) {
    throw new ExternalLlmProviderError(
      'malformed_response',
      'known_response',
      providerStatus,
    );
  }
  return normalized;
}

function errorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return '';
}

function timeoutLike(error: unknown): boolean {
  return (
    (error instanceof Error &&
      (error.name === 'AbortError' || /timeout|abort/i.test(error.message))) ||
    /timeout|abort/i.test(errorCode(error))
  );
}

const preDispatchDiagnosticSet = new Set([
  'dns_lookup_failed',
  'host_not_allowed',
  'private_ip_blocked',
  'insecure_scheme',
  'invalid_url',
  'missing_hostname',
  'pre_dispatch_timeout',
  'unsupported_body',
]);

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
  const bounded = await readBoundedResponseTextWithLimit(
    response,
    maximumBytes,
  );
  if (bounded.exceededLimit) {
    throw new ExternalLlmProviderError(
      'response_oversize',
      'known_response',
      response.status,
    );
  }
  if (bounded.invalidUtf8 || bounded.text === null) {
    throw new ExternalLlmProviderError(
      'malformed_response',
      'known_response',
      response.status,
    );
  }
  try {
    return JSON.parse(bounded.text) as unknown;
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

  private snapshot(
    request: ExternalLlmTextRequest,
  ): OpenAiRequestSnapshot | null {
    const maximumResponseBytes = normalizeMaximumResponseBytes(
      this.config.maximumResponseBytes,
    );
    const timeoutMs = normalizeTimeoutMs(this.config.timeoutMs);
    const endpoint = canonicalEndpoint(this.config.baseUrl);
    const allowedHosts =
      endpoint === null
        ? null
        : canonicalAllowedHosts(this.config.allowedHosts, endpoint);
    if (
      maximumResponseBytes === null ||
      timeoutMs === null ||
      endpoint === null ||
      allowedHosts === null
    ) {
      return null;
    }
    return {
      request: snapshotRequest(request),
      endpoint,
      apiKey: this.config.apiKey,
      timeoutMs,
      allowedHosts,
      allowHttp: this.config.allowHttp,
      allowPrivateIp: this.config.allowPrivateIp,
      maximumResponseBytes,
      malformedSuccessPolicy: this.config.malformedSuccessPolicy ?? 'reject',
      usagePolicy: this.config.usagePolicy ?? 'strict',
      dnsLookupImpl: this.config.dnsLookupImpl,
    };
  }

  bind(request: ExternalLlmTextRequest) {
    const snapshot = this.snapshot(request);
    if (snapshot === null || snapshot.request.provider !== 'openai') {
      throw new ExternalLlmProviderError(
        'rejected_before_dispatch',
        'not_dispatched',
      );
    }
    try {
      return {
        requestFingerprint: bindExternalLlmTextTransportRequest(
          snapshot.request,
          {
            kind: 'openai_compatible_http',
            destination: snapshot.endpoint,
            allowedHosts: snapshot.allowedHosts,
            allowHttp: snapshot.allowHttp,
            allowPrivateIp: snapshot.allowPrivateIp,
            timeoutMs: snapshot.timeoutMs,
            maximumResponseBytes: snapshot.maximumResponseBytes,
            malformedSuccessPolicy: snapshot.malformedSuccessPolicy,
            usagePolicy: snapshot.usagePolicy,
          },
        ).requestFingerprint,
      };
    } catch {
      throw new ExternalLlmProviderError(
        'rejected_before_dispatch',
        'not_dispatched',
      );
    }
  }

  async prepare(
    request: ExternalLlmTextRequest,
  ): Promise<ExternalLlmPreparedTextRequest> {
    const snapshot = this.snapshot(request);
    if (snapshot === null) {
      throw new ExternalLlmProviderError(
        'rejected_before_dispatch',
        'not_dispatched',
      );
    }
    const requestSnapshot = snapshot.request;
    if (requestSnapshot.provider !== 'openai') {
      throw new ExternalLlmProviderError(
        'rejected_before_dispatch',
        'not_dispatched',
      );
    }
    // Snapshot every mutable caller-owned value before the first await. A
    // prepared dispatch must remain bound to the request/config it validated.
    const model = requestSnapshot.model;
    const {
      endpoint,
      apiKey,
      timeoutMs,
      allowedHosts,
      allowHttp,
      allowPrivateIp,
      dnsLookupImpl,
      maximumResponseBytes,
      malformedSuccessPolicy,
      usagePolicy,
    } = snapshot;

    let requestFingerprint: string;
    let requestBody: string;
    try {
      const binding = bindExternalLlmTextTransportRequest(requestSnapshot, {
        kind: 'openai_compatible_http',
        destination: endpoint,
        allowedHosts,
        allowHttp,
        allowPrivateIp,
        timeoutMs,
        maximumResponseBytes,
        malformedSuccessPolicy,
        usagePolicy,
      });
      requestFingerprint = binding.requestFingerprint;
      requestBody = binding.serializedBody;
    } catch {
      throw new ExternalLlmProviderError(
        'rejected_before_dispatch',
        'not_dispatched',
      );
    }

    let preparedHttpRequest: Awaited<ReturnType<typeof prepareSafeFetch>>;
    try {
      preparedHttpRequest = await prepareSafeFetch(
        endpoint,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: requestBody,
        },
        {
          timeoutMs,
          allowedHosts,
          allowHttp,
          allowPrivateIp,
          dnsLookupImpl,
        },
      );
    } catch (error) {
      const diagnosticCode = errorCode(error);
      if (preDispatchDiagnosticSet.has(diagnosticCode)) {
        throw new ExternalLlmProviderError(
          'rejected_before_dispatch',
          'not_dispatched',
          null,
          diagnosticCode as
            | 'dns_lookup_failed'
            | 'host_not_allowed'
            | 'private_ip_blocked'
            | 'insecure_scheme'
            | 'invalid_url'
            | 'missing_hostname'
            | 'pre_dispatch_timeout'
            | 'unsupported_body',
        );
      }
      throw new ExternalLlmProviderError(
        'rejected_before_dispatch',
        'not_dispatched',
      );
    }

    let dispatched = false;
    return {
      requestFingerprint,
      dispatch: async (): Promise<ExternalLlmTextResult> => {
        if (dispatched) {
          throw new ExternalLlmProviderError(
            'connection_outcome_unknown',
            'unknown',
          );
        }
        dispatched = true;
        let response: Response;
        try {
          response = await preparedHttpRequest.dispatch();
        } catch (error) {
          if (
            error instanceof SafeHttpError &&
            error.code === 'redirect_blocked'
          ) {
            throw new ExternalLlmProviderError(
              'malformed_response',
              'known_response',
              error.status,
            );
          }
          if (timeoutLike(error)) {
            throw new ExternalLlmProviderError(
              'timeout_outcome_unknown',
              'unknown',
            );
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
          body = await readJsonBounded(response, maximumResponseBytes);
          content = responseContent(body, response.status);
        } catch (error) {
          if (
            malformedSuccessPolicy === 'empty' &&
            (!(error instanceof ExternalLlmProviderError) ||
              error.code === 'malformed_response' ||
              error.code === 'empty_result')
          ) {
            // Chat's pre-existing compatibility contract treated any failure
            // while consuming an already-received 2xx body as an empty result.
            // Strict Knowledge callers retain timeout/outcome classification.
            return {
              provider: 'openai',
              model,
              content: '',
              usageStatus: usagePolicy === 'ignore' ? 'ignored' : 'missing',
              usage: null,
            };
          }
          if (error instanceof ExternalLlmProviderError) throw error;
          if (timeoutLike(error)) {
            throw new ExternalLlmProviderError(
              'timeout_outcome_unknown',
              'unknown',
            );
          }
          throw new ExternalLlmProviderError(
            'connection_outcome_unknown',
            'unknown',
          );
        }
        const usageResult =
          usagePolicy === 'ignore'
            ? ({ usageStatus: 'ignored', usage: null } as const)
            : parseOptionalUsage(
                body && typeof body === 'object' && !Array.isArray(body)
                  ? (body as Record<string, unknown>).usage
                  : undefined,
              );
        return {
          provider: 'openai',
          model,
          content,
          ...usageResult,
        };
      },
    };
  }
}
