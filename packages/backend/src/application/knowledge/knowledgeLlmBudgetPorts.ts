import type {
  KnowledgeActor,
  KnowledgeAuditActor,
  KnowledgeAuditActorContext,
} from './knowledgeItemPorts.js';
import type { ExternalLlmProviderName } from '../externalLlm/externalLlmPort.js';

export type KnowledgeLlmRunScope = 'personal' | 'organization';

export type KnowledgeLlmContextSourceType =
  | 'snapshot'
  | 'annotation_revision'
  | 'conversation_turn'
  | 'synthesis_version'
  | 'thread_promotion_message';

export type KnowledgeLlmReservationRequest = {
  runId: string;
  actor: KnowledgeActor;
  auditActor: KnowledgeAuditActorContext;
  scope: KnowledgeLlmRunScope;
  organizationId: string | null;
  provider: ExternalLlmProviderName;
  model: string;
  catalogVersion: number;
  promptTemplateVersion: number;
  requestKeyHash: string;
  requestPayloadHash: string;
  selectedContextFingerprint: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  inputCostMicrosPerMillion: bigint;
  outputCostMicrosPerMillion: bigint;
  maximumCostMicros: bigint;
  currency: string;
  now: Date;
};

export type KnowledgeLlmReservationCommand = Omit<
  KnowledgeLlmReservationRequest,
  | 'inputCostMicrosPerMillion'
  | 'outputCostMicrosPerMillion'
  | 'maximumCostMicros'
  | 'currency'
  | 'now'
>;

/** Trusted server-side clock dependency; never construct it from request data. */
export type KnowledgeLlmClock = () => Date;

export type KnowledgeLlmReservationRecord = {
  runId: string;
  created: boolean;
  maximumCostMicros: bigint;
  currency: string;
  softLimitWarning: boolean;
};

export type KnowledgeLlmBudgetFailureCode =
  | 'invalid_request'
  | 'policy_not_found'
  | 'policy_mismatch'
  | 'budget_hard_limit'
  | 'rate_limit'
  | 'idempotency_conflict'
  | 'reservation_conflict';

export type KnowledgeLlmBudgetResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        status: 400 | 409 | 429;
        code: KnowledgeLlmBudgetFailureCode;
        message: string;
      };
    };

export interface KnowledgeLlmBudgetPort {
  reserve(
    input: KnowledgeLlmReservationRequest,
  ): Promise<KnowledgeLlmBudgetResult<KnowledgeLlmReservationRecord>>;
}

export type KnowledgeLlmAuditAction =
  | 'knowledge_llm_budget_reserved'
  | 'knowledge_llm_budget_blocked'
  | 'knowledge_llm_rate_blocked'
  | 'knowledge_llm_duplicate_detected'
  | 'knowledge_llm_dispatched'
  | 'knowledge_llm_completed'
  | 'knowledge_llm_failed'
  | 'knowledge_llm_result_unknown'
  | 'knowledge_llm_usage_unknown'
  | 'knowledge_llm_reconciled';

export type KnowledgeLlmTerminalFailureCode =
  | 'disabled'
  | 'rejected_before_dispatch'
  | 'provider_4xx'
  | 'provider_5xx'
  | 'malformed_response'
  | 'response_oversize'
  | 'empty_result'
  | 'timeout_outcome_unknown'
  | 'connection_outcome_unknown'
  | 'usage_missing'
  | 'usage_invalid'
  | 'finalization_failed';

export type KnowledgeLlmAuditMetadata =
  | {
      provider: ExternalLlmProviderName;
      model: string;
      scope: KnowledgeLlmRunScope;
      catalogVersion: number;
      estimatedInputTokens: number;
      maxOutputTokens: number;
      reservedCostMicros: string;
      currency: string;
      resultCode:
        'reserved' | 'reused' | 'conflict' | 'hard_blocked' | 'rate_blocked';
      policyCount: number;
      softLimitWarning: boolean;
    }
  | {
      provider: ExternalLlmProviderName;
      model: string;
      scope: KnowledgeLlmRunScope;
      catalogVersion: number;
      estimatedInputTokens: number;
      maxOutputTokens: number;
      reservedCostMicros: string;
      currency: string;
      resultCode:
        | 'dispatched'
        | 'completed'
        | 'failed'
        | 'result_unknown'
        | 'usage_unknown'
        | 'reconciled';
      policyCount: number;
      actualInputTokens?: number;
      actualOutputTokens?: number;
      actualCostMicros?: string;
      failureCode?: KnowledgeLlmTerminalFailureCode;
    };

export type KnowledgeLlmAuditEntry = {
  action: KnowledgeLlmAuditAction;
  actor: KnowledgeAuditActor;
  targetTable: 'knowledge_llm_runs';
  targetId: string;
  metadata: KnowledgeLlmAuditMetadata;
};

export interface KnowledgeLlmAuditWriter {
  write(entry: KnowledgeLlmAuditEntry): Promise<void>;
}
