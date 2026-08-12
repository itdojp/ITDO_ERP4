import type { KnowledgeScope } from './knowledgeHubModel';

export const knowledgeLlmSourceTypes = [
  'snapshot',
  'annotation_revision',
  'conversation_turn',
  'synthesis_version',
  'thread_promotion_message',
] as const;
export type KnowledgeLlmSourceType = (typeof knowledgeLlmSourceTypes)[number];
export type KnowledgeLlmProvider = 'stub' | 'openai';

export type KnowledgeLlmSourceSelector = {
  sourceType: KnowledgeLlmSourceType;
  sourceId: string;
};

export type KnowledgeLlmRequest = {
  scope: KnowledgeScope;
  organizationId: string | null;
  provider: KnowledgeLlmProvider;
  model: string;
  catalogVersion: number;
  userPrompt: string;
  maxOutputTokens: number;
  sources: KnowledgeLlmSourceSelector[];
};

export type KnowledgeLlmCatalogModel = {
  provider: KnowledgeLlmProvider;
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  inputCostMicrosPerMillion: string;
  outputCostMicrosPerMillion: string;
  currency: string;
};

export type KnowledgeLlmCatalog = {
  enabled: boolean;
  provider: KnowledgeLlmProvider | null;
  version: number | null;
  models: KnowledgeLlmCatalogModel[];
};

export type KnowledgeLlmBudgetSubject = {
  subjectType: 'user' | 'organization';
  softLimitMicros: string;
  hardLimitMicros: string;
  activeReservedMicros: string;
  settledActualMicros: string;
  heldMaximumMicros: string;
  requestsPerHour: number;
  acceptedRequestsLastHour: number;
};

export type KnowledgeLlmBudget = {
  configured: boolean;
  policyCount: number;
  currency: string | null;
  softLimitWarning: boolean;
  hardLimitBlocked: boolean;
  rateBlocked: boolean;
  subjects: KnowledgeLlmBudgetSubject[];
};

export type KnowledgeLlmPreviewSource = {
  ordinal: number;
  sourceType: KnowledgeLlmSourceType;
  exactSourceVersion: number;
  exactSourceHash: string;
  byteLength: number;
  content: string;
};

export type KnowledgeLlmPreview = {
  runId: string;
  provider: KnowledgeLlmProvider;
  model: string;
  catalogVersion: number;
  promptTemplateVersion: number;
  scope: KnowledgeScope;
  selectedSources: KnowledgeLlmPreviewSource[];
  sourceCounts: Record<KnowledgeLlmSourceType, number>;
  selectedItemCount: number;
  selectedSourceCount: number;
  totalContextBytes: number;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  maximumCostMicros: string;
  currency: string;
  budget: KnowledgeLlmBudget;
  expiresAt: string;
  previewToken: string;
};

export const knowledgeLlmExecutionStatuses = [
  'reserved',
  'dispatched',
  'result_ready',
  'failed',
  'result_unknown',
] as const;
export type KnowledgeLlmExecutionStatus =
  (typeof knowledgeLlmExecutionStatuses)[number];
export const knowledgeLlmSettlementStatuses = [
  'reserved',
  'settled_actual',
  'released',
  'held_maximum',
] as const;
export type KnowledgeLlmSettlementStatus =
  (typeof knowledgeLlmSettlementStatuses)[number];

export type KnowledgeLlmRun = {
  id: string;
  provider: KnowledgeLlmProvider;
  model: string;
  catalogVersion: number;
  promptTemplateVersion: number;
  scope: KnowledgeScope;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  maximumCostMicros: string;
  actualInputTokens: number | null;
  actualOutputTokens: number | null;
  actualCostMicros: string | null;
  currency: string;
  softLimitWarning: boolean;
  executionStatus: KnowledgeLlmExecutionStatus;
  settlementStatus: KnowledgeLlmSettlementStatus;
  failureCode: string | null;
  result: string | null;
  conversationId: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  completedAt: string | null;
};

export type KnowledgeLlmExecuteResult = {
  created: boolean;
  reused: boolean;
  run: KnowledgeLlmRun;
};

export type KnowledgeLlmCandidate = {
  sourceType: KnowledgeLlmSourceType;
  key: string;
  label: string;
  detail: string;
  selectable: boolean;
  selectedByDefault: boolean;
};

export type KnowledgeLlmContextCandidate = KnowledgeLlmSourceSelector & {
  exactSourceVersion: number;
  byteLength: number;
  createdAt: string;
};

export const KNOWLEDGE_LLM_MAX_PROMPT_BYTES = 16 * 1024;
export const KNOWLEDGE_LLM_MAX_SOURCES = 32;

export function knowledgeLlmUtf8Length(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function validateKnowledgeLlmRequest(input: {
  request: KnowledgeLlmRequest;
  catalog: KnowledgeLlmCatalog;
}): string | null {
  const { request, catalog } = input;
  if (!catalog.enabled || catalog.version === null || !catalog.provider) {
    return '外部LLMは無効です。管理者設定を確認してください。';
  }
  const model = catalog.models.find(
    (entry) =>
      entry.provider === request.provider && entry.model === request.model,
  );
  if (!model || request.catalogVersion !== catalog.version) {
    return '許可されたprovider/modelを選択してください。';
  }
  if (!request.userPrompt.trim()) return '指示を入力してください。';
  if (
    knowledgeLlmUtf8Length(request.userPrompt) > KNOWLEDGE_LLM_MAX_PROMPT_BYTES
  ) {
    return '指示はUTF-8で16 KiB以内にしてください。';
  }
  if (
    !Number.isSafeInteger(request.maxOutputTokens) ||
    request.maxOutputTokens < 1 ||
    request.maxOutputTokens > model.maxOutputTokens
  ) {
    return '最大出力token数を許可範囲内で指定してください。';
  }
  if (
    request.sources.length < 1 ||
    request.sources.length > KNOWLEDGE_LLM_MAX_SOURCES
  ) {
    return '送信するsourceを1件以上32件以内で選択してください。';
  }
  if (
    request.scope === 'personal'
      ? request.organizationId !== null
      : !request.organizationId
  ) {
    return 'Knowledge itemのscopeを確認してください。';
  }
  return null;
}

export function formatKnowledgeLlmCost(value: string | null, currency: string) {
  if (value === null || !/^[0-9]+$/.test(value)) return '-';
  return `${value} ${currency} micro-unit`;
}

export function knowledgeLlmRunNeedsReconciliation(run: KnowledgeLlmRun) {
  return (
    run.executionStatus === 'result_unknown' ||
    run.settlementStatus === 'held_maximum' ||
    (run.settlementStatus === 'reserved' &&
      (run.executionStatus === 'reserved' ||
        run.executionStatus === 'dispatched'))
  );
}
