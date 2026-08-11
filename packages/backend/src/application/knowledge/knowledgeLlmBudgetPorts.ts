import type {
  KnowledgeActor,
  KnowledgeAuditActor,
  KnowledgeAuditActorContext,
} from './knowledgeItemPorts.js';
import type { ExternalLlmProviderName } from '../externalLlm/externalLlmPort.js';

export type KnowledgeLlmRunScope = 'personal' | 'organization';

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
  maximumCostMicros: bigint;
  currency: string;
  now: Date;
};

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
  | 'knowledge_llm_duplicate_detected';

export type KnowledgeLlmAuditMetadata = {
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
