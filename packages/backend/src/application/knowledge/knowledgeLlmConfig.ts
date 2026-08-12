import {
  canonicalExternalLlmAllowedHosts,
  canonicalExternalLlmUrlHostname,
  externalLlmMessageFramingTokens,
  isCanonicalExternalLlmModel,
  type ExternalLlmProviderName,
} from '../externalLlm/externalLlmPort.js';

export const knowledgeLlmLimits = {
  totalSources: 32,
  snapshots: 4,
  annotationRevisions: 10,
  conversationTurns: 20,
  synthesisVersions: 5,
  threadPromotionMessages: 20,
  selectedItems: 10,
  sourceBytes: 64 * 1024,
  totalContextBytes: 256 * 1024,
  sourceFramingTokens: 16,
  providerMessageFramingTokens: externalLlmMessageFramingTokens,
  userPromptBytes: 16 * 1024,
  systemPromptBytes: 8 * 1024,
  maximumOutputTokens: 4096,
  previewTokenBytes: 4096,
  previewTtlMs: 10 * 60 * 1000,
  provenanceDepth: 1,
  serializableAttempts: 3,
} as const;

export type KnowledgeLlmModelCatalogEntry = {
  provider: ExternalLlmProviderName;
  model: string;
  enabled: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
  inputCostMicrosPerMillion: bigint;
  outputCostMicrosPerMillion: bigint;
  currency: string;
  capabilities: readonly ['text'];
};

export type KnowledgeLlmModelCatalog = {
  version: number;
  models: KnowledgeLlmModelCatalogEntry[];
};

export type KnowledgeLlmRuntimeConfig =
  | { provider: 'disabled'; catalog: null }
  | {
      provider: 'stub';
      catalog: KnowledgeLlmModelCatalog;
    }
  | {
      provider: 'openai';
      catalog: KnowledgeLlmModelCatalog;
      apiKey: string;
      baseUrl: string;
      timeoutMs: number;
      allowedHosts: string[];
      allowHttp: boolean;
      allowPrivateIp: boolean;
    };

export class KnowledgeLlmConfigurationError extends Error {
  readonly name = 'KnowledgeLlmConfigurationError';
  constructor(readonly key: string) {
    super(`invalid_knowledge_llm_configuration:${key}`);
  }
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  key: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new KnowledgeLlmConfigurationError(key);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(keys);
  if (Object.keys(record).some((candidate) => !allowed.has(candidate))) {
    throw new KnowledgeLlmConfigurationError(key);
  }
  return record;
}

function boundedText(value: unknown, maximum: number, key: string): string {
  const hasControl =
    typeof value === 'string' &&
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    });
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    value.length === 0 ||
    [...value].length > maximum ||
    hasControl
  ) {
    throw new KnowledgeLlmConfigurationError(key);
  }
  return value;
}

function positiveInteger(value: unknown, maximum: number, key: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new KnowledgeLlmConfigurationError(key);
  }
  return value;
}

function nonNegativeBigInt(value: unknown, key: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value)) {
    throw new KnowledgeLlmConfigurationError(key);
  }
  const parsed = BigInt(value);
  if (parsed > 9_223_372_036_854_775_807n) {
    throw new KnowledgeLlmConfigurationError(key);
  }
  return parsed;
}

