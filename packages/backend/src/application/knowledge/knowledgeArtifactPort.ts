import type { Readable } from 'node:stream';

export type KnowledgeArtifactStoreInput = {
  body: Buffer;
  contentType: string;
  createdBy: string;
  idempotencyNamespace: string;
  originalName: string;
  sha256: string;
  sizeBytes: number;
  snapshotId: string;
};

export type KnowledgeArtifact = {
  artifactId: string;
  contentType: string | null;
  createdAt: string;
  originalName: string;
  provider: 'gdrive' | 'local';
  sha256: string;
  sizeBytes: number;
};

export type OpenedKnowledgeArtifact = {
  artifact: KnowledgeArtifact;
  stream: Readable;
};

export class KnowledgeArtifactStoreError extends Error {
  constructor(readonly outcome: 'failed' | 'unknown') {
    super('knowledge_artifact_store_failed');
    this.name = 'KnowledgeArtifactStoreError';
  }
}

export class KnowledgeArtifactOpenError extends Error {
  constructor(readonly kind: 'not_found' | 'storage_failure') {
    super(
      kind === 'not_found'
        ? 'knowledge_artifact_not_found'
        : 'knowledge_artifact_open_failed',
    );
    this.name = 'KnowledgeArtifactOpenError';
  }
}

export type KnowledgeArtifactReconcileInput = {
  contentType: string;
  idempotencyNamespace: string;
  originalName: string;
  sha256: string;
  sizeBytes: number;
  snapshotId: string;
};

/**
 * Knowledge-only storage boundary. The implementation fixes ownerType to
 * `knowledge_snapshot` and requires snapshotId for every operation, so callers
 * cannot omit the owner scope accepted by the shared ArtifactStoragePort.
 */
export type KnowledgeArtifactPort = {
  open(input: {
    artifactId: string;
    snapshotId: string;
  }): Promise<OpenedKnowledgeArtifact>;
  reconcile(
    input: KnowledgeArtifactReconcileInput,
  ): Promise<KnowledgeArtifact | null>;
  store(input: KnowledgeArtifactStoreInput): Promise<KnowledgeArtifact>;
};
