import type {
  KnowledgeActor,
  KnowledgeAuditActorContext,
} from './knowledgeItemPorts.js';
import type { KnowledgePageBoundary } from './knowledgeProvenancePorts.js';
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

export type KnowledgeLlmContextCandidate = {
  sourceType: KnowledgeLlmContextSourceType;
  sourceId: string;
  exactSourceVersion: number;
  byteLength: number;
  createdAt: Date;
};

export type KnowledgeLlmContextCandidatePage = {
  items: KnowledgeLlmContextCandidate[];
  nextBoundary: KnowledgePageBoundary | null;
};

export interface KnowledgeLlmContextCandidatePort {
  list(input: {
    actor: KnowledgeActor;
    itemId: string;
    scope: 'personal' | 'organization';
    organizationId: string | null;
    sourceType: KnowledgeLlmContextSourceType;
    limit: number;
    boundary?: KnowledgePageBoundary;
  }): Promise<KnowledgeLlmContextCandidatePage | null>;
}

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

export type KnowledgeLlmCapturedProviderOutcome =
  | {
      status: 'valid';
      normalizedContent: string;
      inputTokens: number;
      outputTokens: number;
    }
  | {
      status: 'usage_unknown';
      normalizedContent: string;
      failureCode: 'usage_missing' | 'usage_invalid';
    }
  | {
      status: 'invalid';
      failureCode:
        | 'provider_4xx'
        | 'provider_5xx'
        | 'malformed_response'
        | 'response_oversize'
        | 'empty_result';
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

  /**
   * Persists one normalized provider outcome in an independent transaction.
   * Replays may only confirm the exact same immutable outcome.
   */
  captureProviderOutcome(input: {
    actor: KnowledgeActor;
    runId: string;
    outcome: KnowledgeLlmCapturedProviderOutcome;
  }): Promise<void>;

  /** Finalizes a previously captured outcome without provider redispatch. */
  finalizeCapturedOutcome(input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    runId: string;
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