export function parseKnowledgeLlmModelCatalog(
  raw: string | undefined,
): KnowledgeLlmModelCatalog {
  if (!raw || Buffer.byteLength(raw, 'utf8') > 256 * 1024) {
    throw new KnowledgeLlmConfigurationError(
      'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new KnowledgeLlmConfigurationError(
      'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
    );
  }
  const catalog = exactObject(
    parsed,
    ['version', 'models'],
    'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
  );
  const version = positiveInteger(
    catalog.version,
    2_147_483_647,
    'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
  );
  if (!Array.isArray(catalog.models) || catalog.models.length > 100) {
    throw new KnowledgeLlmConfigurationError(
      'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
    );
  }
  const seen = new Set<string>();
  const models = catalog.models.map((candidate) => {
    const entry = exactObject(
      candidate,
      [
        'provider',
        'model',
        'enabled',
        'maxInputTokens',
        'maxOutputTokens',
        'inputCostMicrosPerMillion',
        'outputCostMicrosPerMillion',
        'currency',
        'capabilities',
      ],
      'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
    );
    if (entry.provider !== 'stub' && entry.provider !== 'openai') {
      throw new KnowledgeLlmConfigurationError(
        'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
      );
    }
    const provider: ExternalLlmProviderName = entry.provider;
    if (!isCanonicalExternalLlmModel(entry.model)) {
      throw new KnowledgeLlmConfigurationError(
        'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
      );
    }
    const model = entry.model;
    const identity = `${provider}\0${model}`;
    if (seen.has(identity)) {
      throw new KnowledgeLlmConfigurationError(
        'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
      );
    }
    seen.add(identity);
    if (typeof entry.enabled !== 'boolean') {
      throw new KnowledgeLlmConfigurationError(
        'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
      );
    }
    if (
      !Array.isArray(entry.capabilities) ||
      entry.capabilities.length !== 1 ||
      entry.capabilities[0] !== 'text'
    ) {
      throw new KnowledgeLlmConfigurationError(
        'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
      );
    }
    const currency = boundedText(
      entry.currency,
      3,
      'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
    );
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new KnowledgeLlmConfigurationError(
        'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
      );
    }
    return {
      provider,
      model,
      enabled: entry.enabled,
      maxInputTokens: positiveInteger(
        entry.maxInputTokens,
        2_147_483_647,
        'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
      ),
      maxOutputTokens: positiveInteger(
        entry.maxOutputTokens,
        knowledgeLlmLimits.maximumOutputTokens,
        'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
      ),
      inputCostMicrosPerMillion: nonNegativeBigInt(
        entry.inputCostMicrosPerMillion,
        'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
      ),
      outputCostMicrosPerMillion: nonNegativeBigInt(
        entry.outputCostMicrosPerMillion,
        'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
      ),
      currency,
      capabilities: ['text'] as const,
    };
  });
  return { version, models };
}

function positiveInt(raw: string | undefined, fallback: number, key: string) {
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new KnowledgeLlmConfigurationError(key);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > 120_000) {
    throw new KnowledgeLlmConfigurationError(key);
  }
  return value;
}

function allowedHosts(raw: string | undefined): string[] {
  if (!raw) return [];
  const result = canonicalExternalLlmAllowedHosts(raw.split(','), 20);
  if (result === null) {
    throw new KnowledgeLlmConfigurationError(
      'KNOWLEDGE_EXTERNAL_LLM_ALLOWED_HOSTS',
    );
  }
  return result;
}

