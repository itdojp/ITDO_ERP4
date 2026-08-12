import { KnowledgeHubApiError, requestKnowledgeJson } from './knowledgeHubApi';
import type { KnowledgeScope } from './knowledgeHubModel';
import {
  knowledgeLlmExecutionStatuses,
  knowledgeLlmSettlementStatuses,
  knowledgeLlmSourceTypes,
  type KnowledgeLlmBudget,
  type KnowledgeLlmCatalog,
  type KnowledgeLlmContextCandidate,
  type KnowledgeLlmExecuteResult,
  type KnowledgeLlmPreview,
  type KnowledgeLlmProvider,
  type KnowledgeLlmRequest,
  type KnowledgeLlmRun,
  type KnowledgeLlmSourceType,
} from './knowledgeLlmModel';

type JsonRecord = Record<string, unknown>;

function invalid(): never {
  throw new KnowledgeHubApiError('invalid_response', null);
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : invalid();
}

function text(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : invalid();
}

function nullableText(value: unknown) {
  return value === null ? null : text(value);
}

function integer(value: unknown, minimum = 0) {
  return Number.isSafeInteger(value) && Number(value) >= minimum
    ? Number(value)
    : invalid();
}

function nullableInteger(value: unknown, minimum = 0) {
  return value === null ? null : integer(value, minimum);
}

function boolean(value: unknown) {
  return typeof value === 'boolean' ? value : invalid();
}

function numericText(value: unknown) {
  const normalized = text(value);
  return /^[0-9]+$/.test(normalized) ? normalized : invalid();
}

