import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const schema = await readFile(
  new URL('../prisma/schema.prisma', import.meta.url),
  'utf8',
);
const migration = await readFile(
  new URL(
    '../prisma/migrations/20260814100000_add_knowledge_capture_ingress/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const oldAppShell = await readFile(
  new URL(
    '../../../scripts/test-knowledge-capture-old-app.sh',
    import.meta.url,
  ),
  'utf8',
);

test('capture ingress schema is expand-only and owner-binds item plus snapshot', () => {
  assert.match(schema, /model KnowledgeCaptureRequest\s*\{/);
  assert.match(schema, /@@unique\(\[ownerUserId, requestKeyHash\]\)/);
  assert.match(
    schema,
    /knowledgeItem\s+KnowledgeItem\s+@relation\(fields: \[knowledgeItemId, ownerUserId\], references: \[id, ownerUserId\], onDelete: Restrict, onUpdate: Restrict\)/,
  );
  assert.match(
    schema,
    /snapshot\s+KnowledgeSnapshot\s+@relation\(fields: \[snapshotId, knowledgeItemId, snapshotVersion\], references: \[id, knowledgeItemId, version\], onDelete: Restrict, onUpdate: Restrict\)/,
  );
  assert.doesNotMatch(
    migration,
    /DROP TABLE|DROP COLUMN|ALTER COLUMN|RENAME COLUMN/i,
  );
  assert.match(migration, /ON DELETE RESTRICT/);
});

test('capture migration fixes bounded hashes, scope shape, and status transitions', () => {
  assert.match(migration, /KnowledgeCaptureRequest_hash_check/);
  assert.match(migration, /KnowledgeCaptureRequest_counts_check/);
  assert.match(migration, /KnowledgeCaptureRequest_scope_check/);
  assert.match(migration, /KnowledgeCaptureRequest_state_check/);
  assert.match(migration, /invalid knowledge capture transition/);
  assert.match(migration, /knowledge capture identity is immutable/);
  assert.match(migration, /knowledge capture history is immutable/);
  assert.match(migration, /BEFORE DELETE ON "KnowledgeCaptureRequest"/);
  assert.match(
    migration,
    /AuditLog_knowledge_capture_target_check[\s\S]*?"targetTable" = 'knowledge_capture_requests'[\s\S]*?"targetId" IS NOT NULL[\s\S]*?NOT VALID/,
  );
});

test('capture ledger stores no content, URL, token, or raw request key columns', () => {
  const model =
    schema.match(/model KnowledgeCaptureRequest\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  for (const forbidden of [
    'title',
    'canonicalUrl',
    'selectedText',
    'description',
    'author',
    'previewToken',
    'requestKey ',
    'snapshotBody',
  ]) {
    assert.equal(model.includes(forbidden), false, forbidden);
  }
  assert.match(model, /requestKeyHash\s+String/);
  assert.match(model, /payloadHash\s+String/);
});

test('capture old-app harness is pinned to the reviewed baseline and uses ephemeral PostgreSQL', () => {
  assert.match(
    oldAppShell,
    /EXPECTED_BASE_SHA="63351daafeba589fca402edb8ebae451256d6dae"/,
  );
  assert.match(oldAppShell, /--tmpfs \/var\/lib\/postgresql\/data/);
  assert.match(oldAppShell, /trap cleanup EXIT INT TERM/);
  assert.match(oldAppShell, /healthz/);
  assert.match(oldAppShell, /readyz/);
});
