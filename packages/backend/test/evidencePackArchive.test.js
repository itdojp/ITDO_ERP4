import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { archiveEvidencePack } from '../dist/services/evidencePackArchive.js';

test('archiveEvidencePack: local provider stores content and metadata', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'evidence-archive-'));
  const previousProvider = process.env.EVIDENCE_ARCHIVE_PROVIDER;
  const previousLocalDir = process.env.EVIDENCE_ARCHIVE_LOCAL_DIR;
  process.env.EVIDENCE_ARCHIVE_PROVIDER = 'local';
  process.env.EVIDENCE_ARCHIVE_LOCAL_DIR = tempDir;

  try {
    const content = Buffer.from('{"hello":"world"}\n', 'utf8');
    const result = await archiveEvidencePack({
      approvalInstanceId: 'ap-1',
      snapshotId: 'snap-1',
      snapshotVersion: 2,
      format: 'json',
      mask: true,
      digest: 'abc123def4567890',
      exportedAt: new Date('2026-02-14T00:00:00.000Z'),
      archivedBy: 'user-1',
      content,
      contentType: 'application/json; charset=utf-8',
    });

    assert.equal(result.provider, 'local');
    const contentPath = fileURLToPath(result.archiveUri);
    const storedContent = await readFile(contentPath);
    assert.deepEqual(storedContent, content);

    const metadataPath = path.join(tempDir, result.metadataKey);
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    assert.equal(metadata.approvalInstanceId, 'ap-1');
    assert.equal(metadata.snapshotId, 'snap-1');
    assert.equal(metadata.snapshotVersion, 2);
    assert.equal(metadata.format, 'json');
    assert.equal(metadata.mask, true);
    assert.equal(metadata.digest, 'abc123def4567890');
  } finally {
    if (previousProvider === undefined) {
      delete process.env.EVIDENCE_ARCHIVE_PROVIDER;
    } else {
      process.env.EVIDENCE_ARCHIVE_PROVIDER = previousProvider;
    }
    if (previousLocalDir === undefined) {
      delete process.env.EVIDENCE_ARCHIVE_LOCAL_DIR;
    } else {
      process.env.EVIDENCE_ARCHIVE_LOCAL_DIR = previousLocalDir;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('archiveEvidencePack: s3 provider validates required config', async () => {
  const previousProvider = process.env.EVIDENCE_ARCHIVE_PROVIDER;
  const previousBucket = process.env.EVIDENCE_ARCHIVE_S3_BUCKET;
  const previousRegion = process.env.EVIDENCE_ARCHIVE_S3_REGION;
  const previousAwsRegion = process.env.AWS_REGION;
  const previousAwsDefaultRegion = process.env.AWS_DEFAULT_REGION;
  process.env.EVIDENCE_ARCHIVE_PROVIDER = 's3';
  delete process.env.EVIDENCE_ARCHIVE_S3_BUCKET;
  delete process.env.EVIDENCE_ARCHIVE_S3_REGION;
  delete process.env.AWS_REGION;
  delete process.env.AWS_DEFAULT_REGION;

  try {
    await assert.rejects(
      archiveEvidencePack({
        approvalInstanceId: 'ap-2',
        snapshotId: 'snap-2',
        snapshotVersion: 1,
        format: 'json',
        mask: false,
        digest: 'def456',
        exportedAt: new Date('2026-02-14T00:00:00.000Z'),
        archivedBy: 'user-2',
        content: Buffer.from('{}', 'utf8'),
        contentType: 'application/json; charset=utf-8',
      }),
      /evidence_archive_s3_config_invalid/,
    );
  } finally {
    if (previousProvider === undefined) {
      delete process.env.EVIDENCE_ARCHIVE_PROVIDER;
    } else {
      process.env.EVIDENCE_ARCHIVE_PROVIDER = previousProvider;
    }
    if (previousBucket === undefined) {
      delete process.env.EVIDENCE_ARCHIVE_S3_BUCKET;
    } else {
      process.env.EVIDENCE_ARCHIVE_S3_BUCKET = previousBucket;
    }
    if (previousRegion === undefined) {
      delete process.env.EVIDENCE_ARCHIVE_S3_REGION;
    } else {
      process.env.EVIDENCE_ARCHIVE_S3_REGION = previousRegion;
    }
    if (previousAwsRegion === undefined) {
      delete process.env.AWS_REGION;
    } else {
      process.env.AWS_REGION = previousAwsRegion;
    }
    if (previousAwsDefaultRegion === undefined) {
      delete process.env.AWS_DEFAULT_REGION;
    } else {
      process.env.AWS_DEFAULT_REGION = previousAwsDefaultRegion;
    }
  }
});

test('archiveEvidencePack: gdrive stores content and metadata behind safe artifact IDs', async () => {
  const previousProvider = process.env.EVIDENCE_ARCHIVE_PROVIDER;
  process.env.EVIDENCE_ARCHIVE_PROVIDER = 'gdrive';
  const stores = [];
  const contentArtifactId = '11111111-1111-4111-8111-111111111111';
  const metadataArtifactId = '22222222-2222-4222-8222-222222222222';
  const storage = (artifactId, kind) => ({
    store: async (input) => {
      stores.push([kind, input]);
      return {
        artifactId,
        contentType: input.contentType,
        createdAt: '2026-07-22T00:00:00.000Z',
        originalName: input.originalName,
        provider: 'gdrive',
        sha256: input.sha256,
        sizeBytes: input.sizeBytes,
      };
    },
  });

  try {
    const content = Buffer.from('{"safe":true}\n', 'utf8');
    const result = await archiveEvidencePack(
      {
        approvalInstanceId: 'approval-placeholder',
        snapshotId: 'snapshot-placeholder',
        snapshotVersion: 3,
        format: 'json',
        mask: true,
        digest: 'a'.repeat(64),
        exportedAt: new Date('2026-07-21T23:00:00.000Z'),
        archivedBy: 'operator-placeholder',
        content,
        contentType: 'application/json; charset=utf-8',
      },
      {
        createContentStorage: () => storage(contentArtifactId, 'content'),
        createMetadataStorage: () => storage(metadataArtifactId, 'metadata'),
        now: () => new Date('2026-07-22T00:00:00.000Z'),
      },
    );

    assert.equal(result.provider, 'gdrive');
    assert.equal(result.objectKey, contentArtifactId);
    assert.equal(result.metadataKey, metadataArtifactId);
    assert.equal(
      result.archiveUri,
      `/approval-instances/approval-placeholder/evidence-pack/archives/${contentArtifactId}`,
    );
    assert.equal(stores.length, 2);
    assert.equal(stores[0][0], 'content');
    assert.deepEqual(stores[0][1].body, content);
    assert.equal(stores[0][1].ownerType, 'approval_instance');
    assert.equal(stores[0][1].ownerId, 'approval-placeholder');
    assert.match(stores[0][1].idempotencyKey, /^evidence:/);
    assert.equal(stores[1][0], 'metadata');
    assert.equal(Buffer.isBuffer(stores[1][1].body), true);
    const metadata = JSON.parse(stores[1][1].body.toString('utf8'));
    assert.equal(metadata.snapshotVersion, 3);
    assert.equal(metadata.mask, true);
  } finally {
    if (previousProvider === undefined) {
      delete process.env.EVIDENCE_ARCHIVE_PROVIDER;
    } else {
      process.env.EVIDENCE_ARCHIVE_PROVIDER = previousProvider;
    }
  }
});

test('archiveEvidencePack: gdrive failure is explicit and never writes metadata as success', async () => {
  const previousProvider = process.env.EVIDENCE_ARCHIVE_PROVIDER;
  process.env.EVIDENCE_ARCHIVE_PROVIDER = 'gdrive';
  let metadataStoreCalls = 0;
  try {
    await assert.rejects(
      archiveEvidencePack(
        {
          approvalInstanceId: 'approval-placeholder',
          snapshotId: 'snapshot-placeholder',
          snapshotVersion: 1,
          format: 'json',
          mask: true,
          digest: 'b'.repeat(64),
          exportedAt: new Date('2026-07-22T00:00:00.000Z'),
          archivedBy: 'operator-placeholder',
          content: Buffer.from('{}\n', 'utf8'),
          contentType: 'application/json; charset=utf-8',
        },
        {
          createContentStorage: () => ({
            store: async () => {
              throw new Error('google_drive_quota');
            },
          }),
          createMetadataStorage: () => ({
            store: async () => {
              metadataStoreCalls += 1;
            },
          }),
        },
      ),
      /google_drive_quota/,
    );
    assert.equal(metadataStoreCalls, 0);
  } finally {
    if (previousProvider === undefined) {
      delete process.env.EVIDENCE_ARCHIVE_PROVIDER;
    } else {
      process.env.EVIDENCE_ARCHIVE_PROVIDER = previousProvider;
    }
  }
});
