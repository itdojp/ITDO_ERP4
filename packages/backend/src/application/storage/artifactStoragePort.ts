import type { Readable } from 'node:stream';

export const STORAGE_ARTIFACT_CONTEXTS = [
  'pdf',
  'evidence',
  'evidence_metadata',
  'report',
  'knowledge',
] as const;

export type StorageArtifactContext = (typeof STORAGE_ARTIFACT_CONTEXTS)[number];
export type StorageArtifactProvider = 'gdrive' | 'local';
export type StorageArtifactBody = Buffer | (() => Readable);

export type StoreArtifactInput = {
  body: StorageArtifactBody;
  contentType: string | null;
  createdBy?: string | null;
  idempotencyKey?: string;
  originalName: string;
  ownerId?: string | null;
  ownerType?: string | null;
  sha256: string;
  sizeBytes: number;
  storageName?: string;
};

export type RecoverArtifactInput = Omit<StoreArtifactInput, 'body'> & {
  idempotencyKey: string;
};

export type StoredArtifact = {
  artifactId: string;
  contentType: string | null;
  createdAt: string;
  originalName: string;
  provider: StorageArtifactProvider;
  sha256: string;
  sizeBytes: number;
};

export type OpenedArtifact = {
  artifact: StoredArtifact;
  stream: Readable;
};

export type OpenArtifactScope = {
  ownerId: string;
  ownerType: string;
};

const ARTIFACT_UNAVAILABLE_ERRORS = new Set([
  'artifact_not_found',
  'artifact_provider_key_invalid',
  'artifact_local_io_failed',
]);

export function isArtifactUnavailableError(error: unknown) {
  return (
    error instanceof Error && ARTIFACT_UNAVAILABLE_ERRORS.has(error.message)
  );
}

export type ArtifactStoragePort = {
  open(artifactId: string, scope?: OpenArtifactScope): Promise<OpenedArtifact>;
  /**
   * Verifies and finalizes only an already-materialized idempotent artifact.
   * This operation must never create or upload provider content.
   */
  recover(input: RecoverArtifactInput): Promise<StoredArtifact | null>;
  store(input: StoreArtifactInput): Promise<StoredArtifact>;
};
