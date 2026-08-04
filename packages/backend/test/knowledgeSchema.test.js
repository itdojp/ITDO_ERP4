import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync(
  new URL('../prisma/schema.prisma', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(
    '../prisma/migrations/20260804090000_add_knowledge_core/migration.sql',
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

test('knowledge core schema defines explicit scope, status, source, version, and group grants', () => {
  assert.match(
    schema,
    /enum KnowledgeItemScope\s*{[^}]*personal[^}]*organization/s,
  );
  assert.match(schema, /enum KnowledgeItemStatus\s*{[^}]*inbox[^}]*archived/s);
  assert.match(schema, /enum KnowledgeSourceType\s*{[^}]*manual[^}]*other/s);
  assert.match(schema, /model KnowledgeItem\s*{[^}]*ownerUserId\s+String/s);
  assert.match(
    schema,
    /model KnowledgeItem\s*{[^}]*version\s+Int\s+@default\(1\)/s,
  );
  assert.match(schema, /model KnowledgeItem\s*{[^}]*deletedAt\s+DateTime\?/s);
  assert.match(
    schema,
    /model KnowledgeItemGroupGrant\s*{[^}]*@@unique\(\[knowledgeItemId, groupAccountId\]\)/s,
  );
  assert.match(
    schema,
    /groupAccount\s+GroupAccount\s+@relation\([^)]*onDelete: Restrict\)/,
  );
});

test('knowledge migration is additive and enforces scope/version invariants', () => {
  assert.match(migration, /CREATE TABLE "KnowledgeItem"/);
  assert.match(migration, /CREATE TABLE "KnowledgeItemGroupGrant"/);
  assert.match(migration, /KnowledgeItem_scope_organization_check/);
  assert.match(migration, /"scope" = 'personal' AND "organizationId" IS NULL/);
  assert.match(
    migration,
    /"scope" = 'organization' AND "organizationId" IS NOT NULL.*BTRIM/s,
  );
  assert.match(migration, /KnowledgeItem_version_check.*"version" >= 1/s);
  assert.match(
    migration,
    /FOREIGN KEY \("groupAccountId"\) REFERENCES "GroupAccount"\("id"\) ON DELETE RESTRICT/,
  );
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b/i);
  assert.doesNotMatch(migration, /ALTER TABLE "Chat/i);
  assert.doesNotMatch(migration, /CREATE TABLE "Chat/i);
});

test('knowledge migration does not mutate existing application tables', () => {
  const alteredTables = [...migration.matchAll(/ALTER TABLE "([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual([...new Set(alteredTables)], ['KnowledgeItemGroupGrant']);
});

test('knowledge OpenAPI operations document the role-based forbidden response', () => {
  const operations = [
    ['/knowledge/items', 'get'],
    ['/knowledge/items', 'post'],
    ['/knowledge/items/count', 'get'],
    ['/knowledge/items/{id}', 'get'],
    ['/knowledge/items/{id}', 'patch'],
    ['/knowledge/items/{id}', 'delete'],
    ['/knowledge/items/{id}/restore', 'post'],
  ];

  for (const [path, method] of operations) {
    assert.ok(
      openapi.paths?.[path]?.[method]?.responses?.['403'],
      `${method.toUpperCase()} ${path} must document 403`,
    );
  }
});
