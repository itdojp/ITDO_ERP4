import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = '20260805170000_add_knowledge_snapshots';
const schema = readFileSync(
  new URL('../prisma/schema.prisma', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(
    `../prisma/migrations/${migrationDirectory}/migration.sql`,
    import.meta.url,
  ),
  'utf8',
);
const openapi = JSON.parse(
  readFileSync(
    new URL('../../../docs/api/openapi.json', import.meta.url),
    'utf8',
  ),
);

function schemaBlock(kind, name) {
  const match = schema.match(
    new RegExp(`\\b${kind} ${name}\\s*\\{([\\s\\S]*?)\\n\\}`),
  );
  assert.ok(match, `${kind} ${name} must exist`);
  return match[1];
}

test('schema adds typed snapshot lifecycle and capture method enums', () => {
  const expectedEnums = {
    KnowledgeSnapshotStatus: ['pending', 'ready', 'failed'],
    KnowledgeSnapshotCaptureMethod: ['text', 'url', 'upload'],
  };

  for (const [name, values] of Object.entries(expectedEnums)) {
    const block = schemaBlock('enum', name);
    for (const value of values) {
      assert.match(block, new RegExp(`\\b${value}\\b`));
    }
  }

  assert.match(
    migration,
    /CREATE TYPE "KnowledgeSnapshotStatus" AS ENUM \('pending', 'ready', 'failed'\)/,
  );
  assert.match(
    migration,
    /CREATE TYPE "KnowledgeSnapshotCaptureMethod" AS ENUM \('text', 'url', 'upload'\)/,
  );
});

test('KnowledgeSnapshot models append-only item versions and bounded storage metadata', () => {
  const model = schemaBlock('model', 'KnowledgeSnapshot');
  const expectedFields = [
    /id\s+String\s+@id\s+@default\(uuid\(\)\)/,
    /knowledgeItemId\s+String/,
    /artifactId\s+String\?\s+@unique/,
    /version\s+Int/,
    /status\s+KnowledgeSnapshotStatus\s+@default\(pending\)/,
    /captureMethod\s+KnowledgeSnapshotCaptureMethod/,
    /sourceUrl\s+String\?/,
    /originalName\s+String/,
    /contentType\s+String\?/,
    /sizeBytes\s+BigInt\?/,
    /sha256\s+String\?/,
    /extractedText\s+String\?\s+@db\.Text/,
    /requestKeyHash\s+String/,
    /requestPayloadHash\s+String/,
    /failureCode\s+String\?/,
    /capturedAt\s+DateTime\s+@default\(now\(\)\)/,
    /capturedBy\s+String/,
    /readyAt\s+DateTime\?/,
    /failedAt\s+DateTime\?/,
    /createdAt\s+DateTime\s+@default\(now\(\)\)/,
    /updatedAt\s+DateTime\s+@updatedAt/,
  ];
  for (const expected of expectedFields) assert.match(model, expected);

  assert.match(model, /@@unique\(\[knowledgeItemId, version\]\)/);
  assert.match(model, /@@unique\(\[knowledgeItemId, requestKeyHash\]\)/);
  assert.match(model, /@@index\(\[knowledgeItemId, status, createdAt\]\)/);
  assert.doesNotMatch(model, /\bdeletedAt\b/);
});

test('schema extends existing item and artifact owners without changing their ownership contract', () => {
  const snapshot = schemaBlock('model', 'KnowledgeSnapshot');
  assert.match(
    snapshot,
    /knowledgeItem\s+KnowledgeItem[\s\S]*?@relation\(fields: \[knowledgeItemId\], references: \[id\], onDelete: Restrict\)/,
  );
  assert.match(
    snapshot,
    /artifact\s+StorageArtifact\?[\s\S]*?@relation\(fields: \[artifactId\], references: \[id\], onDelete: Restrict\)/,
  );
  assert.match(
    schemaBlock('model', 'KnowledgeItem'),
    /snapshots\s+KnowledgeSnapshot\[\]/,
  );
  assert.match(
    schemaBlock('model', 'StorageArtifact'),
    /knowledgeSnapshot\s+KnowledgeSnapshot\?/,
  );
});

test('migration is additive and creates only the snapshot types, table, indexes, and foreign keys', () => {
  assert.doesNotMatch(
    migration,
    /\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|RENAME)\b/i,
  );
  assert.doesNotMatch(migration, /ALTER TABLE\s+"(?!KnowledgeSnapshot")/);
  assert.match(migration, /CREATE TABLE "KnowledgeSnapshot"/);

  const indexNames = [
    'KnowledgeSnapshot_artifactId_key',
    'KnowledgeSnapshot_knowledgeItemId_version_key',
    'KnowledgeSnapshot_knowledgeItemId_requestKeyHash_key',
    'KnowledgeSnapshot_knowledgeItemId_status_createdAt_idx',
  ];
  for (const indexName of indexNames) {
    assert.match(migration, new RegExp(`"${indexName}"`));
  }
});

test('migration enforces unique item versions, idempotency keys, lookup order, and artifact identity', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "KnowledgeSnapshot_artifactId_key"\s+ON "KnowledgeSnapshot"\("artifactId"\)/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "KnowledgeSnapshot_knowledgeItemId_version_key"\s+ON "KnowledgeSnapshot"\("knowledgeItemId", "version"\)/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "KnowledgeSnapshot_knowledgeItemId_requestKeyHash_key"\s+ON "KnowledgeSnapshot"\("knowledgeItemId", "requestKeyHash"\)/,
  );
  assert.match(
    migration,
    /CREATE INDEX "KnowledgeSnapshot_knowledgeItemId_status_createdAt_idx"\s+ON "KnowledgeSnapshot"\("knowledgeItemId", "status", "createdAt"\)/,
  );
});

