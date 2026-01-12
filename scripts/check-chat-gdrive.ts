import googleapis from 'googleapis';

const { google } = googleapis as unknown as {
  google: typeof import('googleapis').google;
};

type CheckMode = 'read' | 'write';

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`missing_env:${name}`);
  }
  return value.trim();
}

function resolveMode(): CheckMode {
  const raw = (process.env.GDRIVE_CHECK_MODE || 'read').trim().toLowerCase();
  return raw === 'write' ? 'write' : 'read';
}

async function buildDrive() {
  const clientId = requireEnv('CHAT_ATTACHMENT_GDRIVE_CLIENT_ID');
  const clientSecret = requireEnv('CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET');
  const refreshToken = requireEnv('CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN');

  const oauth2Client = new google.auth.OAuth2({
    clientId,
    clientSecret,
  });
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  return drive;
}

async function main() {
  const mode = resolveMode();
  const folderId = requireEnv('CHAT_ATTACHMENT_GDRIVE_FOLDER_ID');
  const drive = await buildDrive();

  console.log('[gdrive] mode:', mode);
  console.log('[gdrive] folderId:', folderId);

  const folder = await drive.files.get({
    fileId: folderId,
    supportsAllDrives: true,
    fields: 'id,name,mimeType,driveId,owners(emailAddress),capabilities',
  });
  console.log('[gdrive] folder:', {
    id: folder.data.id,
    name: folder.data.name,
    mimeType: folder.data.mimeType,
    driveId: folder.data.driveId || null,
    owners: folder.data.owners?.map((owner) => owner.emailAddress) || [],
  });

  const listParams: Record<string, unknown> = {
    q: `'${folderId}' in parents and trashed=false`,
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    fields: 'files(id,name,mimeType,size,createdTime),nextPageToken',
  };
  if (folder.data.driveId) {
    listParams.driveId = folder.data.driveId;
    listParams.corpora = 'drive';
  }
  const list = await drive.files.list(listParams as any);
  console.log(
    '[gdrive] list:',
    (list.data.files || []).map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      createdTime: file.createdTime,
    })),
  );

  if (mode !== 'write') return;

  const testName = `erp4-chat-attachment-check-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}.txt`;
  const created = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: testName,
      parents: [folderId],
    },
    media: {
      mimeType: 'text/plain',
      body: Buffer.from('erp4 gdrive check'),
    },
    fields: 'id',
  });
  const createdId = created.data.id;
  if (!createdId) {
    throw new Error('gdrive_create_failed');
  }
  console.log('[gdrive] created test file:', createdId, testName);

  try {
    await drive.files.delete({ fileId: createdId, supportsAllDrives: true });
    console.log('[gdrive] deleted test file:', createdId);
  } catch (err) {
    console.warn('[gdrive] delete failed, trying to trash instead:', err);
    await drive.files.update({
      fileId: createdId,
      supportsAllDrives: true,
      requestBody: { trashed: true },
      fields: 'id,trashed',
    });
    console.log('[gdrive] trashed test file:', createdId);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[gdrive] check failed:', message);
  process.exitCode = 1;
});