export function getKnowledgeLlmRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): KnowledgeLlmRuntimeConfig {
  const provider = (env.KNOWLEDGE_EXTERNAL_LLM_PROVIDER || 'disabled')
    .trim()
    .toLowerCase();
  if (provider === 'disabled' || provider === '') {
    return { provider: 'disabled', catalog: null };
  }
  if (provider !== 'stub' && provider !== 'openai') {
    throw new KnowledgeLlmConfigurationError('KNOWLEDGE_EXTERNAL_LLM_PROVIDER');
  }
  const catalog = parseKnowledgeLlmModelCatalog(
    env.KNOWLEDGE_LLM_MODEL_CATALOG_JSON,
  );
  if (
    !catalog.models.some(
      (entry) => entry.provider === provider && entry.enabled,
    )
  ) {
    throw new KnowledgeLlmConfigurationError(
      'KNOWLEDGE_LLM_MODEL_CATALOG_JSON',
    );
  }
  if (provider === 'stub') return { provider, catalog };

  const apiKey = env.KNOWLEDGE_EXTERNAL_LLM_OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new KnowledgeLlmConfigurationError(
      'KNOWLEDGE_EXTERNAL_LLM_OPENAI_API_KEY',
    );
  }
  const baseUrl = (
    env.KNOWLEDGE_EXTERNAL_LLM_OPENAI_BASE_URL || 'https://api.openai.com/v1'
  )
    .trim()
    .replace(/\/$/, '');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new KnowledgeLlmConfigurationError(
      'KNOWLEDGE_EXTERNAL_LLM_OPENAI_BASE_URL',
    );
  }
  const allowHttp = env.KNOWLEDGE_EXTERNAL_LLM_ALLOW_HTTP === 'true';
  const allowPrivateIp = env.KNOWLEDGE_EXTERNAL_LLM_ALLOW_PRIVATE_IP === 'true';
  const nodeEnvironment = env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnvironment === 'production' && (allowHttp || allowPrivateIp)) {
    throw new KnowledgeLlmConfigurationError(
      allowHttp
        ? 'KNOWLEDGE_EXTERNAL_LLM_ALLOW_HTTP'
        : 'KNOWLEDGE_EXTERNAL_LLM_ALLOW_PRIVATE_IP',
    );
  }
  if (
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new KnowledgeLlmConfigurationError(
      'KNOWLEDGE_EXTERNAL_LLM_OPENAI_BASE_URL',
    );
  }
  if (
    parsedUrl.protocol !== 'https:' &&
    !(allowHttp && parsedUrl.protocol === 'http:')
  ) {
    throw new KnowledgeLlmConfigurationError(
      'KNOWLEDGE_EXTERNAL_LLM_OPENAI_BASE_URL',
    );
  }
  const hosts = allowedHosts(env.KNOWLEDGE_EXTERNAL_LLM_ALLOWED_HOSTS);
  const destinationHost = canonicalExternalLlmUrlHostname(parsedUrl);
  if (
    destinationHost === null ||
    hosts.length === 0 ||
    !hosts.includes(destinationHost)
  ) {
    throw new KnowledgeLlmConfigurationError(
      'KNOWLEDGE_EXTERNAL_LLM_ALLOWED_HOSTS',
    );
  }
  return {
    provider,
    catalog,
    apiKey,
    baseUrl,
    timeoutMs: positiveInt(
      env.KNOWLEDGE_EXTERNAL_LLM_TIMEOUT_MS,
      15_000,
      'KNOWLEDGE_EXTERNAL_LLM_TIMEOUT_MS',
    ),
    allowedHosts: hosts,
    allowHttp,
    allowPrivateIp,
  };
}

export function ceilCostMicros(
  tokens: number,
  priceMicrosPerMillion: bigint,
): bigint {
  if (
    !Number.isSafeInteger(tokens) ||
    tokens < 0 ||
    priceMicrosPerMillion < 0n
  ) {
    throw new KnowledgeLlmConfigurationError('knowledge_llm_cost');
  }
  const numerator = BigInt(tokens) * priceMicrosPerMillion;
  return (numerator + 999_999n) / 1_000_000n;
}

export function maximumReservationMicros(input: {
  model: KnowledgeLlmModelCatalogEntry;
  estimatedInputTokens: number;
  maxOutputTokens: number;
}): bigint {
  if (
    input.estimatedInputTokens > input.model.maxInputTokens ||
    input.maxOutputTokens > input.model.maxOutputTokens
  ) {
    throw new KnowledgeLlmConfigurationError('knowledge_llm_model_limit');
  }
  return (
    ceilCostMicros(
      input.estimatedInputTokens,
      input.model.inputCostMicrosPerMillion,
    ) +
    ceilCostMicros(
      input.maxOutputTokens,
      input.model.outputCostMicrosPerMillion,
    )
  );
}

/** Conservative reservation estimate, not a provider tokenizer result. */
export function estimateKnowledgeLlmInputTokens(
  utf8Bytes: number,
  sourceCount: number,
): number {
  if (
    !Number.isSafeInteger(utf8Bytes) ||
    utf8Bytes < 0 ||
    !Number.isSafeInteger(sourceCount) ||
    sourceCount < 0
  ) {
    throw new KnowledgeLlmConfigurationError('knowledge_llm_token_estimate');
  }
  const estimate = Math.max(
    1,
    utf8Bytes * 2 +
      sourceCount * knowledgeLlmLimits.sourceFramingTokens +
      knowledgeLlmLimits.providerMessageFramingTokens,
  );
  if (!Number.isSafeInteger(estimate) || estimate > 2_147_483_647) {
    throw new KnowledgeLlmConfigurationError('knowledge_llm_token_estimate');
  }
  return estimate;
}

export function assertIanaTimezone(value: string): string {
  const normalized = boundedText(value, 100, 'knowledge_llm_timezone');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format();
  } catch {
    throw new KnowledgeLlmConfigurationError('knowledge_llm_timezone');
  }
  return normalized;
}
