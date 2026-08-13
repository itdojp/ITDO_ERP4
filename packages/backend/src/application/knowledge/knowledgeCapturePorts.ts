import type {
  KnowledgeActor,
  KnowledgeAuditActor,
  KnowledgeItemScope,
  KnowledgeSourceType,
} from './knowledgeItemPorts.js';
import type { KnowledgeCaptureChannel } from './knowledgeCaptureDraft.js';

export const knowledgeCaptureStatuses = ['pending', 'ready', 'failed'] as const;
export type KnowledgeCaptureStatus = (typeof knowledgeCaptureStatuses)[number];

export type KnowledgeCaptureFailureCode = 'snapshot_storage_failed';

export type KnowledgeCapture = {
  id: string;
  ownerUserId: string;
  requestKeyHash: string;
  payloadHash: string;
  channel: KnowledgeCaptureChannel;
  scope: KnowledgeItemScope;
  organizationId: string | null;
  knowledgeItemId: string;
  snapshotId: string;
  snapshotVersion: number;
  status: KnowledgeCaptureStatus;
  failureCode: KnowledgeCaptureFailureCode | null;
  selectedFieldCount: number;
  payloadByteCount: number;
  version: number;
  createdAt: Date;
  committedAt: Date | null;
  failedAt: Date | null;
  updatedAt: Date;
};

export type KnowledgeCaptureCreateRecord = {
  id: string;
  ownerUserId: string;
  requestKeyHash: string;
  payloadHash: string;
  channel: KnowledgeCaptureChannel;
  scope: KnowledgeItemScope;
  organizationId: string | null;
  groupAccountIds: string[];
  sourceType: KnowledgeSourceType;
  canonicalUrl: string | null;
  title: string | null;
  sourceAuthor: string | null;
  publishedAt: Date | null;
  capturedAt: Date;
  itemId: string;
  snapshotId: string;
  snapshotRequestKeyHash: string;
  snapshotPayloadHash: string;
  selectedFieldCount: number;
  payloadByteCount: number;
  createdBy: string;
};

export type KnowledgeCaptureAuditAction =
  | 'knowledge_capture_previewed'
  | 'knowledge_capture_committed'
  | 'knowledge_capture_duplicate_detected'
  | 'knowledge_capture_pending'
  | 'knowledge_capture_reconciled'
  | 'knowledge_capture_rejected'
  | 'knowledge_capture_discarded';

export type KnowledgeCaptureAuditEntry = {
  action: KnowledgeCaptureAuditAction;
  actor: KnowledgeAuditActor;
  targetId: string;
  metadata: {
    channel: KnowledgeCaptureChannel;
    scope: KnowledgeItemScope;
    fieldCount: number;
    byteCount: number;
    resultCode: string;
  };
};

export interface KnowledgeCaptureAuditWriter {
  write(entry: KnowledgeCaptureAuditEntry): Promise<void>;
}

export interface KnowledgeCaptureRepository {
  countActiveGroups(groupAccountIds: string[]): Promise<number>;
  findByRequestKey(input: {
    ownerUserId: string;
    requestKeyHash: string;
  }): Promise<KnowledgeCapture | null>;
  findRecentByPayload(input: {
    ownerUserId: string;
    payloadHash: string;
  }): Promise<KnowledgeCapture | null>;
  findOwnedById(input: {
    actor: KnowledgeActor;
    captureId: string;
  }): Promise<KnowledgeCapture | null>;
  findOwnedArtifactState(input: {
    actor: KnowledgeActor;
    captureId: string;
  }): Promise<{
    capture: KnowledgeCapture;
    contentType: string | null;
    originalName: string;
    sha256: string | null;
    sizeBytes: number | null;
  } | null>;
  createAggregate(
    input: KnowledgeCaptureCreateRecord,
  ): Promise<KnowledgeCapture>;
  recordMaterialized(input: {
    captureId: string;
    contentType: string;
    extractedText: string;
    sha256: string;
    sizeBytes: number;
  }): Promise<KnowledgeCapture | null>;
  markReady(input: {
    captureId: string;
    artifactId: string;
    contentType: string;
    sha256: string;
    sizeBytes: number;
    committedAt: Date;
  }): Promise<KnowledgeCapture | null>;
  markFailed(input: {
    captureId: string;
    failedAt: Date;
    failureCode: KnowledgeCaptureFailureCode;
  }): Promise<KnowledgeCapture | null>;
}

export type KnowledgeCaptureTransaction = {
  captures: KnowledgeCaptureRepository;
  audit: KnowledgeCaptureAuditWriter;
};

export interface KnowledgeCaptureUnitOfWork {
  run<T>(
    work: (transaction: KnowledgeCaptureTransaction) => Promise<T>,
  ): Promise<T>;
}

export class KnowledgeCaptureTransactionConflictError extends Error {
  constructor() {
    super('knowledge_capture_transaction_conflict');
    this.name = 'KnowledgeCaptureTransactionConflictError';
  }
}
