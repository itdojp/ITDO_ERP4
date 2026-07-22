import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createArtifactStorageAdapter } from '../dist/adapters/storage/artifactStorageAdapter.js';
import {
  assertSafeLocalFileHandle,
  openLocalArtifactDirectory,
} from '../dist/infrastructure/storage/localArtifactDirectory.js';

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
            row.deletedAt === where.deletedAt &&
            (where.ownerType === undefined ||
              row.ownerType === where.ownerType) &&
            (where.ownerId === undefined || row.ownerId === where.ownerId),
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

function addPendingRow(db, value, provider = 'gdrive') {
  const row = {
    id: randomUUID(),
    context: 'pdf',
    provider,
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
  };
  db.rows.push(row);
  return row;
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

test('local directory capability stays anchored and detects path replacement', async () => {
  const scratchDir = await createScratchDir();
  const localDir = path.join(scratchDir, 'storage');
  const movedDir = path.join(scratchDir, 'storage-moved');
  const providerKey = randomUUID();
  const trusted = Buffer.from('trusted-artifact');
  const replacement = Buffer.from('replacement-data');
  await mkdir(localDir, { mode: 0o700 });
  await writeFile(path.join(localDir, providerKey), trusted, { mode: 0o600 });
  const directory = await openLocalArtifactDirectory(localDir, {
    create: false,
  });
  assert.ok(directory);
  try {
    await rename(localDir, movedDir);
    await mkdir(localDir, { mode: 0o700 });
    await writeFile(path.join(localDir, providerKey), replacement, {
      mode: 0o600,
    });

    await assert.rejects(() => directory.openRead('..'), {
      message: 'artifact_provider_key_invalid',
    });
    const handle = await directory.openRead(providerKey);
    try {
      assert.deepEqual(await handle.readFile(), trusted);
    } finally {
      await handle.close();
    }
    await assert.rejects(() => directory.assertBound(), {
      message: 'artifact_local_directory_unsafe',
    });
  } finally {
    await directory.close();
    await rm(scratchDir, { recursive: true, force: true });
  }
});

test('local file ownership mismatch fails closed before content verification', async () => {
  const uid = process.getuid?.();
  assert.notEqual(uid, undefined);
  await assert.rejects(
    () =>
      assertSafeLocalFileHandle({
        stat: async () => ({
          isFile: () => true,
          mode: 0o100600,
          uid: uid + 1,
        }),
      }),
    { message: 'artifact_local_file_unsafe' },
  );
});

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

    const opened = await adapter.open(stored.artifactId, {
      ownerType: 'invoice',
      ownerId: 'owner-placeholder',
    });
    assert.equal(opened.artifact.artifactId, stored.artifactId);
    assert.equal(Object.hasOwn(opened.artifact, 'providerKey'), false);
    assert.deepEqual(await readAll(opened.stream), body);
    await assert.rejects(
      () =>
        adapter.open(stored.artifactId, {
          ownerType: 'invoice',
          ownerId: 'different-owner',
        }),
      { message: 'artifact_not_found' },
    );
    await assert.rejects(
      () =>
        adapter.open(stored.artifactId, {
          ownerType: 'invoice',
          ownerId: '',
        }),
      { message: 'artifact_owner_scope_invalid' },
    );
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

test('local reader does not create a missing storage directory', async () => {
  const scratchDir = await createScratchDir();
  const localDir = path.join(scratchDir, 'missing-storage');
  const db = createArtifactDb();
  const ready = addPendingRow(db, input(), 'local');
  ready.providerKey = ready.id;
  ready.status = 'ready';
  try {
    const adapter = createArtifactStorageAdapter({
      context: 'pdf',
      db,
      env: {},
      folderEnvKey: 'PDF_GDRIVE_FOLDER_ID',
      localDir,
      provider: 'local',
    });

    await assert.rejects(() => adapter.open(ready.id), {
      message: 'artifact_local_directory_unsafe',
    });
    await assert.rejects(() => lstat(localDir), { code: 'ENOENT' });
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
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
  const downloadTempRoot = await createScratchDir();
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
    downloadTempRoot,
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

  try {
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
    assert.deepEqual(await readdir(downloadTempRoot), []);
    assert.deepEqual(await readAll(opened.stream), body);
    assert.deepEqual(calls, [
      'put',
      'get:drive-file-placeholder',
      'stat:drive-file-placeholder',
      'get:drive-file-placeholder',
    ]);
  } finally {
    await rm(downloadTempRoot, { recursive: true, force: true });
  }
});

test('Google Drive open rejects checksum-mismatched or oversized downloaded bytes', async () => {
  const expected = Buffer.from('expected-content');
  const corrupted = Buffer.from('corrupt-content!');
  assert.equal(corrupted.length, expected.length);
  for (const downloaded of [
    corrupted,
    Buffer.concat([expected, Buffer.from('unexpected-extra-bytes')]),
  ]) {
    const downloadTempRoot = await createScratchDir();
    const value = input(expected);
    const db = createArtifactDb();
    const ready = addPendingRow(db, value);
    ready.providerKey = 'drive-file-placeholder';
    ready.status = 'ready';
    const adapter = createArtifactStorageAdapter({
      context: 'pdf',
      db,
      downloadTempRoot,
      env: {
        PDF_GDRIVE_FOLDER_ID: 'folder-placeholder',
        ERP4_GDRIVE_CLIENT_ID: 'common-client',
        ERP4_GDRIVE_CLIENT_SECRET: 'common-secret',
        ERP4_GDRIVE_REFRESH_TOKEN: 'common-refresh',
      },
      folderEnvKey: 'PDF_GDRIVE_FOLDER_ID',
      localDir: 'unused-local-directory',
      objectStoreFactory: () => ({
        get: async () => ({ stream: Readable.from(downloaded) }),
        put: async () => assert.fail('put must not be called'),
        stat: async () => ({
          key: ready.providerKey,
          checksum: { sha256: value.sha256 },
          contentType: value.contentType,
          createdAt: null,
          modifiedAt: null,
          originalName: value.originalName,
          sizeBytes: value.sizeBytes,
          trashed: false,
        }),
        trash: async () => assert.fail('trash must not be called'),
      }),
      provider: 'gdrive',
    });

    try {
      await assert.rejects(() => adapter.open(ready.id), {
        message: 'artifact_remote_verification_failed',
      });
      assert.deepEqual(await readdir(downloadTempRoot), []);
    } finally {
      await rm(downloadTempRoot, { recursive: true, force: true });
    }
  }
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

test('local writes without an idempotency key remain independent', async () => {
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
    const value = { ...input(), idempotencyKey: undefined };

    const first = await adapter.store(value);
    const second = await adapter.store(value);
    assert.notEqual(first.artifactId, second.artifactId);
    assert.equal(db.rows.length, 2);
    assert.equal(
      db.rows.every((row) => row.status === 'ready'),
      true,
    );
  } finally {
    await rm(localDir, { recursive: true, force: true });
  }
});

test('pending idempotent rows without a completed object prevent a duplicate upload', async () => {
  const db = createArtifactDb();
  const value = input();
  addPendingRow(db, value);
  let lookups = 0;
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
    objectStoreFactory: () => ({
      findByIdempotencyKey: async (lookup) => {
        lookups += 1;
        assert.equal(lookup.idempotencyKey, value.idempotencyKey);
        return null;
      },
      put: async () => assert.fail('put must not be called'),
      get: async () => assert.fail('get must not be called'),
      stat: async () => assert.fail('stat must not be called'),
      trash: async () => assert.fail('trash must not be called'),
    }),
    provider: 'gdrive',
  });

  await assert.rejects(() => adapter.store(value), {
    message: 'artifact_store_in_progress',
  });
  assert.equal(lookups, 1);
  assert.equal(db.rows[0].status, 'pending');
});

test('pending Drive row recovers a verified idempotent object without reupload', async () => {
  const db = createArtifactDb();
  const value = input(Buffer.from('interrupted-drive-upload'));
  const pending = addPendingRow(db, value);
  const calls = [];
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
    objectStoreFactory: () => ({
      findByIdempotencyKey: async (lookup) => {
        calls.push('lookup');
        assert.deepEqual(lookup, {
          idempotencyKey: value.idempotencyKey,
          sha256: value.sha256,
          sizeBytes: value.sizeBytes,
        });
        return {
          key: 'drive-file-placeholder',
          checksum: { sha256: value.sha256 },
          contentType: value.contentType,
          createdAt: null,
          modifiedAt: null,
          originalName: value.storageName,
          sizeBytes: value.sizeBytes,
          trashed: false,
        };
      },
      put: async () => assert.fail('put must not be called'),
      get: async (key) => {
        calls.push(`get:${key}`);
        return { stream: Readable.from(value.body) };
      },
      stat: async () => assert.fail('stat must not be called'),
      trash: async () => assert.fail('trash must not be called'),
    }),
    provider: 'gdrive',
  });

  const stored = await adapter.store(value);
  assert.equal(stored.artifactId, pending.id);
  assert.equal(stored.provider, 'gdrive');
  assert.equal(Object.hasOwn(stored, 'providerKey'), false);
  assert.equal(pending.status, 'ready');
  assert.equal(pending.providerKey, 'drive-file-placeholder');
  assert.deepEqual(calls, ['lookup', 'get:drive-file-placeholder']);
});

