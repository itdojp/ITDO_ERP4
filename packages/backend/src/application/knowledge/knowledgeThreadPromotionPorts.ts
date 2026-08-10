import type {
  KnowledgeActor,
  KnowledgeAuditActor,
  KnowledgeAuditActorContext,
  KnowledgeItemScope,
  KnowledgeSourceType,
} from './knowledgeItemPorts.js';
import type {
  KnowledgeAnnotationKind,
  KnowledgeConversationRole,
  KnowledgeProvenanceOrigin,
} from './knowledgeProvenancePorts.js';

export const knowledgeThreadPromotionAuthorCategories = ['user'] as const;
export type KnowledgeThreadPromotionAuthorCategory =
  (typeof knowledgeThreadPromotionAuthorCategories)[number];

export const knowledgeThreadPromotionLimits = {
  id: 200,
  requestKey: 200,
  previewTokenBytes: 4096,
  previewTtlMs: 10 * 60 * 1000,
  selectedReplies: 100,
  organizationGroupAccountIds: 20,
  titleCodePoints: 500,
  synthesisContentBytes: 256 * 1024,
  unresolvedQuestions: 50,
  unresolvedQuestionCodePoints: 4000,
  selectedMessageBytes: 64 * 1024,
} as const;

export type KnowledgeThreadPromotionDestination =
  | {
      scope: 'personal';
      organizationGroupAccountIds: [];
    }
  | {
      scope: 'organization';
      organizationGroupAccountIds: string[];
    };

export type KnowledgeThreadPromotionSynthesisDraft = {
  title: string;
  content: string;
  confidenceBasisPoints: number | null;
  unresolvedQuestions: string[];
};

/**
 * Canonical request shared by preview and commit.  Reply order is meaningful;
 * callers must not sort this list or silently add the root/other replies.
 */
export type KnowledgeThreadPromotionRequest = {
  selectedReplyMessageIds: string[];
  includeSharedCard: boolean;
  destination: KnowledgeThreadPromotionDestination;
  synthesis: KnowledgeThreadPromotionSynthesisDraft;
};

export type KnowledgeThreadPromotionSelectedMessage = {
  sourceMessageId: string;
  /** Internal exact-version boundary; public API projections omit it. */
  sourceActivitySequence: bigint;
  ordinal: number;
  content: string;
  contentHash: string;
  createdAt: Date;
  authorCategory: KnowledgeThreadPromotionAuthorCategory;
};

/**
 * Public-safe immutable card material.  Internal Knowledge/Chat source IDs are
 * deliberately absent even though the persistence adapter retains exact FKs.
 */
export type KnowledgeThreadPromotionShareCardPreview = {
  schemaVersion: 1;
  shareVersion: number;
  title?: string;
  sourceType?: KnowledgeSourceType;
  canonicalUrl?: string;
  snapshot?: {
    version: number;
    sha256: string;
    excerpt?: string;
  };
  sharerNote?: string;
  labels: Array<{ displayName: string; ordinal: number }>;
  annotations: Array<{
    revision: number;
    kind: KnowledgeAnnotationKind;
    origin: KnowledgeProvenanceOrigin;
    content: string;
    ordinal: number;
  }>;
  turns: Array<{
    role: KnowledgeConversationRole;
    origin: KnowledgeProvenanceOrigin;
    content: string;
    name: string | null;
    occurredAt: Date | null;
    ordinal: number;
  }>;
  syntheses: Array<{
    version: number;
    title: string;
    content: string;
    confidenceBasisPoints: number | null;
    unresolvedQuestions: string[];
    ordinal: number;
  }>;
  selectedCategories: string[];
};

export type KnowledgeThreadPromotionResolvedPreview = {
  promotionId: string;
  rootMessageId: string;
  sourceRoomName: string;
  sourceRoomType: string;
  sourceShareVersion: number;
  sourceShareContentHash: string;
  threadReplyCount: number;
  selectedMessages: KnowledgeThreadPromotionSelectedMessage[];
  selectedShareCard: KnowledgeThreadPromotionShareCardPreview | null;
  destination: KnowledgeThreadPromotionDestination;
  bindingHash: string;
};

export type KnowledgeThreadPromotionCommitRecord = {
  promotionId: string;
  synthesisId: string;
  synthesisVersionId: string;
  synthesisVersion: 1;
  scope: KnowledgeItemScope;
  selectedMessageCount: number;
  includesSharedCard: boolean;
  createdAt: Date;
  created: boolean;
};

export type KnowledgeThreadPromotionFailure = {
  status: number;
  code:
    | 'invalid_request'
    | 'not_found'
    | 'stale_preview'
    | 'preview_token_invalid'
    | 'preview_token_expired'
    | 'idempotency_conflict'
    | 'organization_confirmation_required'
    | 'promotion_conflict';
  message: string;
};

export type KnowledgeThreadPromotionPortResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: KnowledgeThreadPromotionFailure };

export interface KnowledgeThreadPromotionStorePort {
  /** Resolves exact current state and writes the mandatory preview audit. */
  preview(input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    rootMessageId: string;
    promotionId: string;
    request: KnowledgeThreadPromotionRequest;
  }): Promise<
    KnowledgeThreadPromotionPortResult<KnowledgeThreadPromotionResolvedPreview>
  >;

  /** Re-resolves current ACL, root/share state and selected reply hashes. */
  resolveForCommit(input: {
    actor: KnowledgeActor;
    rootMessageId: string;
    promotionId: string;
    request: KnowledgeThreadPromotionRequest;
  }): Promise<
    KnowledgeThreadPromotionPortResult<KnowledgeThreadPromotionResolvedPreview>
  >;

  /**
   * Returns an existing exact request and writes duplicate audit atomically.
   * A reused key with another payload returns idempotency_conflict.
   */
  findIdempotent(input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    requestKeyHash: string;
    requestPayloadHash: string;
  }): Promise<
    KnowledgeThreadPromotionPortResult<KnowledgeThreadPromotionCommitRecord | null>
  >;

  /**
   * Atomically creates promotion snapshots, synthesis v1, exactly-one source,
   * explicit organization grants, request ledger and mandatory audits.
   */
  commit(input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    rootMessageId: string;
    promotionId: string;
    request: KnowledgeThreadPromotionRequest;
    expectedBindingHash: string;
    requestKeyHash: string;
    requestPayloadHash: string;
  }): Promise<
    KnowledgeThreadPromotionPortResult<KnowledgeThreadPromotionCommitRecord>
  >;
}

export type KnowledgeThreadPromotionAuditAction =
  | 'knowledge_thread_promote_previewed'
  | 'knowledge_thread_promoted'
  | 'knowledge_thread_promote_duplicate_detected'
  | 'knowledge_thread_promote_rejected';

export type KnowledgeThreadPromotionAuditMetadata = {
  schemaVersion: 1;
  resultCode: 'previewed' | 'created' | 'reused' | 'rejected' | 'conflict';
  scope: KnowledgeItemScope;
  selectedMessageCount: number;
  includesSharedCard: boolean;
  organizationGrantCount: number;
  duplicate: boolean;
};

export type KnowledgeThreadPromotionAuditEntry = {
  action: KnowledgeThreadPromotionAuditAction;
  actor: KnowledgeAuditActor;
  targetTable: 'knowledge_thread_promotions';
  targetId: string;
  metadata: KnowledgeThreadPromotionAuditMetadata;
};

export interface KnowledgeThreadPromotionAuditWriter {
  write(entry: KnowledgeThreadPromotionAuditEntry): Promise<void>;
}
