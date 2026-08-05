import type {
  KnowledgeActor,
  KnowledgeAuditActor,
} from './knowledgeItemPorts.js';

export const knowledgeSnapshotStatuses = [
  'pending',
  'ready',
  'failed',
] as const;
export type KnowledgeSnapshotStatus =
  (typeof knowledgeSnapshotStatuses)[number];

export const knowledgeSnapshotCaptureMethods = [
  'text',
  'url',
  'upload',
] as const;
export type KnowledgeSnapshotCaptureMethod =
  (typeof knowledgeSnapshotCaptureMethods)[number];

export const knowledgeSnapshotLimits = {
  itemId: 100,
  snapshotId: 100,
  requestKey: 200,
  originalName: 255,
  sourceUrl: 4096,
  maxBytes: 10 * 1024 * 1024,
  maxTextBytes: 1024 * 1024,
  maxExtractedTextCodePoints: 250_000,
  fetchTimeoutMs: 10_000,
  listLimit: 100,
} as const;

export type KnowledgeSnapshot = {
  id: string;
  knowledgeItemId: string;
  artifactId: string | null;
  version: number;
  status: KnowledgeSnapshotStatus;
  captureMethod: KnowledgeSnapshotCaptureMethod;
  sourceUrl: string | null;
  originalName: string;
  contentType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  extractedText: string | null;
  requestKeyHash: string;
  requestPayloadHash: string;
  failureCode: string | null;
  capturedAt: Date;
  capturedBy: string;
  readyAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type KnowledgeSnapshotIntentRecord = {
  id: string;
  knowledgeItemId: string;
  version: number;
  captureMethod: KnowledgeSnapshotCaptureMethod;
  sourceUrl: string | null;
  originalName: string;
  requestKeyHash: string;
  requestPayloadHash: string;
  capturedAt: Date;
  capturedBy: string;
};

export type KnowledgeSnapshotMaterializedRecord = {
  contentType: string;
  extractedText: string | null;
  sha256: string;
  sizeBytes: number;
  snapshotId: string;
};

export interface KnowledgeSnapshotReadRepository {
  findVisibleById(input: {
    actor: KnowledgeActor;
    itemId: string;
    snapshotId: string;
  }): Promise<KnowledgeSnapshot | null>;
  listVisible(input: {
    actor: KnowledgeActor;
    itemId: string;
    limit: number;
  }): Promise<KnowledgeSnapshot[] | null>;
}

export interface KnowledgeSnapshotWriteRepository {
  findByRequestKey(input: {
    itemId: string;
    requestKeyHash: string;
  }): Promise<KnowledgeSnapshot | null>;
  findOwnedItem(input: {
    actor: KnowledgeActor;
    itemId: string;
  }): Promise<{ id: string; ownerUserId: string } | null>;
  findOwnedSnapshot(input: {
    actor: KnowledgeActor;
    itemId: string;
    snapshotId: string;
  }): Promise<KnowledgeSnapshot | null>;
  nextVersion(itemId: string): Promise<number>;
  createIntent(
    input: KnowledgeSnapshotIntentRecord,
  ): Promise<KnowledgeSnapshot>;
  recordMaterialized(
    input: KnowledgeSnapshotMaterializedRecord,
  ): Promise<KnowledgeSnapshot | null>;
  markReady(input: {
    artifactId: string;
    contentType: string;
    readyAt: Date;
    sha256: string;
    sizeBytes: number;
    snapshotId: string;
  }): Promise<KnowledgeSnapshot | null>;
  markFailed(input: {
    failedAt: Date;
    failureCode: string;
    snapshotId: string;
  }): Promise<KnowledgeSnapshot | null>;
}

export type KnowledgeSnapshotAuditAction =
  | 'knowledge_snapshot_capture_requested'
  | 'knowledge_snapshot_capture_ready'
  | 'knowledge_snapshot_capture_failed'
  | 'knowledge_snapshot_reconciled'
  | 'knowledge_snapshot_downloaded';

export type KnowledgeSnapshotAuditEntry = {
  action: KnowledgeSnapshotAuditAction;
  actor: KnowledgeAuditActor;
  targetId: string;
  metadata: {
    itemId: string;
    version: number;
    status: KnowledgeSnapshotStatus;
    captureMethod: KnowledgeSnapshotCaptureMethod;
    contentType?: string;
    sha256?: string;
    sizeBytes?: number;
    failureCode?: string;
  };
};

export interface KnowledgeSnapshotAuditWriter {
  write(entry: KnowledgeSnapshotAuditEntry): Promise<void>;
}

export type KnowledgeSnapshotTransaction = {
  audit: KnowledgeSnapshotAuditWriter;
  snapshots: KnowledgeSnapshotReadRepository & KnowledgeSnapshotWriteRepository;
};

export interface KnowledgeSnapshotUnitOfWork {
  run<T>(
    work: (transaction: KnowledgeSnapshotTransaction) => Promise<T>,
  ): Promise<T>;
}

export class KnowledgeSnapshotTransactionConflictError extends Error {
  constructor() {
    super('knowledge_snapshot_transaction_conflict');
  }
}
