import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const migrationDirectory = '20260805090000_add_knowledge_labels';
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
const openApi = JSON.parse(
  readFileSync(
    new URL('../../../docs/api/openapi.json', import.meta.url),
    'utf8',
  ),
);
const integrationScript = readFileSync(
  new URL('../../../scripts/test-knowledge-label-postgres.sh', import.meta.url),
  'utf8',
);
const oldAppScript = readFileSync(
  new URL('../../../scripts/test-knowledge-label-old-app.sh', import.meta.url),
  'utf8',
);
const oldAppFixture = readFileSync(
  new URL('../scripts/knowledge-old-app-compat.mjs', import.meta.url),
  'utf8',
);
const integrationFixturePath = fileURLToPath(
  new URL('../scripts/knowledge-label-integration.mjs', import.meta.url),
);
const oldAppFixturePath = fileURLToPath(
  new URL('../scripts/knowledge-old-app-compat.mjs', import.meta.url),
);

function schemaBlock(kind, name) {
  const match = schema.match(
    new RegExp(`\\b${kind} ${name}\\s*\\{([\\s\\S]*?)\\n\\}`),
  );
  assert.ok(match, `${kind} ${name} must exist`);
  return match[1];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('knowledge label schema defines the required additive enums and models', () => {
  const expectedEnums = {
    KnowledgeItemScope: ['personal', 'organization'],
    KnowledgeLabelAssignmentSource: ['manual', 'import', 'ai_suggestion'],
    KnowledgeLabelGrantCapability: ['use', 'manage'],
    KnowledgeSavedViewLabelOperator: ['any', 'all', 'not'],
  };

  for (const [enumName, values] of Object.entries(expectedEnums)) {
    const block = schemaBlock('enum', enumName);
    for (const value of values) {
      assert.match(block, new RegExp(`\\b${value}\\b`));
    }
  }

  const expectedModels = [
    'KnowledgeLabel',
    'KnowledgeLabelAlias',
    'KnowledgeLabelPath',
    'KnowledgeItemLabel',
    'KnowledgeLabelGroupGrant',
    'KnowledgeSavedView',
    'KnowledgeSavedViewLabelFilter',
  ];
  for (const modelName of expectedModels) {
    schemaBlock('model', modelName);
  }
});

test('labels model canonical hierarchy, ownership, logical version, and aliases', () => {
  const label = schemaBlock('model', 'KnowledgeLabel');
  assert.match(label, /scope\s+KnowledgeItemScope/);
  assert.match(label, /ownerUserId\s+String(?:\s|$)/);
  assert.doesNotMatch(label, /ownerUserId\s+String\?/);
  assert.match(label, /organizationId\s+String\?/);
  assert.match(label, /displayName\s+String/);
  assert.match(label, /slug\s+String/);
  assert.match(
    label,
    /parent\s+KnowledgeLabel\?[\s\S]*?fields: \[parentId\][\s\S]*?onDelete: Restrict/,
  );
  assert.match(label, /parentId\s+String\?/);
  assert.match(label, /version\s+Int\s+@default\(1\)/);
  assert.match(label, /deletedAt\s+DateTime\?/);

  const alias = schemaBlock('model', 'KnowledgeLabelAlias');
  assert.match(alias, /alias\s+String/);
  assert.match(alias, /normalizedAlias\s+String/);
  assert.match(alias, /@@unique\(\[labelId, normalizedAlias\]\)/);

  const path = schemaBlock('model', 'KnowledgeLabelPath');
  assert.match(path, /ancestorId\s+String/);
  assert.match(path, /descendantId\s+String/);
  assert.match(path, /depth\s+Int/);
  assert.match(path, /@@unique\(\[ancestorId, descendantId\]\)/);
});

test('assignment, grants, and saved views use typed scalar and normalized relation fields', () => {
  const itemLabel = schemaBlock('model', 'KnowledgeItemLabel');
  assert.match(itemLabel, /assignmentSource\s+KnowledgeLabelAssignmentSource/);
  assert.match(itemLabel, /assignedBy\s+String/);
  assert.match(itemLabel, /confidenceBasisPoints\s+Int\?/);
  assert.match(itemLabel, /detachedAt\s+DateTime\?/);
  assert.match(itemLabel, /detachedBy\s+String\?/);
  assert.doesNotMatch(itemLabel, /@@unique\(\[knowledgeItemId, labelId\]\)/);

  const grant = schemaBlock('model', 'KnowledgeLabelGroupGrant');
  assert.match(grant, /capability\s+KnowledgeLabelGrantCapability/);
  assert.match(grant, /active\s+Boolean\s+@default\(true\)/);
  assert.match(grant, /@@unique\(\[labelId, groupAccountId\]\)/);

  const savedView = schemaBlock('model', 'KnowledgeSavedView');
  for (const [field, type] of [
    ['sourceType', 'KnowledgeSourceType?'],
    ['status', 'KnowledgeItemStatus?'],
    ['scope', 'KnowledgeItemScope?'],
    ['publishedFrom', 'DateTime?'],
    ['publishedTo', 'DateTime?'],
    ['capturedFrom', 'DateTime?'],
    ['capturedTo', 'DateTime?'],
  ]) {
    assert.match(
      savedView,
      new RegExp(`\\b${field}\\s+${escapeRegex(type)}(?:\\s|$)`),
    );
  }
  assert.match(savedView, /ownerUserId\s+String/);
  assert.match(savedView, /schemaVersion\s+Int\s+@default\(1\)/);
  assert.match(savedView, /version\s+Int\s+@default\(1\)/);
  assert.match(savedView, /deletedAt\s+DateTime\?/);

  const labelFilter = schemaBlock('model', 'KnowledgeSavedViewLabelFilter');
  assert.match(labelFilter, /operator\s+KnowledgeSavedViewLabelOperator/);
  assert.match(labelFilter, /includeDescendants\s+Boolean\s+@default\(false\)/);
  assert.match(labelFilter, /@@unique\(\[savedViewId, labelId\]\)/);

  for (const block of [savedView, labelFilter]) {
    assert.doesNotMatch(block, /\bJson\??\b/);
  }
  assert.doesNotMatch(
    savedView,
    /\b(?:KnowledgeSourceType|KnowledgeItemStatus|KnowledgeItemScope)\[\]/,
  );
});

test('schema relations use restrictive deletion and extend existing owners', () => {
  const relationFields = [
    ['KnowledgeLabel', 'parent', 'KnowledgeLabel'],
    ['KnowledgeLabelAlias', 'label', 'KnowledgeLabel'],
    ['KnowledgeLabelPath', 'ancestor', 'KnowledgeLabel'],
    ['KnowledgeLabelPath', 'descendant', 'KnowledgeLabel'],
    ['KnowledgeItemLabel', 'knowledgeItem', 'KnowledgeItem'],
    ['KnowledgeItemLabel', 'label', 'KnowledgeLabel'],
    ['KnowledgeLabelGroupGrant', 'label', 'KnowledgeLabel'],
    ['KnowledgeLabelGroupGrant', 'groupAccount', 'GroupAccount'],
    ['KnowledgeSavedViewLabelFilter', 'savedView', 'KnowledgeSavedView'],
    ['KnowledgeSavedViewLabelFilter', 'label', 'KnowledgeLabel'],
  ];

  for (const [modelName, fieldName, target] of relationFields) {
    const block = schemaBlock('model', modelName);
    assert.match(
      block,
      new RegExp(
        `\\b${fieldName}\\s+${target}\\??[\\s\\S]*?@relation\\([\\s\\S]*?onDelete: Restrict\\)`,
      ),
      `${modelName}.${fieldName} must use onDelete: Restrict`,
    );
  }

  assert.match(
    schemaBlock('model', 'KnowledgeItem'),
    /labels\s+KnowledgeItemLabel\[\]/,
  );
  assert.match(
    schemaBlock('model', 'GroupAccount'),
    /knowledgeLabelGrants\s+KnowledgeLabelGroupGrant\[\]/,
  );
});

test('schema and migration define stable search indexes and active slug uniqueness', () => {
  const schemaIndexes = [
    '@@index([ownerUserId, deletedAt, updatedAt, id])',
    '@@index([organizationId, deletedAt, updatedAt, id])',
    '@@index([parentId, deletedAt, updatedAt, id])',
    '@@unique([labelId, normalizedAlias])',
    '@@index([normalizedAlias, updatedAt, id])',
    '@@unique([ancestorId, descendantId])',
    '@@index([descendantId, depth, ancestorId])',
    '@@index([knowledgeItemId, detachedAt, updatedAt, id])',
    '@@index([labelId, detachedAt, updatedAt, id])',
    '@@unique([labelId, groupAccountId])',
    '@@index([groupAccountId, active, updatedAt, id])',
    '@@unique([savedViewId, labelId])',
    '@@index([labelId, operator, savedViewId])',
  ];
  for (const index of schemaIndexes) {
    assert.ok(schema.includes(index), `schema index missing: ${index}`);
  }

  const migrationIndexes = [
    'KnowledgeLabel_ownerUserId_deletedAt_updatedAt_id_idx',
    'KnowledgeLabel_organizationId_deletedAt_updatedAt_id_idx',
    'KnowledgeLabel_parentId_deletedAt_updatedAt_id_idx',
    'KnowledgeLabelAlias_labelId_normalizedAlias_key',
    'KnowledgeLabelAlias_normalizedAlias_updatedAt_id_idx',
    'KnowledgeLabelPath_ancestorId_descendantId_key',
    'KnowledgeLabelPath_descendantId_depth_ancestorId_idx',
    'KnowledgeItemLabel_active_knowledgeItemId_labelId_key',
    'KnowledgeItemLabel_knowledgeItemId_detachedAt_updatedAt_id_idx',
    'KnowledgeItemLabel_labelId_detachedAt_updatedAt_id_idx',
    'KnowledgeLabelGroupGrant_labelId_groupAccountId_key',
    'KnowledgeLabelGroupGrant_groupAccountId_active_updatedAt_id_idx',
    'KnowledgeSavedView_ownerUserId_deletedAt_updatedAt_id_idx',
    'KnowledgeSavedViewLabelFilter_savedViewId_labelId_key',
    'KnowledgeSavedViewLabelFilter_labelId_operator_savedViewId_idx',
  ];
  for (const indexName of migrationIndexes) {
    assert.match(migration, new RegExp(`"${indexName}"`));
  }

  assert.match(
    migration,
    /CREATE UNIQUE INDEX "KnowledgeLabel_active_personal_ownerUserId_slug_key" ON "KnowledgeLabel"\("ownerUserId", "slug"\) WHERE "deletedAt" IS NULL AND "scope" = 'personal'/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "KnowledgeLabel_active_organization_organizationId_slug_key" ON "KnowledgeLabel"\("organizationId", "slug"\) WHERE "deletedAt" IS NULL AND "scope" = 'organization'/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "KnowledgeItemLabel_active_knowledgeItemId_labelId_key" ON "KnowledgeItemLabel"\("knowledgeItemId", "labelId"\) WHERE "detachedAt" IS NULL/,
  );
});

test('migration CHECK constraints enforce ownership, normalization, versions, confidence, and paths', () => {
  assert.match(
    migration,
    /CREATE TABLE "KnowledgeLabel"[\s\S]*?"ownerUserId" TEXT NOT NULL[\s\S]*?"displayName" TEXT NOT NULL/,
  );
  assert.match(
    migration,
    /KnowledgeLabel_scope_ownership_check[\s\S]*?"scope" = 'personal'[\s\S]*?"ownerUserId" IS NOT NULL[\s\S]*?BTRIM\("ownerUserId"\)[\s\S]*?"organizationId" IS NULL[\s\S]*?"scope" = 'organization'[\s\S]*?"ownerUserId" IS NOT NULL[\s\S]*?BTRIM\("ownerUserId"\)[\s\S]*?"organizationId" IS NOT NULL[\s\S]*?BTRIM\("organizationId"\)/,
  );
  for (const checkName of [
    'KnowledgeLabel_displayName_normalized_check',
    'KnowledgeLabel_slug_normalized_check',
    'KnowledgeLabelAlias_alias_normalized_check',
    'KnowledgeLabelAlias_normalizedAlias_nonblank_check',
    'KnowledgeItemLabel_assignedBy_nonblank_check',
    'KnowledgeSavedView_ownerUserId_nonblank_check',
    'KnowledgeSavedView_name_normalized_check',
  ]) {
    assert.match(migration, new RegExp(`${checkName}[\\s\\S]*?BTRIM`));
  }
  assert.match(
    migration,
    /KnowledgeLabel_version_check" CHECK \("version" >= 1\)/,
  );
  assert.match(
    migration,
    /KnowledgeSavedView_version_check" CHECK \("version" >= 1\)/,
  );
  assert.match(
    migration,
    /KnowledgeSavedView_schemaVersion_check" CHECK \("schemaVersion" >= 1\)/,
  );
  assert.match(
    migration,
    /KnowledgeItemLabel_confidenceBasisPoints_check[\s\S]*?"confidenceBasisPoints" IS NULL[\s\S]*?"assignmentSource" = 'ai_suggestion'[\s\S]*?"confidenceBasisPoints" BETWEEN 0 AND 10000/,
  );
  assert.match(
    migration,
    /KnowledgeItemLabel_detached_state_check[\s\S]*?"detachedAt" IS NULL[\s\S]*?"detachedBy" IS NULL[\s\S]*?"detachedAt" IS NOT NULL[\s\S]*?"detachedBy" IS NOT NULL[\s\S]*?BTRIM\("detachedBy"\)/,
  );
  assert.match(
    migration,
    /KnowledgeLabelPath_depth_check" CHECK \("depth" >= 0\)/,
  );
  assert.match(
    migration,
    /KnowledgeLabelPath_self_depth_check[\s\S]*?"ancestorId" = "descendantId" AND "depth" = 0[\s\S]*?"ancestorId" <> "descendantId" AND "depth" > 0/,
  );
  assert.match(
    migration,
    /Maximum hierarchy depth \(8\) is enforced by application runtime/,
  );
  assert.doesNotMatch(migration, /"depth"\s*<=\s*8/);
});

test('migration FKs are restrictive and the migration remains additive', () => {
  const expectedTables = [
    'KnowledgeLabel',
    'KnowledgeLabelAlias',
    'KnowledgeLabelPath',
    'KnowledgeItemLabel',
    'KnowledgeLabelGroupGrant',
    'KnowledgeSavedView',
    'KnowledgeSavedViewLabelFilter',
  ];
  const createdTables = [...migration.matchAll(/CREATE TABLE "([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(createdTables, expectedTables);

  const expectedForeignKeys = [
    ['KnowledgeLabel', 'parentId', 'KnowledgeLabel'],
    ['KnowledgeLabelAlias', 'labelId', 'KnowledgeLabel'],
    ['KnowledgeLabelPath', 'ancestorId', 'KnowledgeLabel'],
    ['KnowledgeLabelPath', 'descendantId', 'KnowledgeLabel'],
    ['KnowledgeItemLabel', 'knowledgeItemId', 'KnowledgeItem'],
    ['KnowledgeItemLabel', 'labelId', 'KnowledgeLabel'],
    ['KnowledgeLabelGroupGrant', 'labelId', 'KnowledgeLabel'],
    ['KnowledgeLabelGroupGrant', 'groupAccountId', 'GroupAccount'],
    ['KnowledgeSavedViewLabelFilter', 'savedViewId', 'KnowledgeSavedView'],
    ['KnowledgeSavedViewLabelFilter', 'labelId', 'KnowledgeLabel'],
  ];
  for (const [table, column, target] of expectedForeignKeys) {
    assert.match(
      migration,
      new RegExp(
        `ALTER TABLE "${table}"[\\s\\S]*?FOREIGN KEY \\(\"${column}\"\\) REFERENCES "${target}"\\(\"id\"\\) ON DELETE RESTRICT ON UPDATE CASCADE;`,
      ),
    );
  }
  assert.equal((migration.match(/FOREIGN KEY/g) ?? []).length, 10);
  assert.equal((migration.match(/ON DELETE RESTRICT/g) ?? []).length, 10);

  const alteredTables = [...migration.matchAll(/ALTER TABLE "([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual([...new Set(alteredTables)].sort(), [
    'KnowledgeItemLabel',
    'KnowledgeLabel',
    'KnowledgeLabelAlias',
    'KnowledgeLabelGroupGrant',
    'KnowledgeLabelPath',
    'KnowledgeSavedViewLabelFilter',
  ]);
  assert.doesNotMatch(
    migration,
    /^\s*(?:DROP|TRUNCATE|UPDATE|DELETE FROM|INSERT INTO)\b/im,
  );
  assert.doesNotMatch(
    migration,
    /ALTER TABLE "(?:KnowledgeItem|GroupAccount)"/,
  );
  assert.doesNotMatch(migration, /\bChat[A-Za-z]*\b/);
});

test('migration timestamp follows the contract and timestamp columns use millisecond precision', () => {
  const [timestamp] = migrationDirectory.split('_', 1);
  assert.equal(timestamp, '20260805090000');
  assert.ok(
    Number(timestamp) > Number('20260804090000'),
    'label migration must follow the knowledge core migration',
  );

  const timestampColumns = [
    ...migration.matchAll(/"[^"]+"\s+TIMESTAMP(?:\(\d+\))?/g),
  ].map((match) => match[0]);
  assert.ok(timestampColumns.length > 0);
  for (const declaration of timestampColumns) {
    assert.match(declaration, /TIMESTAMP\(3\)$/);
  }
});

test('OpenAPI exports every PR1 label operation with protected error contracts', () => {
  const expectedOperations = [
    ['get', '/knowledge/labels'],
    ['post', '/knowledge/labels'],
    ['get', '/knowledge/labels/{id}'],
    ['patch', '/knowledge/labels/{id}'],
    ['delete', '/knowledge/labels/{id}'],
    ['get', '/knowledge/labels/{id}/aliases'],
    ['post', '/knowledge/labels/{id}/aliases'],
    ['delete', '/knowledge/labels/{id}/aliases/{aliasId}'],
    ['get', '/knowledge/labels/{id}/group-grants'],
    ['put', '/knowledge/labels/{id}/group-grants'],
    ['post', '/knowledge/items/{id}/labels'],
    ['delete', '/knowledge/items/{id}/labels/{labelId}'],
  ];

  for (const [method, path] of expectedOperations) {
    const operation = openApi.paths?.[path]?.[method];
    assert.ok(operation, `${method.toUpperCase()} ${path} must be exported`);
    assert.ok(
      operation.responses?.['403'],
      `${method.toUpperCase()} ${path} must document canonical actor/role denial`,
    );
    assert.deepEqual(operation.tags, ['knowledge']);
  }

  const mutationOperations = expectedOperations.filter(([method]) =>
    ['post', 'put', 'patch', 'delete'].includes(method),
  );
  for (const [method, path] of mutationOperations) {
    const operation = openApi.paths[path][method];
    assert.equal(
      operation.requestBody.content['application/json'].schema
        .additionalProperties,
      false,
    );
    for (const status of ['400', '404', '409']) {
      assert.ok(
        operation.responses[status],
        `${method.toUpperCase()} ${path} must document ${status}`,
      );
    }
  }
});

test('OpenAPI keeps public assignment provenance manual-only and exposes typed response provenance', () => {
  const attach = openApi.paths['/knowledge/items/{id}/labels'].post;
  const body = attach.requestBody.content['application/json'].schema;
  assert.deepEqual(body.required, ['expectedVersion', 'labelId']);
  assert.deepEqual(Object.keys(body.properties).sort(), [
    'expectedVersion',
    'labelId',
  ]);
  assert.equal(body.properties.assignmentSource, undefined);
  assert.equal(body.properties.confidenceBasisPoints, undefined);

  const assignment =
    attach.responses['201'].content['application/json'].schema.properties
      .assignment;
  assert.deepEqual(assignment.properties.assignmentSource.enum, [
    'manual',
    'import',
    'ai_suggestion',
  ]);
  assert.equal(assignment.properties.confidenceBasisPoints.minimum, 0);
  assert.equal(assignment.properties.confidenceBasisPoints.maximum, 10000);
  assert.ok(assignment.required.includes('detachedAt'));
  assert.ok(assignment.required.includes('detachedBy'));
  assert.deepEqual(assignment.properties.detachedAt, {
    type: 'string',
    format: 'date-time',
    nullable: true,
  });
  assert.deepEqual(assignment.properties.detachedBy, {
    type: 'string',
    nullable: true,
  });
});

test('OpenAPI preserves label scope, optimistic version, and use/manage grant contracts', () => {
  const create = openApi.paths['/knowledge/labels'].post;
  assert.deepEqual(
    create.requestBody.content['application/json'].schema.properties.scope.enum,
    ['personal', 'organization'],
  );
  assert.deepEqual(
    create.requestBody.content['application/json'].schema.properties.groupGrants
      .items.properties.capability.enum,
    ['use', 'manage'],
  );

  const update = openApi.paths['/knowledge/labels/{id}'].patch;
  assert.equal(
    update.requestBody.content['application/json'].schema.properties
      .expectedVersion.maximum,
    2147483646,
  );
  const response = update.responses['200'].content['application/json'].schema;
  for (const field of [
    'id',
    'ownerUserId',
    'scope',
    'organizationId',
    'displayName',
    'slug',
    'parentId',
    'version',
  ]) {
    assert.ok(
      response.required.includes(field),
      `label response requires ${field}`,
    );
  }

  const replaceGrants =
    openApi.paths['/knowledge/labels/{id}/group-grants'].put;
  assert.deepEqual(
    replaceGrants.requestBody.content['application/json'].schema.properties
      .groupGrants.items.properties.capability.enum,
    ['use', 'manage'],
  );
});

test('PostgreSQL integration harness is ephemeral, fixed-image, and destructive-reset free', () => {
  assert.match(integrationScript, /postgres:15@sha256:[0-9a-f]{64}/);
  assert.match(integrationScript, /--tmpfs \/var\/lib\/postgresql\/data/);
  assert.match(integrationScript, /-p 127\.0\.0\.1::5432/);
  assert.match(integrationScript, /podman run --rm -d/);
  assert.match(integrationScript, /trap cleanup EXIT INT TERM/);
  assert.match(integrationScript, /podman stop --time 5 "\$CONTAINER_NAME"/);
  assert.doesNotMatch(integrationScript, /podman system reset/);
  assert.doesNotMatch(integrationScript, /podman volume (?:rm|prune)/);
  assert.doesNotMatch(integrationScript, /\bgit (?:reset|clean)\b/);
});

test('integration fixtures reject missing or malformed database URLs with controlled messages', () => {
  const cases = [
    {
      path: integrationFixturePath,
      env: { KNOWLEDGE_LABEL_INTEGRATION_CONFIRM: '1' },
      expected: /Refusing to run outside the confirmed loopback/,
    },
    {
      path: oldAppFixturePath,
      env: {
        KNOWLEDGE_OLD_APP_COMPAT_CONFIRM: '1',
        KNOWLEDGE_OLD_APP_COMPAT_MODE: 'seed',
        OLD_APP_ROOT: '.',
        PREEXISTING_ITEM_ID_FILE: 'synthetic-item-id',
      },
      expected: /Refusing to run outside the confirmed loopback/,
    },
  ];

  for (const fixture of cases) {
    for (const databaseUrl of [undefined, 'not-a-url']) {
      const env = { ...fixture.env };
      if (databaseUrl !== undefined) env.DATABASE_URL = databaseUrl;
      const result = spawnSync(process.execPath, [fixture.path], {
        encoding: 'utf8',
        env,
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, fixture.expected);
      assert.doesNotMatch(result.stderr, /ERR_INVALID_URL/);
    }
  }
});

test('old-app compatibility harness fixes the reviewed baseline and preserves pre-migration data', () => {
  const baseline = '358cb9e4d13489b703cb71cfee4b2754d15aa53e';
  assert.match(oldAppScript, new RegExp(baseline));
  assert.match(oldAppFixture, new RegExp(baseline));
  assert.match(oldAppScript, /git -C "\$ROOT_DIR" archive "\$BASE_SHA"/);
  assert.match(oldAppScript, /\.codex-local\/tmp\/knowledge-label-old-app/);
  assert.match(oldAppScript, /podman run --rm -d/);
  assert.match(oldAppScript, /--tmpfs \/var\/lib\/postgresql\/data/);
  assert.match(oldAppScript, /postgres:15@sha256:[0-9a-f]{64}/);
  assert.match(oldAppScript, /KNOWLEDGE_OLD_APP_COMPAT_MODE=seed/);
  assert.match(oldAppScript, /KNOWLEDGE_OLD_APP_COMPAT_MODE=verify/);
  assert.match(
    oldAppScript,
    /require\("node:crypto"\)\.randomBytes\(24\)/,
  );
  assert.doesNotMatch(oldAppScript, /\bopenssl\b/);
  assert.ok(
    oldAppScript.indexOf('KNOWLEDGE_OLD_APP_COMPAT_MODE=seed') <
      oldAppScript.indexOf('prisma migrate status'),
  );
  assert.match(oldAppFixture, /service\.list/);
  assert.match(oldAppFixture, /service\.count/);
  assert.match(oldAppFixture, /service\.detail/);
  assert.match(oldAppFixture, /service\.update/);
  assert.match(oldAppFixture, /service\.remove/);
  assert.match(oldAppFixture, /service\.restore/);
  assert.match(oldAppFixture, /url: '\/healthz'/);
  assert.match(oldAppFixture, /url: '\/readyz'/);
  for (const source of [oldAppScript, oldAppFixture]) {
    assert.doesNotMatch(source, /(?:^|\s)\/tmp\//m);
    assert.doesNotMatch(source, /\brm\s+-rf\b/);
    assert.doesNotMatch(source, /podman (?:system reset|volume (?:rm|prune))/);
  }
});
