import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = '20260805130000_add_knowledge_search_indexes';
const previousMigrationDirectory = '20260805090000_add_knowledge_labels';
const migrationsUrl = new URL('../prisma/migrations/', import.meta.url);
const schema = readFileSync(
  new URL('../prisma/schema.prisma', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(`${migrationDirectory}/migration.sql`, migrationsUrl),
  'utf8',
);

function schemaModel(name) {
  const match = schema.match(
    new RegExp(`\\bmodel ${name}\\s*\\{([\\s\\S]*?)\\n\\}`),
  );
  assert.ok(match, `model ${name} must exist`);
  return match[1];
}

test('knowledge item schema retains legacy indexes and adds stable cursor indexes', () => {
  const knowledgeItem = schemaModel('KnowledgeItem');
  const legacyIndexes = [
    '@@index([ownerUserId, deletedAt, updatedAt])',
    '@@index([organizationId, scope, deletedAt, updatedAt])',
    '@@index([scope, status, deletedAt, updatedAt])',
  ];
  const cursorIndexes = [
    '@@index([ownerUserId, deletedAt, updatedAt, id])',
    '@@index([organizationId, scope, deletedAt, updatedAt, id])',
    '@@index([scope, status, deletedAt, updatedAt, id])',
  ];

  for (const index of [...legacyIndexes, ...cursorIndexes]) {
    assert.ok(knowledgeItem.includes(index), `schema index missing: ${index}`);
  }
});

test('search migration adds the matching cursor indexes without replacing legacy indexes', () => {
  const expectedIndexes = [
    'CREATE INDEX "KnowledgeItem_ownerUserId_deletedAt_updatedAt_id_idx" ON "KnowledgeItem"("ownerUserId", "deletedAt", "updatedAt", "id");',
    'CREATE INDEX "KnowledgeItem_organizationId_scope_deletedAt_updatedAt_id_idx" ON "KnowledgeItem"("organizationId", "scope", "deletedAt", "updatedAt", "id");',
    'CREATE INDEX "KnowledgeItem_scope_status_deletedAt_updatedAt_id_idx" ON "KnowledgeItem"("scope", "status", "deletedAt", "updatedAt", "id");',
  ];

  for (const statement of expectedIndexes) {
    assert.ok(
      migration.includes(statement),
      `migration index missing: ${statement}`,
    );
  }
  assert.equal((migration.match(/^CREATE INDEX /gm) ?? []).length, 4);
});

test('active assignment index is partial and is not duplicated in Prisma schema', () => {
  assert.match(
    migration,
    /CREATE INDEX "KnowledgeItemLabel_active_labelId_knowledgeItemId_idx" ON "KnowledgeItemLabel"\("labelId", "knowledgeItemId"\) WHERE "detachedAt" IS NULL;/,
  );

  const itemLabel = schemaModel('KnowledgeItemLabel');
  assert.doesNotMatch(itemLabel, /@@index\(\[labelId, knowledgeItemId\]\)/);
});

test('search index migration follows labels and contains no destructive table operation', () => {
  const migrationDirectories = readdirSync(migrationsUrl, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const migrationIndex = migrationDirectories.indexOf(migrationDirectory);

  assert.notEqual(migrationIndex, -1, 'search index migration must exist');
  assert.equal(
    migrationDirectories[migrationIndex - 1],
    previousMigrationDirectory,
  );
  assert.doesNotMatch(migration, /\bDROP\b/i);
  assert.doesNotMatch(migration, /\bALTER\s+TABLE\b/i);
});
