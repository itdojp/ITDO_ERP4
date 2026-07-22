import type { Readable } from 'stream';

export type ObjectStoreBody = Buffer | (() => Readable);

export type ObjectStorePutInput = {
  body: ObjectStoreBody;
  contentType: string | null;
  idempotencyKey?: string;
  originalName: string;
  sha256: string;
  sizeBytes: number;
};

export type ObjectStoreChecksum = {
  md5?: string;
  sha1?: string;
  sha256?: string;
};

export type ObjectStoreMetadata = {
  key: string;
  checksum: ObjectStoreChecksum;
  contentType: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  originalName: string;
  sizeBytes: number | null;
  trashed: boolean;
};

export type ObjectStoreGetResult = {
  stream: Readable;
};

export type ObjectStore = {
  put(input: ObjectStorePutInput): Promise<ObjectStoreMetadata>;
  get(key: string): Promise<ObjectStoreGetResult>;
  stat(key: string): Promise<ObjectStoreMetadata>;
  trash(key: string): Promise<void>;
};
