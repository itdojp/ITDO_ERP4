import type { Readable } from 'stream';

export type ObjectStoreBody = Buffer | ((start?: number) => Readable);

export type ObjectStorePutInput = {
  body: ObjectStoreBody;
  contentType: string | null;
  originalName: string;
  sha256: string;
  sizeBytes: number;
  appProperties?: Record<string, string>;
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
  appProperties?: Record<string, string>;
};

export type ObjectStoreListInput = {
  appProperties?: Record<string, string>;
  pageSize?: number;
};

export type ObjectStoreListResult = {
  items: ObjectStoreMetadata[];
};

export type ObjectStoreGetResult = {
  stream: Readable;
};

export type ObjectStore = {
  put(input: ObjectStorePutInput): Promise<ObjectStoreMetadata>;
  get(key: string): Promise<ObjectStoreGetResult>;
  list(input?: ObjectStoreListInput): Promise<ObjectStoreListResult>;
  stat(key: string): Promise<ObjectStoreMetadata>;
  trash(key: string): Promise<void>;
};
