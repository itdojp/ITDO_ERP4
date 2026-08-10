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

export const knowledgeShareStatuses = [
  'pending',
  'posted',
  'failed',
  'revoked',
] as const;
export type KnowledgeShareStatus = (typeof knowledgeShareStatuses)[number];

export const knowledgeShareFailureCodes = [
  'source_unavailable',
  'room_unavailable',
  'post_rejected',
] as const;
export type KnowledgeShareFailureCode =
  (typeof knowledgeShareFailureCodes)[number];

export const knowledgeShareSelectionCategories = [
  'title',
  'source_type',
  'canonical_url',
  'snapshot_provenance',
  'snapshot_excerpt',
  'label',
  'annotation',
  'conversation_turn',
  'synthesis',
  'sharer_note',
] as const;
export type KnowledgeShareSelectionCategory =
  (typeof knowledgeShareSelectionCategories)[number];

export const knowledgeShareLimits = {
  id: 200,
  requestKey: 200,
  previewTokenBytes: 4096,
  previewTtlMs: 10 * 60 * 1000,
  labels: 20,
  annotations: 20,
  turns: 50,
  syntheses: 10,
  sharerNoteBytes: 4096,
  excerptBytes: 4096,
  titleCodePoints: 500,
  urlBytes: 4096,
  labelNameCodePoints: 200,
  annotationBytes: 65536,
  turnBytes: 65536,
  synthesisBytes: 262144,
  unresolvedQuestions: 50,
} as const;

export type KnowledgeShareChatActor = {
  canonicalUserId: string;
  userId: string;
  roles: string[];
  projectIds: string[];
  groupIds: string[];
  groupAccountIds: string[];
};

export type KnowledgeShareSelection = {
  includeTitle: boolean;
  includeSourceType: boolean;
  includeCanonicalUrl: boolean;
  snapshot: {
    snapshotId: string;
    includeProvenance: boolean;
    includeExcerpt: boolean;
  } | null;
  labelAssignmentIds: string[];
  annotations: Array<{ annotationId: string; revision: number }>;
  conversationTurnIds: string[];
  syntheses: Array<{ synthesisId: string; version: number }>;
  sharerNote: string | null;
};

export type KnowledgeShareLabelSnapshot = {
  sourceAssignmentId: string;
  sourceLabelId: string;
  sourceLabelVersion: number;
  displayName: string;
  ordinal: number;
  contentHash: string;
};

export type KnowledgeShareAnnotationSnapshot = {
  sourceAnnotationId: string;
  sourceRevisionId: string;
  revision: number;
  kind: KnowledgeAnnotationKind;
  origin: KnowledgeProvenanceOrigin;
  content: string;
  ordinal: number;
  contentHash: string;
};

export type KnowledgeShareTurnSnapshot = {
  sourceConversationId: string;
  sourceConversationVersion: number;
  sourceTurnId: string;
  role: KnowledgeConversationRole;
  origin: KnowledgeProvenanceOrigin;
  content: string;
  name: string | null;
  occurredAt: Date | null;
  ordinal: number;
  contentHash: string;
};

export type KnowledgeShareSynthesisSnapshot = {
  sourceSynthesisId: string;
  sourceSynthesisVersionId: string;
  version: number;
  title: string;
  content: string;
  confidenceBasisPoints: number | null;
  unresolvedQuestions: string[];
  ordinal: number;
  contentHash: string;
};

export type KnowledgeShareCardSnapshot = {
  schemaVersion: 1;
  title?: string;
  sourceType?: KnowledgeSourceType;
  canonicalUrl?: string;
  snapshot?: {
    sourceSnapshotId: string;
    version: number;
    sha256: string;
    excerpt?: string;
  };
  sharerNote?: string;
  labels: KnowledgeShareLabelSnapshot[];
  annotations: KnowledgeShareAnnotationSnapshot[];
  turns: KnowledgeShareTurnSnapshot[];
  syntheses: KnowledgeShareSynthesisSnapshot[];
  selectedCategories: KnowledgeShareSelectionCategory[];
  omittedCategories: KnowledgeShareSelectionCategory[];
  contentHash: string;
};

export type KnowledgeShareResolvedPreview = {
  sourceItemId: string;
  sourceOwnerUserId: string;
  sourceItemVersion: number;
  sourceItemUpdatedAt: Date;
  destinationRoomId: string;
  destinationRoomName: string;
  destinationRoomType: string;
  snapshot: KnowledgeShareCardSnapshot;
  selectionHash: string;
  bindingHash: string;
};

export type KnowledgeShareStatusRecord = {
  shareId: string;
  status: KnowledgeShareStatus;
  version: number;
  chatMessageId: string | null;
  failureCode: KnowledgeShareFailureCode | null;
  createdAt: Date;
  postedAt: Date | null;
  failedAt: Date | null;
  revokedAt: Date | null;
};

