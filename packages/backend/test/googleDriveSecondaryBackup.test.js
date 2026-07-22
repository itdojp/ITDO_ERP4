import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  downloadBackupGeneration,
  inventoryGoogleDriveBackups,
  planBackupRetention,
  summarizeBackupGeneration,
  summarizeBackupInventory,
  trashBackupGeneration,
  uploadBackupBundle,
} from '../dist/application/backup/googleDriveSecondaryBackup.js';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readBody(body) {
  if (Buffer.isBuffer(body)) return body;
  const chunks = [];
  for await (const chunk of body(0)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function createFakeStore() {
  const objects = new Map();
  let puts = 0;
  let gets = 0;
  return {
    objects,
    get puts() {
      return puts;
    },
    get gets() {
      return gets;
    },
    store: {
      put: async (input) => {
        puts += 1;
        const body = await readBody(input.body);
        assert.equal(body.length, input.sizeBytes);
        assert.equal(sha256(body), input.sha256);
        const key = `file-${randomUUID()}`;
        const metadata = {
          key,
          checksum: {
            md5: createHash('md5').update(body).digest('hex'),
            sha256: input.sha256,
          },
          contentType: input.contentType,
          createdAt: '2026-07-22T01:02:03.000Z',
          modifiedAt: '2026-07-22T01:02:03.000Z',
          originalName: input.originalName,
          sizeBytes: input.sizeBytes,
          trashed: false,
          appProperties: {
            ...input.appProperties,
            erp4Sha256: input.sha256,
          },
        };
        objects.set(key, { body, metadata });
        return metadata;
      },
      get: async (key) => {
        gets += 1;
        const object = objects.get(key);
        if (!object) throw new Error('not_found');
        return { stream: Readable.from(object.body) };
      },
      list: async ({ appProperties = {} } = {}) => ({
        items: [...objects.values()]
          .map((object) => object.metadata)
          .filter(
            (metadata) =>
              !metadata.trashed &&
              Object.entries(appProperties).every(
                ([key, value]) => metadata.appProperties?.[key] === value,
              ),
          ),
      }),
      stat: async (key) => {
        const object = objects.get(key);
        if (!object) throw new Error('not_found');
        return object.metadata;
      },
      trash: async (key) => {
        const object = objects.get(key);
        if (!object) throw new Error('not_found');
        object.metadata = { ...object.metadata, trashed: true };
        objects.set(key, object);
      },
    },
  };
}

async function scratch(prefix) {
  const root = path.resolve(process.cwd(), '../..', '.codex-local', 'tmp');
  await mkdir(root, { recursive: true });
  return mkdtemp(path.join(root, prefix));
}

const TYPE_SUFFIXES = {
  database: 'db.dump',
  globals: 'globals.sql',
  metadata: 'meta.json',
  assets: 'assets.tar.gz',
};

async function createBundle(
  directory,
  {
    backupId = 'erp4-20260722-010203-deadbeefcafe',
    generatedAt = '2026-07-22T01:02:03.000Z',
    retentionClass = 'daily',
    types = ['database', 'globals', 'metadata'],
  } = {},
) {
  const artifactPaths = [];
  for (const type of types) {
    const sourceName = `${backupId}-${TYPE_SUFFIXES[type]}`;
    const artifactName = `${sourceName}.gpg`;
    const artifactPath = path.resolve(directory, artifactName);
    const body = Buffer.from(`encrypted-${type}-${backupId}`);
    await writeFile(artifactPath, body, { mode: 0o600 });
    const manifest = {
      schemaVersion: 'erp4.backup.manifest.v1',
      backupId,
      generatedAt,
      environment: 'prod',
      retentionClass,
      artifact: {
        type,
        name: artifactName,
        sourceName,
        sourceSizeBytes: body.length - 1,
        sizeBytes: body.length,
        sha256: sha256(body),
      },
      encryption: { algorithm: 'openpgp' },
      database: {
        name: 'erp4',
        version: '17.5',
        schemaVersion: '20260722000000_example',
      },
      application: { version: '1.0.0', commitSha: 'deadbeefcafe' },
    };
    await writeFile(
      `${artifactPath}.manifest.json`,
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 },
    );
    artifactPaths.push(artifactPath);
  }
  return artifactPaths;
}

test('upload validates an encrypted complete bundle and is idempotent', async () => {
  const directory = await scratch('backup-gdrive-upload-');
  const stateDir = path.join(directory, 'state');
  const fake = createFakeStore();
  let encryptionChecks = 0;
  try {
    const artifactPaths = await createBundle(directory);
    const options = {
      artifactPaths,
      assertEncrypted: async () => {
        encryptionChecks += 1;
      },
      stateDir,
      store: fake.store,
    };
    const first = await uploadBackupBundle(options);
    const second = await uploadBackupBundle(options);

    assert.equal(first.status, 'success');
    assert.equal(first.retentionClass, 'daily');
    assert.equal(first.objectCount, 6);
    assert.deepEqual(second, first);
    assert.equal(fake.puts, 6);
    assert.equal(fake.objects.size, 6);
    assert.equal(encryptionChecks, 6);
    assert.equal(
      fake.gets,
      6,
      'manifest verification download runs per upload',
    );
    const stateFile = path.join(stateDir, `${first.backupDigest}.json`);
    const stateDocument = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.equal(stateDocument.files.length, 6);
    assert.match(stateDocument.files[0].fileId, /^file-/);
    assert.equal((await stat(stateFile)).mode & 0o077, 0);
    assert.equal((await stat(stateDir)).mode & 0o077, 0);
    assert.doesNotMatch(JSON.stringify(first), /file-|folder-|secret-/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('upload fails closed when an existing logical object has conflicting metadata', async () => {
  const directory = await scratch('backup-gdrive-conflict-');
  const fake = createFakeStore();
  try {
    const options = {
      artifactPaths: await createBundle(directory),
      assertEncrypted: async () => undefined,
      stateDir: path.join(directory, 'state'),
      store: fake.store,
    };
    await uploadBackupBundle(options);
    const artifact = [...fake.objects.values()].find(
      (item) => item.metadata.appProperties.erp4BackupRole === 'artifact',
    );
    artifact.metadata = {
      ...artifact.metadata,
      appProperties: {
        ...artifact.metadata.appProperties,
        erp4ObjectSha256: '0'.repeat(64),
      },
    };
    fake.objects.set(artifact.metadata.key, artifact);

    await assert.rejects(uploadBackupBundle(options), {
      message: 'backup_google_drive_remote_verification_failed',
    });
    assert.equal(fake.puts, 6, 'conflict must not create a duplicate object');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('upload rejects plaintext, incomplete bundles, and checksum mismatch before remote writes', async () => {
  const directory = await scratch('backup-gdrive-invalid-');
  const fake = createFakeStore();
  try {
    const plaintextPaths = [
      'plain.dump',
      'plain-globals.sql',
      'plain-meta.json',
    ].map((name) => path.resolve(directory, name));
    await Promise.all(
      plaintextPaths.map((file) => writeFile(file, 'plaintext')),
    );
    await assert.rejects(
      uploadBackupBundle({
        artifactPaths: plaintextPaths,
        assertEncrypted: async () => undefined,
        stateDir: path.join(directory, 'state'),
        store: fake.store,
      }),
      { message: 'backup_google_drive_encrypted_artifact_required' },
    );

    const incomplete = await createBundle(directory, {
      backupId: 'erp4-20260722-020304-cafebabefeed',
      generatedAt: '2026-07-22T02:03:04.000Z',
      types: ['database', 'globals'],
    });
    await assert.rejects(
      uploadBackupBundle({
        artifactPaths: incomplete,
        assertEncrypted: async () => undefined,
        stateDir: path.join(directory, 'state'),
        store: fake.store,
      }),
      { message: 'backup_google_drive_bundle_invalid' },
    );

    const complete = await createBundle(directory, {
      backupId: 'erp4-20260722-030405-acdeabcdef12',
      generatedAt: '2026-07-22T03:04:05.000Z',
    });
    await writeFile(complete[0], 'changed-ciphertext');
    await assert.rejects(
      uploadBackupBundle({
        artifactPaths: complete,
        assertEncrypted: async () => undefined,
        stateDir: path.join(directory, 'state'),
        store: fake.store,
      }),
      { message: 'backup_google_drive_artifact_integrity_mismatch' },
    );
    assert.equal(fake.puts, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('inventory reports freshness without identifiers and detects corruption', async () => {
  const directory = await scratch('backup-gdrive-inventory-');
  const fake = createFakeStore();
  try {
    const artifactPaths = await createBundle(directory);
    const uploaded = await uploadBackupBundle({
      artifactPaths,
      assertEncrypted: async () => undefined,
      stateDir: path.join(directory, 'state'),
      store: fake.store,
    });
    const inventory = await inventoryGoogleDriveBackups(fake.store);
    const summary = summarizeBackupInventory(
      inventory,
      new Date('2026-07-23T00:00:00.000Z'),
    );
    const generation = summarizeBackupGeneration(
      inventory,
      uploaded.backupDigest,
    );

    assert.deepEqual(summary.anomalyCounts, {});
    assert.equal(summary.classes.daily.completeGenerations, 1);
    assert.equal(summary.classes.daily.freshness, 'fresh');
    assert.equal(summary.classes.weekly.freshness, 'unknown');
    assert.equal(summary.quota, 'unknown');
    assert.equal(generation.status, 'ready');
    assert.equal(generation.checksumStatus, 'verified');
    assert.equal(generation.totalSizeBytes > 0, true);
    assert.doesNotMatch(JSON.stringify(summary), /file-|folder-/);

    const first = fake.objects.values().next().value;
    first.metadata = { ...first.metadata, sizeBytes: 0 };
    fake.objects.set(first.metadata.key, first);
    const corrupted = await inventoryGoogleDriveBackups(fake.store);
    assert.equal(
      corrupted.anomalies.some((item) => item.code === 'zero_size'),
      true,
    );
    const corruptedGeneration = summarizeBackupGeneration(
      corrupted,
      uploaded.backupDigest,
    );
    assert.equal(corruptedGeneration.status, 'invalid');
    assert.equal(corruptedGeneration.checksumStatus, 'invalid');
    const corruptedSummary = summarizeBackupInventory(
      corrupted,
      new Date('2026-07-23T00:00:00.000Z'),
    );
    assert.equal(corruptedSummary.classes.daily.completeGenerations, 0);
    assert.equal(corruptedSummary.classes.daily.freshness, 'unknown');
    assert.equal(planBackupRetention(corrupted).applyAllowed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('download verifies a generation and writes an owner-only restore handoff', async () => {
  const directory = await scratch('backup-gdrive-download-');
  const destinationDir = path.join(directory, 'download');
  const handoffFile = path.join(destinationDir, 'restore-handoff.json');
  const fake = createFakeStore();
  try {
    const uploaded = await uploadBackupBundle({
      artifactPaths: await createBundle(directory),
      assertEncrypted: async () => undefined,
      stateDir: path.join(directory, 'state'),
      store: fake.store,
      verifyDownload: true,
    });
    const inventory = await inventoryGoogleDriveBackups(fake.store);
    const result = await downloadBackupGeneration({
      assertEncrypted: async () => undefined,
      backupDigest: uploaded.backupDigest,
      destinationDir,
      handoffFile,
      inventory,
      store: fake.store,
    });

    assert.equal(result.status, 'success');
    assert.equal(result.artifactCount, 3);
    const handoff = JSON.parse(await readFile(handoffFile, 'utf8'));
    assert.match(handoff.BACKUP_FILE, /-db\.dump\.gpg$/);
    assert.match(handoff.BACKUP_GLOBALS_FILE, /-globals\.sql\.gpg$/);
    assert.match(handoff.BACKUP_METADATA_FILE, /-meta\.json\.gpg$/);
    assert.equal((await stat(handoffFile)).mode & 0o077, 0);
    assert.equal((await stat(destinationDir)).mode & 0o077, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('retention stays dry-run, keeps the newest generation, and trash is explicit', async () => {
  const directory = await scratch('backup-gdrive-retention-');
  const fake = createFakeStore();
  try {
    const oldUpload = await uploadBackupBundle({
      artifactPaths: await createBundle(directory, {
        backupId: 'erp4-20260101-000000-deadbeefcafe',
        generatedAt: '2026-01-01T00:00:00.000Z',
      }),
      assertEncrypted: async () => undefined,
      stateDir: path.join(directory, 'state'),
      store: fake.store,
    });
    await uploadBackupBundle({
      artifactPaths: await createBundle(directory, {
        backupId: 'erp4-20260722-010203-cafebabefeed',
        generatedAt: '2026-07-22T01:02:03.000Z',
      }),
      assertEncrypted: async () => undefined,
      stateDir: path.join(directory, 'state'),
      store: fake.store,
    });
    const inventory = await inventoryGoogleDriveBackups(fake.store);
    const plan = planBackupRetention(
      inventory,
      new Date('2026-07-22T12:00:00.000Z'),
    );

    assert.equal(plan.mode, 'dry-run');
    assert.equal(plan.applyAllowed, true);
    assert.equal(plan.candidateGenerations, 1);
    assert.equal(plan.candidateObjects, 6);
    assert.equal(plan.protectedGenerations, 1);
    assert.equal(
      [...fake.objects.values()].filter((item) => item.metadata.trashed).length,
      0,
    );

    const trashed = await trashBackupGeneration(
      fake.store,
      inventory,
      oldUpload.backupDigest,
    );
    assert.equal(trashed.objectCount, 6);
    assert.equal(
      [...fake.objects.values()].filter((item) => item.metadata.trashed).length,
      6,
    );
  } finally {
    await chmod(directory, 0o700).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