test('migration foreign keys retain snapshots and artifacts with restrictive deletion', () => {
  assert.match(
    migration,
    /CONSTRAINT "KnowledgeSnapshot_knowledgeItemId_fkey"\s+FOREIGN KEY \("knowledgeItemId"\) REFERENCES "KnowledgeItem"\("id"\)\s+ON DELETE RESTRICT ON UPDATE CASCADE/,
  );
  assert.match(
    migration,
    /CONSTRAINT "KnowledgeSnapshot_artifactId_fkey"\s+FOREIGN KEY \("artifactId"\) REFERENCES "StorageArtifact"\("id"\)\s+ON DELETE RESTRICT ON UPDATE CASCADE/,
  );
});

test('migration bounds version, hashes, and size before state transitions', () => {
  assert.match(
    migration,
    /KnowledgeSnapshot_version_check" CHECK \("version" >= 1\)/,
  );
  assert.match(
    migration,
    /KnowledgeSnapshot_hash_check" CHECK \(\s*"sha256" IS NULL OR "sha256" ~ '\^\[a-f0-9\]\{64\}\$'\s*\)/,
  );
  assert.match(
    migration,
    /KnowledgeSnapshot_request_key_hash_check" CHECK \(\s*"requestKeyHash" ~ '\^\[a-f0-9\]\{64\}\$'\s*\)/,
  );
  assert.match(
    migration,
    /KnowledgeSnapshot_request_payload_hash_check" CHECK \(\s*"requestPayloadHash" ~ '\^\[a-f0-9\]\{64\}\$'\s*\)/,
  );
  assert.match(
    migration,
    /KnowledgeSnapshot_size_check" CHECK \(\s*"sizeBytes" IS NULL OR \("sizeBytes" >= 0 AND "sizeBytes" <= 10485760\)\s*\)/,
  );
  assert.match(
    migration,
    /KnowledgeSnapshot_content_type_check" CHECK \([\s\S]*?'text\/plain'[\s\S]*?'image\/gif'/,
  );
  assert.match(
    migration,
    /KnowledgeSnapshot_text_size_check" CHECK \([\s\S]*?"sizeBytes" <= 1048576/,
  );
});

test('migration state constraint makes pending, ready, and failed metadata mutually exclusive', () => {
  const constraint = migration.match(
    /CONSTRAINT "KnowledgeSnapshot_state_check" CHECK \(([\s\S]*?)\n    \)\n\);/,
  );
  assert.ok(constraint, 'KnowledgeSnapshot_state_check must exist');
  const state = constraint[1];

  assert.match(
    state,
    /"status" = 'pending'[\s\S]*?"artifactId" IS NULL[\s\S]*?"failureCode" IS NULL[\s\S]*?"readyAt" IS NULL[\s\S]*?"failedAt" IS NULL/,
  );
  assert.match(
    state,
    /"status" = 'ready'[\s\S]*?"artifactId" IS NOT NULL[\s\S]*?"sha256" IS NOT NULL[\s\S]*?"contentType" IS NOT NULL[\s\S]*?"sizeBytes" IS NOT NULL[\s\S]*?"failureCode" IS NULL[\s\S]*?"readyAt" IS NOT NULL[\s\S]*?"failedAt" IS NULL/,
  );
  assert.match(
    state,
    /"status" = 'failed'[\s\S]*?"artifactId" IS NULL[\s\S]*?"failureCode" IS NOT NULL[\s\S]*?"readyAt" IS NULL[\s\S]*?"failedAt" IS NOT NULL/,
  );
});

test('OpenAPI publishes snapshot operations without internal storage metadata', () => {
  const operations = [
    ['/knowledge/items/{itemId}/snapshots', 'get'],
    ['/knowledge/items/{itemId}/snapshots', 'post'],
    ['/knowledge/items/{itemId}/snapshots/upload', 'post'],
    ['/knowledge/items/{itemId}/snapshots/{snapshotId}', 'get'],
    ['/knowledge/items/{itemId}/snapshots/{snapshotId}/reconcile', 'post'],
    ['/knowledge/items/{itemId}/snapshots/{snapshotId}/download', 'get'],
  ];
  for (const [path, method] of operations) {
    assert.ok(
      openapi.paths?.[path]?.[method],
      `${method.toUpperCase()} ${path}`,
    );
    assert.ok(openapi.paths[path][method].responses?.['403']);
  }

  const detailSchema =
    openapi.paths['/knowledge/items/{itemId}/snapshots'].post.responses['201']
      .content['application/json'].schema;
  for (const internalField of [
    'artifactId',
    'requestKeyHash',
    'requestPayloadHash',
    'provider',
    'providerKey',
    'providerUrl',
  ]) {
    assert.equal(detailSchema.properties?.[internalField], undefined);
  }

  const downloadContent =
    openapi.paths['/knowledge/items/{itemId}/snapshots/{snapshotId}/download']
      .get.responses['200'].content;
  assert.equal(downloadContent['text/html'], undefined);
  assert.deepEqual(downloadContent['application/octet-stream'].schema, {
    type: 'string',
    format: 'binary',
  });
});