export type KnowledgeShareRoomCardRecord = {
  shareId: string;
  status: 'posted' | 'revoked';
  version: number;
  schemaVersion: 1;
  card: KnowledgeShareCardSnapshot | null;
  canOpenSource: boolean;
};

export type KnowledgeShareCommitRecord = KnowledgeShareStatusRecord & {
  created: boolean;
};

export type KnowledgeShareFailure = {
  status: number;
  code:
    | 'invalid_request'
    | 'not_found'
    | 'stale_preview'
    | 'preview_token_invalid'
    | 'preview_token_expired'
    | 'idempotency_conflict'
    | 'external_audience_not_supported'
    | 'share_post_failed';
  message: string;
};

export type KnowledgeSharePortResult<T> =
  { ok: true; value: T } | { ok: false; error: KnowledgeShareFailure };

export type KnowledgeSharePreviewInput = {
  actor: KnowledgeActor;
  chatActor: KnowledgeShareChatActor;
  auditActor: KnowledgeAuditActorContext;
  itemId: string;
  destinationRoomId: string;
  selection: KnowledgeShareSelection;
};

export interface KnowledgeShareStorePort {
  preview(
    input: KnowledgeSharePreviewInput & { shareId: string },
  ): Promise<KnowledgeSharePortResult<KnowledgeShareResolvedPreview>>;

  resolveForCommit(
    input: Omit<KnowledgeSharePreviewInput, 'auditActor'>,
  ): Promise<KnowledgeSharePortResult<KnowledgeShareResolvedPreview>>;

  findIdempotent(input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    requestKeyHash: string;
    requestPayloadHash: string;
  }): Promise<KnowledgeSharePortResult<KnowledgeShareCommitRecord | null>>;

  createPending(input: {
    actor: KnowledgeActor;
    chatActor: KnowledgeShareChatActor;
    auditActor: KnowledgeAuditActorContext;
    itemId: string;
    destinationRoomId: string;
    selection: KnowledgeShareSelection;
    expectedBindingHash: string;
    requestKeyHash: string;
    requestPayloadHash: string;
    shareId: string;
  }): Promise<KnowledgeSharePortResult<KnowledgeShareCommitRecord>>;

  findStatus(input: {
    actor: KnowledgeActor;
    chatActor: KnowledgeShareChatActor;
    shareId: string;
  }): Promise<KnowledgeSharePortResult<KnowledgeShareStatusRecord>>;

  revoke(input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    shareId: string;
  }): Promise<KnowledgeSharePortResult<KnowledgeShareStatusRecord>>;

  openSource(input: {
    actor: KnowledgeActor;
    chatActor: KnowledgeShareChatActor;
    shareId: string;
  }): Promise<KnowledgeSharePortResult<{ knowledgeItemId: string }>>;

  readRoomCard(input: {
    actor: KnowledgeActor;
    chatActor: KnowledgeShareChatActor;
    messageId: string;
  }): Promise<KnowledgeSharePortResult<KnowledgeShareRoomCardRecord>>;
}

export interface KnowledgeShareChatIntegrationPort {
  postPending(input: {
    actor: KnowledgeActor;
    chatActor: KnowledgeShareChatActor;
    auditActor: KnowledgeAuditActorContext;
    shareId: string;
    expectedBindingHash: string;
  }): Promise<KnowledgeSharePortResult<KnowledgeShareStatusRecord>>;

  reconcile(input: {
    actor: KnowledgeActor;
    chatActor: KnowledgeShareChatActor;
    auditActor: KnowledgeAuditActorContext;
    shareId: string;
  }): Promise<KnowledgeSharePortResult<KnowledgeShareStatusRecord>>;

  notifyPosted(input: {
    actor: KnowledgeActor;
    chatActor: KnowledgeShareChatActor;
    auditActor: KnowledgeAuditActorContext;
    shareId: string;
  }): Promise<void>;
}

export type KnowledgeShareAuditAction =
  | 'knowledge_share_previewed'
  | 'knowledge_share_requested'
  | 'knowledge_share_posted'
  | 'knowledge_share_failed'
  | 'knowledge_share_reconciled'
  | 'knowledge_share_duplicate_detected'
  | 'knowledge_share_revoked';

export type KnowledgeShareAuditMetadata = {
  schemaVersion: 1;
  status?: KnowledgeShareStatus;
  resultCode?:
    'created' | 'reused' | 'posted' | 'pending' | 'failed' | 'revoked';
  duplicate?: boolean;
  scope?: KnowledgeItemScope;
  selectedCategoryCount?: number;
  labelCount?: number;
  annotationCount?: number;
  turnCount?: number;
  synthesisCount?: number;
};

export type KnowledgeShareAuditEntry = {
  action: KnowledgeShareAuditAction;
  actor: KnowledgeAuditActor;
  targetTable: 'knowledge_shares';
  targetId: string;
  metadata: KnowledgeShareAuditMetadata;
};

export interface KnowledgeShareAuditWriter {
  write(entry: KnowledgeShareAuditEntry): Promise<void>;
}
