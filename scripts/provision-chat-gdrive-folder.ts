import googleapis from 'googleapis';

const { google } = googleapis as unknown as {
  google: typeof import('googleapis').google;
};

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`missing_env:${name}`);
  }
  return value.trim();
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
  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function main() {
  const drive = await buildDrive();
  const folderName =
    process.env.CHAT_ATTACHMENT_GDRIVE_FOLDER_NAME?.trim() ||
    'ERP4 Chat Attachments';

  const created = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id,name,webViewLink',
  });

  if (!created.data.id) {
    throw new Error('gdrive_folder_create_failed');
  }

  console.log('[gdrive] created folder:', {
    id: created.data.id,
    name: created.data.name,
    webViewLink: created.data.webViewLink || null,
  });
  console.log('[gdrive] set env:', {
    CHAT_ATTACHMENT_GDRIVE_FOLDER_ID: created.data.id,
  });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[gdrive] provision failed:', message);
  process.exitCode = 1;
});