test('pending Drive row rejects mismatched recovery metadata without reupload', async () => {
  const db = createArtifactDb();
  const value = input(Buffer.from('mismatched-drive-upload'));
  const pending = addPendingRow(db, value);
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
    objectStoreFactory: () => ({
      findByIdempotencyKey: async () => ({
        key: 'drive-file-placeholder',
        checksum: { sha256: value.sha256 },
        contentType: value.contentType,
        createdAt: null,
        modifiedAt: null,
        originalName: value.storageName,
        sizeBytes: value.sizeBytes,
        trashed: true,
      }),
      put: async () => assert.fail('put must not be called'),
      get: async () => assert.fail('get must not be called'),
      stat: async () => assert.fail('stat must not be called'),
      trash: async () => assert.fail('trash must not be called'),
    }),
    provider: 'gdrive',
  });

  await assert.rejects(() => adapter.store(value), {
    message: 'artifact_remote_verification_failed',
  });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.providerKey, null);
});

test('unique-create race recovers the completed Drive object without reupload', async () => {
  const db = createArtifactDb();
  const value = input(Buffer.from('raced-drive-upload'));
  addPendingRow(db, value);
  const findUnique = db.storageArtifact.findUnique;
  let findCount = 0;
  db.storageArtifact.findUnique = async (args) => {
    findCount += 1;
    if (findCount === 1) return null;
    return findUnique(args);
  };
  db.storageArtifact.create = async () => {
    throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
  };
  let putCalled = false;
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
    objectStoreFactory: () => ({
      findByIdempotencyKey: async () => ({
        key: 'drive-file-placeholder',
        checksum: { sha256: value.sha256 },
        contentType: value.contentType,
        createdAt: null,
        modifiedAt: null,
        originalName: value.storageName,
        sizeBytes: value.sizeBytes,
        trashed: false,
      }),
      put: async () => {
        putCalled = true;
        assert.fail('put must not be called');
      },
      get: async () => ({ stream: Readable.from(value.body) }),
      stat: async () => assert.fail('stat must not be called'),
      trash: async () => assert.fail('trash must not be called'),
    }),
    provider: 'gdrive',
  });

  const stored = await adapter.store(value);
  assert.equal(stored.artifactId, db.rows[0].id);
  assert.equal(db.rows[0].status, 'ready');
  assert.equal(putCalled, false);
  assert.equal(findCount, 2);
});