function nullableNumericText(value: unknown) {
  return value === null ? null : numericText(value);
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T {
  return typeof value === 'string' && values.some((entry) => entry === value)
    ? (value as T)
    : invalid();
}

function provider(value: unknown): KnowledgeLlmProvider {
  return oneOf(['stub', 'openai'] as const, value);
}

function scope(value: unknown): KnowledgeScope {
  return oneOf(['personal', 'organization'] as const, value);
}

function sourceType(value: unknown): KnowledgeLlmSourceType {
  return oneOf(knowledgeLlmSourceTypes, value);
}

function normalizeCatalog(value: unknown): KnowledgeLlmCatalog {
  const input = record(value);
  if (!Array.isArray(input.models)) invalid();
  return {
    enabled: boolean(input.enabled),
    provider: input.provider === null ? null : provider(input.provider),
    version: input.version === null ? null : integer(input.version, 1),
    models: input.models.map((entry) => {
      const model = record(entry);
      return {
        provider: provider(model.provider),
        model: text(model.model),
        maxInputTokens: integer(model.maxInputTokens, 1),
        maxOutputTokens: integer(model.maxOutputTokens, 1),
        inputCostMicrosPerMillion: numericText(model.inputCostMicrosPerMillion),
        outputCostMicrosPerMillion: numericText(
          model.outputCostMicrosPerMillion,
        ),
        currency: text(model.currency),
      };
    }),
  };
}

function normalizeBudget(value: unknown): KnowledgeLlmBudget {
  const input = record(value);
  if (!Array.isArray(input.subjects)) invalid();
  return {
    configured: boolean(input.configured),
    policyCount: integer(input.policyCount),
    currency: nullableText(input.currency),
    softLimitWarning: boolean(input.softLimitWarning),
    hardLimitBlocked: boolean(input.hardLimitBlocked),
    rateBlocked: boolean(input.rateBlocked),
    subjects: input.subjects.map((entry) => {
      const subject = record(entry);
      return {
        subjectType: oneOf(
          ['user', 'organization'] as const,
          subject.subjectType,
        ),
        softLimitMicros: numericText(subject.softLimitMicros),
        hardLimitMicros: numericText(subject.hardLimitMicros),
        activeReservedMicros: numericText(subject.activeReservedMicros),
        settledActualMicros: numericText(subject.settledActualMicros),
        heldMaximumMicros: numericText(subject.heldMaximumMicros),
        requestsPerHour: integer(subject.requestsPerHour, 1),
        acceptedRequestsLastHour: integer(subject.acceptedRequestsLastHour),
      };
    }),
  };
}

function normalizeRun(value: unknown): KnowledgeLlmRun {
  const input = record(value);
  return {
    id: text(input.id),
    provider: provider(input.provider),
    model: text(input.model),
    catalogVersion: integer(input.catalogVersion, 1),
    promptTemplateVersion: integer(input.promptTemplateVersion, 1),
    scope: scope(input.scope),
    estimatedInputTokens: integer(input.estimatedInputTokens, 1),
    maxOutputTokens: integer(input.maxOutputTokens, 1),
    maximumCostMicros: numericText(input.maximumCostMicros),
    actualInputTokens: nullableInteger(input.actualInputTokens),
    actualOutputTokens: nullableInteger(input.actualOutputTokens),
    actualCostMicros: nullableNumericText(input.actualCostMicros),
    currency: text(input.currency),
    softLimitWarning: boolean(input.softLimitWarning),
    executionStatus: oneOf(
      knowledgeLlmExecutionStatuses,
      input.executionStatus,
    ),
    settlementStatus: oneOf(
      knowledgeLlmSettlementStatuses,
      input.settlementStatus,
    ),
    failureCode: nullableText(input.failureCode),
    result: nullableText(input.result),
    conversationId: nullableText(input.conversationId),
    createdAt: text(input.createdAt),
    dispatchedAt: nullableText(input.dispatchedAt),
    completedAt: nullableText(input.completedAt),
  };
}

function normalizeContextCandidate(
  value: unknown,
): KnowledgeLlmContextCandidate {
  const input = record(value);
  return {
    sourceType: sourceType(input.sourceType),
    sourceId: text(input.sourceId),
    exactSourceVersion: integer(input.exactSourceVersion, 1),
    byteLength: integer(input.byteLength, 1),
    createdAt: text(input.createdAt),
  };
}

function normalizePreview(value: unknown): KnowledgeLlmPreview {
  const input = record(value);
  if (!Array.isArray(input.selectedSources)) invalid();
  const counts = record(input.sourceCounts);
  return {
    runId: text(input.runId),
    provider: provider(input.provider),
    model: text(input.model),
    catalogVersion: integer(input.catalogVersion, 1),
    promptTemplateVersion: integer(input.promptTemplateVersion, 1),
    scope: scope(input.scope),
    selectedSources: input.selectedSources.map((entry) => {
      const source = record(entry);
      const hash = text(source.exactSourceHash);
      if (!/^[0-9a-f]{64}$/.test(hash)) invalid();
      return {
        ordinal: integer(source.ordinal),
        sourceType: sourceType(source.sourceType),
        exactSourceVersion: integer(source.exactSourceVersion, 1),
        exactSourceHash: hash,
        byteLength: integer(source.byteLength, 1),
        content: text(source.content),
      };
    }),
    sourceCounts: Object.fromEntries(
      knowledgeLlmSourceTypes.map((kind) => [kind, integer(counts[kind])]),
    ) as Record<KnowledgeLlmSourceType, number>,
    selectedItemCount: integer(input.selectedItemCount),
    selectedSourceCount: integer(input.selectedSourceCount, 1),
    totalContextBytes: integer(input.totalContextBytes, 1),
    estimatedInputTokens: integer(input.estimatedInputTokens, 1),
    maxOutputTokens: integer(input.maxOutputTokens, 1),
    maximumCostMicros: numericText(input.maximumCostMicros),
    currency: text(input.currency),
    budget: normalizeBudget(input.budget),
    expiresAt: text(input.expiresAt),
    previewToken: text(input.previewToken),
  };
}

async function requestLlm(path: string, options?: RequestInit) {
  try {
    return await requestKnowledgeJson(path, options);
  } catch (error) {
    if (
      error instanceof KnowledgeHubApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      throw new KnowledgeHubApiError('not_found', error.status);
    }
    throw error;
  }
}

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function fetchKnowledgeLlmCatalog(signal?: AbortSignal) {
  return normalizeCatalog(
    await requestLlm('/knowledge/llm/catalog', signal ? { signal } : undefined),
  );
}

export async function fetchKnowledgeLlmBudget(input: {
  scope: KnowledgeScope;
  organizationId: string | null;
  signal?: AbortSignal;
}) {
  const query = new URLSearchParams({ scope: input.scope });
  if (input.organizationId) query.set('organizationId', input.organizationId);
  return normalizeBudget(
    await requestLlm(
      `/knowledge/llm/budget?${query.toString()}`,
      input.signal ? { signal: input.signal } : undefined,
    ),
  );
}

export async function fetchKnowledgeLlmContextCandidates(input: {
  itemId: string;
  scope: KnowledgeScope;
  organizationId: string | null;
  sourceType: KnowledgeLlmSourceType;
  cursor?: string | null;
  signal?: AbortSignal;
}) {
  const query = new URLSearchParams({
    scope: input.scope,
    sourceType: input.sourceType,
    limit: '100',
  });
  if (input.organizationId) query.set('organizationId', input.organizationId);
  if (input.cursor) query.set('cursor', input.cursor);
  const value = record(
    await requestLlm(
      `/knowledge/items/${encodeURIComponent(input.itemId)}/llm-context-sources?${query.toString()}`,
      input.signal ? { signal: input.signal } : undefined,
    ),
  );
  if (!Array.isArray(value.items)) invalid();
  return {
    items: value.items.map(normalizeContextCandidate),
    nextCursor: value.nextCursor === null ? null : text(value.nextCursor),
  };
}

export async function previewKnowledgeLlmRun(
  request: KnowledgeLlmRequest,
  signal?: AbortSignal,
) {
  return normalizePreview(
    await requestLlm('/knowledge/llm/runs/preview', {
      ...json(request),
      ...(signal ? { signal } : {}),
    }),
  );
}

export async function executeKnowledgeLlmRun(input: {
  request: KnowledgeLlmRequest;
  previewToken: string;
  requestKey: string;
}) {
  const payload = record(
    await requestLlm(
      '/knowledge/llm/runs',
      json({
        ...input.request,
        previewToken: input.previewToken,
        requestKey: input.requestKey,
        confirmed: true,
      }),
    ),
  );
  return {
    created: boolean(payload.created),
    reused: boolean(payload.reused),
    run: normalizeRun(payload.run),
  } satisfies KnowledgeLlmExecuteResult;
}

export async function fetchKnowledgeLlmRun(
  runId: string,
  signal?: AbortSignal,
) {
  return normalizeRun(
    await requestLlm(
      `/knowledge/llm/runs/${encodeURIComponent(runId)}`,
      signal ? { signal } : undefined,
    ),
  );
}

export async function reconcileKnowledgeLlmRun(
  runId: string,
  signal?: AbortSignal,
) {
  return normalizeRun(
    await requestLlm(
      `/knowledge/llm/runs/${encodeURIComponent(runId)}/reconcile`,
      { ...json({}), ...(signal ? { signal } : {}) },
    ),
  );
}
