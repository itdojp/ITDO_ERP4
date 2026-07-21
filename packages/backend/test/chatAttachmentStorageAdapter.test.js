import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createChatAttachmentStorageAdapter } from '../dist/adapters/storage/chatAttachmentStorageAdapter.js';

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test('local Chat attachment storage preserves providerKey and content behavior', async () => {
  const scratchRoot = resolve(process.cwd(), '../..', '.codex-local', 'tmp');
  await mkdir(scratchRoot, { recursive: true });
  const localDir = await mkdtemp(join(scratchRoot, 'erp4-chat-storage-'));
  try {
    const adapter = createChatAttachmentStorageAdapter({
      env: {
        CHAT_ATTACHMENT_PROVIDER: 'local',
        CHAT_ATTACHMENT_LOCAL_DIR: localDir,
      },
    });

    const stored = await adapter.store({
      buffer: Buffer.from('local-content'),
      originalName: 'unsafe/name?.txt',
      mimeType: 'text/plain',
    });

    assert.equal(stored.provider, 'local');
    assert.match(stored.providerKey, /^[0-9a-f-]{36}$/);
    assert.equal(stored.originalName, 'unsafe_name_.txt');
    assert.equal(
      (await readFile(join(localDir, stored.providerKey))).toString(),
      'local-content',
    );
    const opened = await adapter.open('local', stored.providerKey);
    assert.equal((await readAll(opened.stream)).toString(), 'local-content');
  } finally {
    await rm(localDir, { recursive: true, force: true });
  }
});

test('Google Drive Chat adapter maps generic object keys to legacy providerKey', async () => {
  let factoryOptions;
  let getKey;
  let putInput;
  const warnings = [];
  const objectStore = {
    put: async (input) => {
      putInput = input;
      return {
        key: 'raw-drive-file-id-placeholder',
        checksum: { sha256: input.sha256 },
        contentType: input.contentType,
        createdAt: null,
        modifiedAt: null,
        originalName: input.originalName,
        sizeBytes: input.sizeBytes,
        trashed: false,
      };
    },
    get: async (key) => {
      getKey = key;
      return { stream: Readable.from('download-content') };
    },
    stat: async () => assert.fail('not expected'),
    trash: async () => assert.fail('not expected'),
  };
  const adapter = createChatAttachmentStorageAdapter({
    env: {
      CHAT_ATTACHMENT_PROVIDER: 'gdrive',
      CHAT_ATTACHMENT_GDRIVE_FOLDER_ID: 'folder-placeholder',
      ERP4_GDRIVE_SHARED_DRIVE_ID: 'shared-placeholder',
      ERP4_GDRIVE_CLIENT_ID: 'common-client',
      ERP4_GDRIVE_CLIENT_SECRET: 'common-secret',
      ERP4_GDRIVE_REFRESH_TOKEN: 'common-refresh',
    },
    objectStoreFactory: (options) => {
      factoryOptions = options;
      return objectStore;
    },
    warn: (warning) => warnings.push(warning),
  });

  const stored = await adapter.store({
    buffer: Buffer.from('drive-content'),
    originalName: 'drive.txt',
    mimeType: 'text/plain',
  });

  assert.equal(stored.provider, 'gdrive');
  assert.equal(stored.providerKey, 'raw-drive-file-id-placeholder');
  assert.equal(factoryOptions.credentials.clientId, 'common-client');
  assert.equal(factoryOptions.sharedDriveId, 'shared-placeholder');
  assert.equal(factoryOptions.folderId, 'folder-placeholder');
  assert.equal(putInput.originalName, 'drive.txt');
  assert.equal(putInput.body.toString(), 'drive-content');
  assert.equal(warnings.length, 0);
  const opened = await adapter.open('gdrive', stored.providerKey);
  assert.equal(getKey, 'raw-drive-file-id-placeholder');
  assert.equal((await readAll(opened.stream)).toString(), 'download-content');
});

test('legacy credentials remain usable and warnings never contain values', async () => {
  const warnings = [];
  let credentials;
  const adapter = createChatAttachmentStorageAdapter({
    env: {
      CHAT_ATTACHMENT_PROVIDER: 'gdrive',
      CHAT_ATTACHMENT_GDRIVE_FOLDER_ID: 'folder-placeholder',
      CHAT_ATTACHMENT_GDRIVE_CLIENT_ID: 'sensitive-legacy-client',
      CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET: 'sensitive-legacy-secret',
      CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN: 'sensitive-legacy-refresh',
    },
    objectStoreFactory: (options) => {
      credentials = options.credentials;
      return {
        put: async (input) => ({
          key: 'file-placeholder',
          checksum: {},
          contentType: null,
          createdAt: null,
          modifiedAt: null,
          originalName: input.originalName,
          sizeBytes: input.sizeBytes,
          trashed: false,
        }),
        get: async () => ({ stream: null }),
        stat: async () => assert.fail('not expected'),
        trash: async () => assert.fail('not expected'),
      };
    },
    warn: (warning) => warnings.push(warning),
  });

  await adapter.store({ buffer: Buffer.from('x'), originalName: 'x' });

  assert.equal(credentials.clientId, 'sensitive-legacy-client');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /CHAT_ATTACHMENT_GDRIVE_CLIENT_ID/);
  assert.doesNotMatch(warnings[0], /sensitive-/);
});

test('common credentials take precedence even when all legacy aliases are present', async () => {
  let credentials;
  const warnings = [];
  const adapter = createChatAttachmentStorageAdapter({
    env: {
      CHAT_ATTACHMENT_PROVIDER: 'gdrive',
      CHAT_ATTACHMENT_GDRIVE_FOLDER_ID: 'folder-placeholder',
      ERP4_GDRIVE_CLIENT_ID: 'common-client',
      ERP4_GDRIVE_CLIENT_SECRET: 'common-secret',
      ERP4_GDRIVE_REFRESH_TOKEN: 'common-refresh',
      CHAT_ATTACHMENT_GDRIVE_CLIENT_ID: 'legacy-client',
      CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET: 'legacy-secret',
      CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN: 'legacy-refresh',
    },
    objectStoreFactory: (options) => {
      credentials = options.credentials;
      return {
        put: async (input) => ({
          key: 'file-placeholder',
          checksum: {},
          contentType: null,
          createdAt: null,
          modifiedAt: null,
          originalName: input.originalName,
          sizeBytes: input.sizeBytes,
          trashed: false,
        }),
        get: async () => ({ stream: null }),
        stat: async () => assert.fail('not expected'),
        trash: async () => assert.fail('not expected'),
      };
    },
    warn: (warning) => warnings.push(warning),
  });

  await adapter.store({ buffer: Buffer.from('x'), originalName: 'x' });

  assert.equal(credentials.clientId, 'common-client');
  assert.equal(credentials.clientSecret, 'common-secret');
  assert.equal(credentials.refreshToken, 'common-refresh');
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(warnings[0], /common-|legacy-/);
});