test('pending local row recovers a completed UUID file without rewriting it', async () => {
  const localDir = await createScratchDir();
  const db = createArtifactDb();
  const value = input(Buffer.from('interrupted-local-write'));
  const pending = addPendingRow(db, value, 'local');
  try {
    await writeFile(path.join(localDir, pending.id), value.body, {
      mode: 0o600,
    });
    const adapter = createArtifactStorageAdapter({
      context: 'pdf',
      db,
      env: {},
      folderEnvKey: 'PDF_GDRIVE_FOLDER_ID',
      localDir,
      provider: 'local',
    });

    const stored = await adapter.store(value);
    assert.equal(stored.artifactId, pending.id);
    assert.equal(stored.provider, 'local');
    assert.equal(pending.status, 'ready');
    assert.equal(pending.providerKey, pending.id);
    assert.deepEqual(
      await readFile(path.join(localDir, pending.id)),
      value.body,
    );
  } finally {
    await rm(localDir, { recursive: true, force: true });
  }
});

test('pending local row without a completed file remains in progress', async () => {
  const localDir = await createScratchDir();
  const db = createArtifactDb();
  const value = input(Buffer.from('unfinished-local-write'));
  const pending = addPendingRow(db, value, 'local');
  try {
    const adapter = createArtifactStorageAdapter({
      context: 'pdf',
      db,
      env: {},
      folderEnvKey: 'PDF_GDRIVE_FOLDER_ID',
      localDir,
      provider: 'local',
    });

    await assert.rejects(() => adapter.store(value), {
      message: 'artifact_store_in_progress',
    });
    assert.equal(pending.status, 'pending');
    assert.equal(pending.providerKey, null);
  } finally {
    await rm(localDir, { recursive: true, force: true });
  }
});

