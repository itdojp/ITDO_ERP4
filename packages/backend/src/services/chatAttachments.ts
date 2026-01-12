import { createReadStream, promises as fs } from 'fs';
import { createHash, randomUUID } from 'crypto';
import path from 'path';
import { Readable } from 'stream';
import type { drive_v3 } from 'googleapis';
import googleapis from 'googleapis';

type AttachmentProvider = 'local' | 'gdrive';

type AttachmentStoreInput = {
  buffer: Buffer;
  originalName: string;
  mimeType?: string | null;
};

type AttachmentStoreResult = {
  provider: AttachmentProvider;
  providerKey: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string | null;
  originalName: string;
};

type AttachmentDownloadResult = {
  stream: Readable;
};

const { google } = googleapis as unknown as {
  google: typeof import('googleapis').google;
};

function normalizeProvider(raw?: string): AttachmentProvider {
  const value = (raw || '').trim().toLowerCase();
  if (value === 'gdrive') return 'gdrive';
  return 'local';
}

function resolveLocalDir() {
  const raw = process.env.CHAT_ATTACHMENT_LOCAL_DIR?.trim();
  return raw && raw.length > 0 ? raw : path.join(process.cwd(), 'tmp', 'chat');
}

function sanitizeFilename(value: string) {
  return value
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

let cachedDrive: drive_v3.Drive | null = null;

function getDriveClient(): drive_v3.Drive {
  if (cachedDrive) return cachedDrive;
  const clientId = process.env.CHAT_ATTACHMENT_GDRIVE_CLIENT_ID?.trim();
  const clientSecret = process.env.CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('gdrive_credentials_missing');
  }
  const oauth2Client = new google.auth.OAuth2({
    clientId,
    clientSecret,
  });
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  cachedDrive = google.drive({ version: 'v3', auth: oauth2Client });
  return cachedDrive;
}

export function getAttachmentProvider() {
  return normalizeProvider(process.env.CHAT_ATTACHMENT_PROVIDER);
}

export async function storeAttachment(
  input: AttachmentStoreInput,
): Promise<AttachmentStoreResult> {
  const provider = getAttachmentProvider();
  const sha256 = createHash('sha256').update(input.buffer).digest('hex');
  const sizeBytes = input.buffer.length;
  const mimeType = input.mimeType?.trim() || null;
  const originalName = sanitizeFilename(input.originalName) || 'attachment';

  if (provider === 'gdrive') {
    const folderId = process.env.CHAT_ATTACHMENT_GDRIVE_FOLDER_ID?.trim();
    if (!folderId) {
      throw new Error('gdrive_folder_missing');
    }
    const drive = getDriveClient();
    const uploaded = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: originalName,
        parents: [folderId],
      },
      media: {
        mimeType: mimeType || undefined,
        body: Readable.from(input.buffer),
      },
      fields: 'id',
    });
    const fileId = uploaded.data.id;
    if (!fileId) {
      throw new Error('gdrive_upload_failed');
    }
    return {
      provider,
      providerKey: fileId,
      sha256,
      sizeBytes,
      mimeType,
      originalName,
    };
  }

  const localDir = resolveLocalDir();
  await fs.mkdir(localDir, { recursive: true });
  const providerKey = randomUUID();
  const filePath = path.join(localDir, providerKey);
  await fs.writeFile(filePath, input.buffer);
  return {
    provider,
    providerKey,
    sha256,
    sizeBytes,
    mimeType,
    originalName,
  };
}

export async function openAttachment(
  provider: AttachmentProvider,
  providerKey: string,
): Promise<AttachmentDownloadResult> {
  if (provider === 'gdrive') {
    const drive = getDriveClient();
    const downloaded = await drive.files.get(
      { fileId: providerKey, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' },
    );
    return { stream: downloaded.data as unknown as Readable };
  }
  const localDir = resolveLocalDir();
  const safeKey = providerKey.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeKey) {
    throw new Error('invalid_provider_key');
  }
  const filePath = path.join(localDir, safeKey);
  return { stream: createReadStream(filePath) };
}
