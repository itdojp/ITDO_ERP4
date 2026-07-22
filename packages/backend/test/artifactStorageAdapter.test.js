import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createArtifactStorageAdapter } from '../dist/adapters/storage/artifactStorageAdapter.js';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function createArtifactDb() {
  const rows = [];
  const findByCompound = (where) => {
    const value = where.context_provider_idempotencyKey;
    if (!value) return null;
    return (
      rows.find(
        (row) =>
          row.context === value.context &&
          row.provider === value.provider &&
          row.idempotencyKey === value.idempotencyKey,
      ) ?? null
    );
  };
  return {
    rows,
    storageArtifact: {
      findUnique: async ({ where }) => findByCompound(where),
      findFirst: async ({ where }) =>
        rows.find(
          (row) =>
            row.id === where.id &&
            row.context === where.context &&
            row.status === where.status &&
            row.deletedAt === where.deletedAt,
        ) ?? null,
      create: async ({ data }) => {
        if (
          data.idempotencyKey &&
          rows.some(
            (row) =>
              row.context === data.context &&
              row.provider === data.provider &&
              row.idempotencyKey === data.idempotencyKey,
          )
        ) {
          throw Object.assign(new Error('unique constraint'), {
            code: 'P2002',
          });
        }
        const now = new Date('2026-07-22T00:00:00.000Z');
        const row = {
          providerKey: null,
          failureCode: null,
          deletedAt: null,
          updatedAt: now,
          ...data,
          createdAt: now,
        };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error('row not found');
        Object.assign(row, data, {
          updatedAt: new Date('2026-07-22T00:00:01.000Z'),
        });
        return row;
      },
      updateMany: async ({ where, data }) => {
        const row = rows.find(
          (candidate) =>
            candidate.id === where.id && candidate.status === where.status,
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  };
}

function input(body = Buffer.from('artifact-content')) {
  return {
    body,
    contentType: 'application/octet-stream',
    idempotencyKey: 'pdf:document-placeholder:revision-1',
    originalName: 'document.pdf',
    ownerId: 'owner-placeholder',
    ownerType: 'invoice',
    sha256: sha256(body),
    sizeBytes: body.length,
    storageName: 'pdf-artifact-placeholder.pdf',
  };
}

async function createScratchDir() {
  const scratchRoot = path.resolve(
    process.cwd(),
    '../..',
    '.codex-local',
    'tmp',
  );
  await mkdir(scratchRoot, { recursive: true });
  return mkdtemp(path.join(scratchRoot, 'erp4-artifact-storage-'));
}

test('local artifact lifecycle is pending then verified ready without exposing providerKey', async () => {
  const localDir = await createScratchDir();
  const db = createArtifactDb();
  try {
    const adapter = createArtifactStorageAdapter({
      context: 'pdf',
      db,
      env: {},
      folderEnvKey: 'PDF_GDRIVE_FOLDER_ID',
      localDir,
      provider: 'local',
    });
    const body = Buffer.from('artifact-content');
    const stored = await adapter.store(input(body));

    assert.equal(stored.artifactId, db.rows[0].id);
    assert.equal(stored.provider, 'local');
    assert.equal(Object.hasOwn(stored, 'providerKey'), false);
    assert.equal(db.rows[0].status, 'ready');
    assert.match(db.rows[0].providerKey, /^[0-9a-f-]{36}$/);
    const filePath = path.join(localDir, db.rows[0].providerKey);
    assert.deepEqual(await readFile(filePath), body);
    assert.equal((await lstat(filePath)).mode & 0o777, 0o600);

    const opened = await adapter.open(stored.artifactId);
    assert.equal(opened.artifact.artifactId, stored.artifactId);
    assert.equal(Object.hasOwn(opened.artifact, 'providerKey'), false);
    assert.deepEqual(await readAll(opened.stream), body);
  } finally {
    await rm(localDir, { recursive: true, force: true });
  }
});

test('local reader rejects a different context and corrupted content', async () => {
  const localDir = await createScratchDir();
  const db = createArtifactDb();
  try {
    const pdf = createArtifactStorageAdapter({
      context: 'pdf',
      db,
      env: {},
      folderEnvKey: 'PDF_GDRIVE_FOLDER_ID',
      localDir,
      provider: 'local',
    });
    const report = createArtifactStorageAdapter({
      context: 'report',
      db,
      env: {},
      folderEnvKey: 'REPORT_GDRIVE_FOLDER_ID',
      localDir,
      provider: 'local',
    });
    const stored = await pdf.store(input());

    await assert.rejects(() => report.open(stored.artifactId), {
      message: 'artifact_not_found',
    });
    await writeFile(
      path.join(localDir, db.rows[0].providerKey),
      Buffer.from('corrupt-content'),
    );
    await assert.rejects(() => pdf.open(stored.artifactId), {
      message: 'artifact_local_verification_failed',
    });
  } finally {
    await rm(localDir, { recursive: true, force: true });
  }
});

test('local write removes a partial destination after a source stream failure', async () => {
  const localDir = await createScratchDir();
  const db = createArtifactDb();
  try {
    const adapter = createArtifactStorageAdapter({
      context: 'report',
      db,
      env: {},
      folderEnvKey: 'REPORT_GDRIVE_FOLDER_ID',
      localDir,
      provider: 'local',
    });
    const body = Buffer.from('complete-content');
    await assert.rejects(
      () =>
        adapter.store({
          ...input(body),
          body: () =>
            Readable.from(
              (async function* () {
                yield Buffer.from('partial');
                throw new Error('sensitive source failure');
              })(),
            ),
        }),
      { message: 'artifact_local_io_failed' },
    );
    assert.equal(db.rows[0].status, 'failed');
    await assert.rejects(lstat(path.join(localDir, db.rows[0].id)), {
      code: 'ENOENT',
    });
  } finally {
    await rm(localDir, { recursive: true, force: true });
  }
});

test('local storage rejects a group-readable directory', async () => {
  const localDir = await createScratchDir();
  const db = createArtifactDb();
  try {
    await chmod(localDir, 0o750);
    const adapter = createArtifactStorageAdapter({
      context: 'pdf',
      db,
      env: {},
      folderEnvKey: 'PDF_GDRIVE_FOLDER_ID',
      localDir,
      provider: 'local',
    });
    await assert.rejects(() => adapter.store(input()), {
      message: 'artifact_local_directory_unsafe',
    });
    assert.equal(db.rows[0].status, 'failed');
    assert.equal(db.rows[0].failureCode, 'artifact_local_directory_unsafe');
  } finally {
    await chmod(localDir, 0o700);
    await rm(localDir, { recursive: true, force: true });
  }
});

test('Google Drive artifact uses only common credentials and verifies stat before download', async () => {
  const db = createArtifactDb();
  let factoryOptions;
  let putInput;
  const calls = [];
  const body = Buffer.from('drive-artifact');
  const objectStore = {
    put: async (value) => {
      calls.push('put');
      putInput = value;
      return {
        key: 'drive-file-placeholder',
        checksum: { sha256: value.sha256 },
        contentType: value.contentType,
        createdAt: null,
        modifiedAt: null,
        originalName: value.originalName,
        sizeBytes: value.sizeBytes,
        trashed: false,
      };
    },
    stat: async (key) => {
      calls.push(`stat:${key}`);
      return {
        key,
        checksum: { sha256: sha256(body) },
        contentType: 'application/octet-stream',
        createdAt: null,
        modifiedAt: null,
        originalName: 'pdf-artifact-placeholder.pdf',
        sizeBytes: body.length,
        trashed: false,
      };
    },
    get: async (key) => {
      calls.push(`get:${key}`);
      return { stream: Readable.from(body) };
    },
    trash: async () => assert.fail('trash must not be called'),
  };
  const adapter = createArtifactStorageAdapter({
    context: 'pdf',
    db,
    env: {
      PDF_GDRIVE_FOLDER_ID: 'folder-placeholder',
      ERP4_GDRIVE_CLIENT_ID: 'common-client',
      ERP4_GDRIVE_CLIENT_SECRET: 'common-secret',
      ERP4_GDRIVE_REFRESH_TOKEN: 'common-refresh',
      CHAT_ATTACHMENT_GDRIVE_CLIENT_ID: 'legacy-client',
      CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET: 'legacy-secret',
      CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN: 'legacy-refresh',
    },
    folderEnvKey: 'PDF_GDRIVE_FOLDER_ID',
    localDir: 'unused-local-directory',
    objectStoreFactory: (options) => {
      factoryOptions = options;
      return objectStore;
    },
    provider: 'gdrive',
  });

  const stored = await adapter.store(input(body));
  assert.equal(stored.provider, 'gdrive');
  assert.equal(Object.hasOwn(stored, 'providerKey'), false);
  assert.equal(db.rows[0].providerKey, 'drive-file-placeholder');
  assert.equal(factoryOptions.credentials.clientId, 'common-client');
  assert.equal(factoryOptions.credentials.clientSecret, 'common-secret');
  assert.equal(factoryOptions.credentials.refreshToken, 'common-refresh');
  assert.equal(putInput.idempotencyKey, input(body).idempotencyKey);
  assert.equal(putInput.originalName, 'pdf-artifact-placeholder.pdf');

  const opened = await adapter.open(stored.artifactId);
  assert.deepEqual(await readAll(opened.stream), body);
  assert.deepEqual(calls, [
    'put',
    'get:drive-file-placeholder',
    'stat:drive-file-placeholder',
    'get:drive-file-placeholder',
  ]);
});

test('legacy-only Google credentials fail closed and record a sanitized failure code', async () => {
  const db = createArtifactDb();
  const adapter = createArtifactStorageAdapter({
    context: 'pdf',
    db,
    env: {
      PDF_GDRIVE_FOLDER_ID: 'folder-placeholder',
      CHAT_ATTACHMENT_GDRIVE_CLIENT_ID: 'sensitive-legacy-client',
      CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET: 'sensitive-legacy-secret',
      CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN: 'sensitive-legacy-refresh',
    },
    folderEnvKey: 'PDF_GDRIVE_FOLDER_ID',
    localDir: 'unused-local-directory',
    objectStoreFactory: () => assert.fail('factory must not be called'),
    provider: 'gdrive',
  });

  await assert.rejects(
    () => adapter.store(input()),
    (error) => {
      assert.equal(error.message, 'google_drive_configuration_invalid');
      assert.deepEqual(error.keys, [
        'ERP4_GDRIVE_CLIENT_ID',
        'ERP4_GDRIVE_CLIENT_SECRET',
        'ERP4_GDRIVE_REFRESH_TOKEN',
      ]);
      assert.doesNotMatch(error.message, /sensitive-/);
      return true;
    },
  );
  assert.equal(db.rows[0].status, 'failed');
  assert.equal(db.rows[0].failureCode, 'gdrive_configuration_invalid');
});

test('idempotent ready rows are reused and conflicting metadata fails closed', async () => {
  const localDir = await createScratchDir();
  const db = createArtifactDb();
  try {
    const adapter = createArtifactStorageAdapter({
      context: 'report',
      db,
      env: {},
      folderEnvKey: 'REPORT_GDRIVE_FOLDER_ID',
      localDir,
      provider: 'local',
    });
    const stored = await adapter.store(input());
    const reused = await adapter.store(input());
    assert.equal(reused.artifactId, stored.artifactId);
    assert.equal(db.rows.length, 1);

    await assert.rejects(
      () =>
        adapter.store({
          ...input(Buffer.from('different')),
          idempotencyKey: input().idempotencyKey,
        }),
      { message: 'artifact_idempotency_conflict' },
    );
  } finally {
    await rm(localDir, { recursive: true, force: true });
  }
});

test('pending idempotent rows prevent a concurrent duplicate upload', async () => {
  const db = createArtifactDb();
  const value = input();
  db.rows.push({
    id: randomUUID(),
    context: 'pdf',
    provider: 'gdrive',
    providerKey: null,
    status: 'pending',
    idempotencyKey: value.idempotencyKey,
    originalName: value.originalName,
    contentType: value.contentType,
    sizeBytes: BigInt(value.sizeBytes),
    sha256: value.sha256,
    ownerType: null,
    ownerId: null,
    failureCode: null,
    createdAt: new Date(),
    createdBy: null,
    updatedAt: new Date(),
    deletedAt: null,
  });
  const adapter = createArtifactStorageAdapter({
    context: 'pdf',
    db,
    env: {},
    folderEnvKey: 'PDF_GDRIVE_FOLDER_ID',
    localDir: 'unused-local-directory',
    objectStoreFactory: () => assert.fail('factory must not be called'),
    provider: 'gdrive',
  });

  await assert.rejects(() => adapter.store(value), {
    message: 'artifact_store_in_progress',
  });
});

test('failed rows can be claimed for an idempotent retry', async () => {
  const db = createArtifactDb();
  let attempts = 0;
  const value = input(Buffer.from('retry-content'));
  const objectStore = {
    put: async (putInput) => {
      attempts += 1;
      if (attempts === 1) throw new Error('synthetic provider failure');
      return {
        key: 'drive-file-placeholder',
        checksum: { sha256: putInput.sha256 },
        contentType: putInput.contentType,
        createdAt: null,
        modifiedAt: null,
        originalName: putInput.originalName,
        sizeBytes: putInput.sizeBytes,
        trashed: false,
      };
    },
    get: async () => ({ stream: Readable.from(value.body) }),
    stat: async () => assert.fail('stat must not be called'),
    trash: async () => assert.fail('trash must not be called'),
  };
  const adapter = createArtifactStorageAdapter({
    context: 'pdf',
    db,
    env: {
      PDF_GDRIVE_FOLDER_ID: 'folder-placeholder',
      ERP4_GDRIVE_CLIENT_ID: 'common-client',
      ERP4_GDRIVE_CLIENT_SECRET: 'common-secret',
      ERP4_GDRIVE_REFRESH_TOKEN: 'common-refresh',
    },
    folderEnvKey: 'PDF_GDRIVE_FOLDER_ID',
    localDir: 'unused-local-directory',
    objectStoreFactory: () => objectStore,
    provider: 'gdrive',
  });

  await assert.rejects(() => adapter.store(value), {
    message: 'synthetic provider failure',
  });
  assert.equal(db.rows[0].status, 'failed');
  assert.equal(db.rows[0].failureCode, 'artifact_store_failed');
  const stored = await adapter.store(value);
  assert.equal(stored.artifactId, db.rows[0].id);
  assert.equal(db.rows[0].status, 'ready');
  assert.equal(attempts, 2);
});

test('remote metadata mismatch never marks an artifact ready', async () => {
  const db = createArtifactDb();
  const adapter = createArtifactStorageAdapter({
    context: 'evidence',
    db,
    env: {
      EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID: 'folder-placeholder',
      ERP4_GDRIVE_CLIENT_ID: 'common-client',
      ERP4_GDRIVE_CLIENT_SECRET: 'common-secret',
      ERP4_GDRIVE_REFRESH_TOKEN: 'common-refresh',
    },
    folderEnvKey: 'EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID',
    localDir: 'unused-local-directory',
    objectStoreFactory: () => ({
      put: async (value) => ({
        key: 'drive-file-placeholder',
        checksum: { sha256: value.sha256 },
        contentType: value.contentType,
        createdAt: null,
        modifiedAt: null,
        originalName: value.originalName,
        sizeBytes: value.sizeBytes + 1,
        trashed: false,
      }),
      get: async () => assert.fail('get must not be called'),
      stat: async () => assert.fail('stat must not be called'),
      trash: async () => assert.fail('trash must not be called'),
    }),
    provider: 'gdrive',
  });

  await assert.rejects(() => adapter.store(input()), {
    message: 'artifact_remote_verification_failed',
  });
  assert.equal(db.rows[0].status, 'failed');
  assert.equal(db.rows[0].providerKey, null);
  assert.equal(db.rows[0].failureCode, 'artifact_remote_verification_failed');
});

test('downloaded content mismatch never marks an artifact ready', async () => {
  const db = createArtifactDb();
  const adapter = createArtifactStorageAdapter({
    context: 'report',
    db,
    env: {
      REPORT_GDRIVE_FOLDER_ID: 'folder-placeholder',
      ERP4_GDRIVE_CLIENT_ID: 'common-client',
      ERP4_GDRIVE_CLIENT_SECRET: 'common-secret',
      ERP4_GDRIVE_REFRESH_TOKEN: 'common-refresh',
    },
    folderEnvKey: 'REPORT_GDRIVE_FOLDER_ID',
    localDir: 'unused-local-directory',
    objectStoreFactory: () => ({
      put: async (value) => ({
        key: 'drive-file-placeholder',
        checksum: { sha256: value.sha256 },
        contentType: value.contentType,
        createdAt: null,
        modifiedAt: null,
        originalName: value.originalName,
        sizeBytes: value.sizeBytes,
        trashed: false,
      }),
      get: async () => ({ stream: Readable.from('corrupt-content') }),
      stat: async () => assert.fail('stat must not be called'),
      trash: async () => assert.fail('trash must not be called'),
    }),
    provider: 'gdrive',
  });

  await assert.rejects(() => adapter.store(input()), {
    message: 'artifact_remote_verification_failed',
  });
  assert.equal(db.rows[0].status, 'failed');
  assert.equal(db.rows[0].providerKey, null);
});

test('invalid metadata is rejected before creating a pending row', async () => {
  const db = createArtifactDb();
  const adapter = createArtifactStorageAdapter({
    context: 'report',
    db,
    env: {},
    folderEnvKey: 'REPORT_GDRIVE_FOLDER_ID',
    localDir: 'unused-local-directory',
    provider: 'local',
  });

  await assert.rejects(
    () => adapter.store({ ...input(), idempotencyKey: ' ' }),
    { message: 'artifact_idempotency_key_invalid' },
  );
  await assert.rejects(
    () => adapter.store({ ...input(), storageName: '../unsafe.pdf' }),
    { message: 'artifact_storage_name_invalid' },
  );
  assert.equal(db.rows.length, 0);
});
