import { createHash, randomUUID } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import path from 'path';

import type {
  ChatAttachmentProvider,
  ChatAttachmentStoragePort,
  ChatAttachmentStoreInput,
} from '../../application/chat/chatAttachmentStoragePort.js';
import {
  formatGoogleDriveLegacyEnvWarning,
  GoogleDriveConfigurationError,
  resolveGoogleDriveCredentials,
  resolveGoogleDriveSharedDriveId,
  resolveGoogleDriveTuningConfig,
} from '../../infrastructure/storage/googleDriveConfig.js';
import {
  createGoogleDriveApi,
  GoogleDriveObjectStore,
} from '../../infrastructure/storage/googleDriveObjectStore.js';
import type { ObjectStore } from '../../infrastructure/storage/objectStore.js';

type ChatAttachmentStorageAdapterOptions = {
  env?: NodeJS.ProcessEnv;
  objectStoreFactory?: (options: {
    credentials: ReturnType<typeof resolveGoogleDriveCredentials>;
    folderId: string;
    sharedDriveId?: string;
    tuning: ReturnType<typeof resolveGoogleDriveTuningConfig>;
  }) => ObjectStore;
  warn?: (message: string) => void;
};

function normalizeProvider(raw?: string): ChatAttachmentProvider {
  return raw?.trim().toLowerCase() === 'gdrive' ? 'gdrive' : 'local';
}

function sanitizeFilename(value: string) {
  return value
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createChatAttachmentStorageAdapter(
  options: ChatAttachmentStorageAdapterOptions = {},
): ChatAttachmentStoragePort {
  const env = options.env ?? process.env;
  let objectStore: ObjectStore | null = null;

  const getObjectStore = () => {
    if (objectStore) return objectStore;
    const folderId = env.CHAT_ATTACHMENT_GDRIVE_FOLDER_ID?.trim();
    if (!folderId) {
      throw new GoogleDriveConfigurationError([
        'CHAT_ATTACHMENT_GDRIVE_FOLDER_ID',
      ]);
    }
    const credentials = resolveGoogleDriveCredentials(env);
    const warning = formatGoogleDriveLegacyEnvWarning(
      credentials.deprecatedAliasesPresent,
    );
    if (warning) (options.warn ?? console.warn)(warning);
    const tuning = resolveGoogleDriveTuningConfig(env);
    const sharedDriveId = resolveGoogleDriveSharedDriveId(env);
    objectStore = options.objectStoreFactory
      ? options.objectStoreFactory({
          credentials,
          folderId,
          sharedDriveId,
          tuning,
        })
      : new GoogleDriveObjectStore(createGoogleDriveApi(credentials), {
          folderId,
          sharedDriveId,
          ...tuning,
        });
    return objectStore;
  };

  return {
    getProvider() {
      return normalizeProvider(env.CHAT_ATTACHMENT_PROVIDER);
    },

    async store(input: ChatAttachmentStoreInput) {
      const provider = normalizeProvider(env.CHAT_ATTACHMENT_PROVIDER);
      const sha256 = createHash('sha256').update(input.buffer).digest('hex');
      const sizeBytes = input.buffer.length;
      const mimeType = input.mimeType?.trim() || null;
      const originalName = sanitizeFilename(input.originalName) || 'attachment';

      if (provider === 'gdrive') {
        const stored = await getObjectStore().put({
          body: input.buffer,
          contentType: mimeType,
          originalName,
          sha256,
          sizeBytes,
        });
        return {
          provider,
          providerKey: stored.key,
          sha256,
          sizeBytes,
          mimeType,
          originalName,
        };
      }

      const localDir =
        env.CHAT_ATTACHMENT_LOCAL_DIR?.trim() ||
        path.join(process.cwd(), 'tmp', 'chat');
      await fs.mkdir(localDir, { recursive: true });
      const providerKey = randomUUID();
      await fs.writeFile(path.join(localDir, providerKey), input.buffer);
      return {
        provider,
        providerKey,
        sha256,
        sizeBytes,
        mimeType,
        originalName,
      };
    },

    async open(provider, providerKey) {
      if (provider === 'gdrive') {
        return getObjectStore().get(providerKey);
      }
      const localDir =
        env.CHAT_ATTACHMENT_LOCAL_DIR?.trim() ||
        path.join(process.cwd(), 'tmp', 'chat');
      const safeKey = providerKey.replace(/[^a-zA-Z0-9_-]/g, '');
      if (!safeKey) throw new Error('invalid_provider_key');
      return { stream: createReadStream(path.join(localDir, safeKey)) };
    },
  };
}

export const defaultChatAttachmentStoragePort =
  createChatAttachmentStorageAdapter();
