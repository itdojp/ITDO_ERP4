import type { Readable } from 'stream';

export type ChatAttachmentProvider = 'local' | 'gdrive';

export type ChatAttachmentStoreInput = {
  buffer: Buffer;
  originalName: string;
  mimeType?: string | null;
};

export type ChatAttachmentStoreResult = {
  provider: ChatAttachmentProvider;
  providerKey: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string | null;
  originalName: string;
};

export type ChatAttachmentStoragePort = {
  getProvider(): ChatAttachmentProvider;
  store(input: ChatAttachmentStoreInput): Promise<ChatAttachmentStoreResult>;
  open(
    provider: ChatAttachmentProvider,
    providerKey: string,
  ): Promise<{ stream: Readable }>;
};
