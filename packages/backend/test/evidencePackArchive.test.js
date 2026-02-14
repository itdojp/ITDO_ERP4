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