test('pending local recovery does not create a missing storage directory', async () => {
  const scratchDir = await createScratchDir();
  const localDir = path.join(scratchDir, 'missing-storage');
  const db = createArtifactDb();
  const value = input(Buffer.from('missing-local-storage'));
  const pending = addPendingRow(db, value, 'local');
  try {
    const adapter = createArtifactStorageAdapter({
      context: 'pdf',
      db,
      env: {},
      folderEnvKey: 'PDF_GDRIVE_FOLDER_ID',
      localDir,
      provider: 'local',
    });

    await assert.rejects(() => adapter.store(value), {
      message: 'artifact_store_in_progress',
    });
    await assert.rejects(() => lstat(localDir), { code: 'ENOENT' });
    assert.equal(pending.status, 'pending');
    assert.equal(pending.providerKey, null);
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
});

test('pending local row with partial content is not finalized or rewritten', async () => {
  const localDir = await createScratchDir();
  const db = createArtifactDb();
  const value = input(Buffer.from('expected-complete-local-write'));
  const pending = addPendingRow(db, value, 'local');
  const partial = Buffer.from('partial');
  try {
    await writeFile(path.join(localDir, pending.id), partial, { mode: 0o600 });
    const adapter = createArtifactStorageAdapter({
      context: 'pdf',
      db,
      env: {},
      folderEnvKey: 'PDF_GDRIVE_FOLDER_ID',
      localDir,
      provider: 'local',
    });

    await assert.rejects(() => adapter.store(value), {
      message: 'artifact_store_in_progress',
    });
    assert.equal(pending.status, 'pending');
    assert.equal(pending.providerKey, null);
    assert.deepEqual(await readFile(path.join(localDir, pending.id)), partial);
  } finally {
    await rm(localDir, { recursive: true, force: true });
  }
});

test('ready compare-and-swap race reuses the concurrently completed row', async () => {
  const localDir = await createScratchDir();
  const db = createArtifactDb();
  const updateMany = db.storageArtifact.updateMany;
  db.storageArtifact.updateMany = async (args) => {
    if (args.where.status === 'pending' && args.data.status === 'ready') {
      const row = db.rows.find((candidate) => candidate.id === args.where.id);
      Object.assign(row, args.data);
      return { count: 0 };
    }
    return updateMany(args);
  };
  try {
    const adapter = createArtifactStorageAdapter({
      context: 'pdf',
      db,
      env: {},
      folderEnvKey: 'PDF_GDRIVE_FOLDER_ID',
      localDir,
      provider: 'local',
    });

    const stored = await adapter.store(input());
    assert.equal(stored.artifactId, db.rows[0].id);
    assert.equal(db.rows[0].status, 'ready');
    assert.equal(db.rows[0].providerKey, db.rows[0].id);
  } finally {
    await rm(localDir, { recursive: true, force: true });
  }
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
