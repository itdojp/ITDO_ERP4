import type {
  KnowledgeActor,
  KnowledgeAuditActorContext,
} from './knowledgeItemPorts.js';
import type {
  KnowledgeLlmContextSourceType,
  KnowledgeLlmSelectedContextSource,
} from './knowledgeLlmContext.js';
import type {
  KnowledgeLlmRunScope,
  KnowledgeLlmTerminalFailureCode,
} from './knowledgeLlmBudgetPorts.js';

export type KnowledgeLlmSourceSelector = {
  sourceType: KnowledgeLlmContextSourceType;
  sourceId: string;
};

export type KnowledgeLlmResolvedContext = {
  sources: KnowledgeLlmSelectedContextSource[];
  sourceCounts: Record<KnowledgeLlmContextSourceType, number>;
  selectedItemCount: number;
};

export type KnowledgeLlmRunRecord = {
  id: string;
  actorUserId: string;
  scope: KnowledgeLlmRunScope;
  organizationId: string | null;
  provider: 'stub' | 'openai';
  model: string;
  catalogVersion: number;
  promptTemplateVersion: number;
  requestPayloadHash: string;
  providerRequestHash: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  maximumCostMicros: bigint;
  softLimitWarning: boolean;
  actualInputTokens: number | null;
  actualOutputTokens: number | null;
  actualCostMicros: bigint | null;
  currency: string;
  executionStatus:
    'reserved' | 'dispatched' | 'result_ready' | 'failed' | 'result_unknown';
  settlementStatus: 'reserved' | 'settled_actual' | 'released' | 'held_maximum';
  failureCode:
    KnowledgeLlmTerminalFailureCode | 'budget_hard_limit' | 'rate_limit' | null;
  conversationId: string | null;
  assistantTurnId: string | null;
  resultContent: string | null;
  createdAt: Date;
  dispatchedAt: Date | null;
  completedAt: Date | null;
};

export type KnowledgeLlmBudgetSubjectSummary = {
  subjectType: 'user' | 'organization';
  currency: string;
  softLimitMicros: bigint;
  hardLimitMicros: bigint;
  activeReservedMicros: bigint;
  settledActualMicros: bigint;
  heldMaximumMicros: bigint;
  requestsPerHour: number;
  acceptedRequestsLastHour: number;
};

export type KnowledgeLlmBudgetPreview = {
  configured: boolean;
  policyCount: number;
  currency: string | null;
  softLimitWarning: boolean;
  hardLimitBlocked: boolean;
  rateBlocked: boolean;
  subjects: KnowledgeLlmBudgetSubjectSummary[];
};

export class KnowledgeLlmRunAccessError extends Error {
  readonly name = 'KnowledgeLlmRunAccessError';
  constructor(
    readonly code:
      | 'not_found'
      | 'stale_preview'
      | 'source_not_supported'
      | 'dispatch_conflict'
      | 'reconcile_conflict',
  ) {
    super(code);
  }
}

export interface KnowledgeLlmRunPort {
  resolveContext(input: {
    actor: KnowledgeActor;
    scope: KnowledgeLlmRunScope;
    organizationId: string | null;
    selectors: readonly KnowledgeLlmSourceSelector[];
  }): Promise<KnowledgeLlmResolvedContext>;

  budgetPreview(input: {
    actor: KnowledgeActor;
    scope: KnowledgeLlmRunScope;
    organizationId: string | null;
    maximumCostMicros: bigint;
    now: Date;
  }): Promise<KnowledgeLlmBudgetPreview>;

  writePreviewAudit(input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    runId: string;
    provider: 'stub' | 'openai';
    model: string;
    scope: KnowledgeLlmRunScope;
    catalogVersion: number;
    estimatedInputTokens: number;
    maxOutputTokens: number;
    maximumCostMicros: bigint;
    currency: string;
    sourceCounts: KnowledgeLlmResolvedContext['sourceCounts'];
  }): Promise<void>;

  findByRequestKey(input: {
    actor: KnowledgeActor;
    requestKeyHash: string;
  }): Promise<KnowledgeLlmRunRecord | null>;

  findOwned(input: {
    actor: KnowledgeActor;
    runId: string;
  }): Promise<KnowledgeLlmRunRecord | null>;

  authorizeAndMarkDispatched(input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    runId: string;
    scope: KnowledgeLlmRunScope;
    organizationId: string | null;
    selectors: readonly KnowledgeLlmSourceSelector[];
    expectedSources: readonly KnowledgeLlmSelectedContextSource[];
    expectedProviderRequestHash: string;
  }): Promise<void>;

  finalizeReportedResult(input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    runId: string;
    userPrompt: string;
    resultContent: string;
    inputTokens: number;
    outputTokens: number;
  }): Promise<KnowledgeLlmRunRecord>;

  finalizeUsageUnknownResult(input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    runId: string;
    userPrompt: string;
    resultContent: string;
    failureCode: 'usage_missing' | 'usage_invalid';
  }): Promise<KnowledgeLlmRunRecord>;

  holdResultUnknown(input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    runId: string;
    failureCode:
      | 'timeout_outcome_unknown'
      | 'connection_outcome_unknown'
      | 'finalization_failed';
  }): Promise<KnowledgeLlmRunRecord>;

  reconcile(input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    runId: string;
  }): Promise<void>;
}
