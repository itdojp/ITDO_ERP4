import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = '20260806090000_add_knowledge_provenance_foundation';
const importMigrationDirectory =
  '20260808190000_add_knowledge_conversation_import';
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
const importMigration = readFileSync(
  new URL(
    `../prisma/migrations/${importMigrationDirectory}/migration.sql`,
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
const postgresIntegrationScript = readFileSync(
  new URL(
    '../../../scripts/test-knowledge-provenance-postgres.sh',
    import.meta.url,
  ),
  'utf8',
);
const importPostgresIntegrationScript = readFileSync(
  new URL(
    '../../../scripts/test-knowledge-conversation-import-postgres.sh',
    import.meta.url,
  ),
  'utf8',
);

function schemaBlock(kind, name) {
  const match = schema.match(
    new RegExp(`\\b${kind} ${name}\\s*\\{([\\s\\S]*?)\\n\\}`),
  );
  assert.ok(match, `${kind} ${name} must exist`);
  return match[1];
}

function resolveOpenApiSchema(value) {
  if (!value?.$ref) return value;
  const segments = value.$ref
    .replace(/^#\//, '')
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
  return segments.reduce((current, segment) => current?.[segment], openapi);
}

test('provenance enums are explicit finite allowlists', () => {
  const expected = {
    KnowledgeAnnotationKind: [
      'note',
      'question',
      'hypothesis',
      'quote',
      'todo',
    ],
    KnowledgeProvenanceOrigin: ['user', 'external', 'ai', 'system', 'tool'],
    KnowledgeConversationSourceType: ['manual', 'json', 'markdown'],
    KnowledgeConversationRole: ['user', 'assistant', 'system', 'tool'],
    KnowledgeConversationItemRelationType: [
      'primary',
      'supporting',
      'contradicting',
      'context',
    ],
    KnowledgeSynthesisSourceRelationType: [
      'primary',
      'supporting',
      'contradicting',
      'context',
    ],
  };
  for (const [name, values] of Object.entries(expected)) {
    const block = schemaBlock('enum', name);
    for (const value of values)
      assert.match(block, new RegExp(`\\b${value}\\b`));
    const type = migration.match(
      new RegExp(`CREATE TYPE "${name}" AS ENUM \\(([\\s\\S]*?)\\);`),
    );
    assert.ok(type, `${name} migration enum`);
    for (const value of values) assert.match(type[1], new RegExp(`'${value}'`));
  }
});

test('PostgreSQL drift gate covers provenance enums and models', () => {
  assert.match(
    postgresIntegrationScript,
    /knowledge_provenance_drift_pattern='Knowledge\(Provenance\|Annotation\|Conversation\|Synthesis\)/,
  );
  assert.match(
    postgresIntegrationScript,
    /grep -Eq "\$knowledge_provenance_drift_pattern"/,
  );
  assert.match(
    postgresIntegrationScript,
    /grep -E "\$knowledge_provenance_drift_pattern"/,
  );
});

test('bounded import ledger is owner-scoped, immutable, and bound by composite foreign key', () => {
  const ledger = schemaBlock('model', 'KnowledgeConversationImportRequest');
  for (const field of [
    'ownerUserId',
    'requestKeyHash',
    'canonicalPayloadHash',
    'sourceType',
    'conversationId',
    'createdBy',
  ]) {
    assert.match(ledger, new RegExp(`\\b${field}\\s+`), field);
  }
  assert.match(ledger, /@@unique\(\[ownerUserId, requestKeyHash\]\)/);
  assert.match(
    ledger,
    /fields: \[conversationId, ownerUserId\], references: \[id, ownerUserId\]/,
  );
  assert.match(
    importMigration,
    /CREATE TABLE "KnowledgeConversationImportRequest"/,
  );
  assert.match(importMigration, /requestKeyHash" ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(
    importMigration,
    /canonicalPayloadHash" ~ '\^\[0-9a-f\]\{64\}\$'/,
  );
  assert.match(
    importMigration,
    /FOREIGN KEY \("conversationId", "ownerUserId"\)[\s\S]*?REFERENCES "KnowledgeConversation"\("id", "ownerUserId"\)/,
  );
  assert.match(
    importMigration,
    /KnowledgeConversationImportRequest_immutable_trigger[\s\S]*?BEFORE UPDATE OR DELETE/,
  );
  assert.match(
    importMigration,
    /KnowledgeConversationTurn_import_name_check[\s\S]*?"role" = 'tool'[\s\S]*?"name" IN \('search', 'browser', 'code', 'file', 'other'\)/,
  );
  assert.match(
    importMigration,
    /KnowledgeConversation_import_provider_check[\s\S]*?"idempotencyHash" IS NULL[\s\S]*?"provider" IN \('openai', 'anthropic', 'google', 'microsoft', 'other'\)[\s\S]*?NOT VALID/,
  );
  assert.match(
    importMigration,
    /KnowledgeConversation_import_model_check[\s\S]*?"idempotencyHash" IS NULL[\s\S]*?"model" IN \('gpt', 'claude', 'gemini', 'copilot', 'other'\)[\s\S]*?NOT VALID/,
  );
  assert.match(
    importPostgresIntegrationScript,
    /KnowledgeConversationImportRequest\|KnowledgeConversation_import_/,
  );
  assert.doesNotMatch(
    importMigration,
    /\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|RENAME)\b/i,
  );
});

test('schema separates annotations, immutable revisions, conversations, turns, syntheses, versions, and sources', () => {
  const models = [
    'KnowledgeAnnotation',
    'KnowledgeAnnotationRevision',
    'KnowledgeConversation',
    'KnowledgeConversationItem',
    'KnowledgeConversationTurn',
    'KnowledgeSynthesis',
    'KnowledgeSynthesisVersion',
    'KnowledgeSynthesisSource',
  ];
  for (const name of models) {
    assert.match(
      schemaBlock('model', name),
      /id\s+String\s+@id\s+@default\(uuid\(\)\)/,
    );
    assert.match(migration, new RegExp(`CREATE TABLE "${name}"`));
  }

  assert.match(
    schemaBlock('model', 'KnowledgeAnnotationRevision'),
    /@@unique\(\[annotationId, revision\]\)/,
  );
  assert.match(
    schemaBlock('model', 'KnowledgeConversationTurn'),
    /@@unique\(\[conversationId, sequence\]\)/,
  );
  assert.match(
    schemaBlock('model', 'KnowledgeSynthesisVersion'),
    /@@unique\(\[synthesisId, version\]\)/,
  );
  for (const table of [
    'KnowledgeAnnotationRevision',
    'KnowledgeConversationTurn',
    'KnowledgeSynthesisVersion',
    'KnowledgeSynthesisSource',
  ]) {
    assert.match(
      migration,
      new RegExp(
        `CREATE TRIGGER "${table}_immutable_trigger"[\\s\\S]*?BEFORE UPDATE OR DELETE ON "${table}"`,
      ),
      `${table} must reject destructive history mutation`,
    );
  }
  assert.match(
    migration,
    /immutable knowledge provenance history cannot be updated or deleted/,
  );
});

test('synthesis provenance uses explicit foreign keys and an exactly-one database constraint', () => {
  const source = schemaBlock('model', 'KnowledgeSynthesisSource');
  const fields = [
    'sourceKnowledgeItemId',
    'sourceSnapshotId',
    'sourceAnnotationId',
    'sourceAnnotationRevisionId',
    'sourceConversationId',
    'sourceConversationTurnId',
    'sourceSynthesisVersionId',
  ];
  for (const field of fields) {
    assert.match(source, new RegExp(`\\b${field}\\s+String\\?`));
    assert.match(
      migration,
      new RegExp(`KnowledgeSynthesisSource_${field}_fkey`),
    );
  }
  assert.match(
    migration,
    /KnowledgeSynthesisSource_exactly_one_check" CHECK \([\s\S]*?NUM_NONNULLS\([\s\S]*?\) = 1/,
  );
  assert.match(migration, /KnowledgeSynthesisSource_no_self_reference_check/);
  assert.match(migration, /KnowledgeSynthesisSource_no_same_aggregate_trigger/);
  assert.match(
    migration,
    /target_version\."synthesisId" = source_version\."synthesisId"/,
  );
  assert.doesNotMatch(source, /\bsourceType\s+String/);
  assert.doesNotMatch(source, /\bsourceId\s+String/);
});

test('database constraints bound content, versions, hashes, confidence, scope, deletion state, and ordering', () => {
  const constraints = [
    'KnowledgeAnnotation_revision_check',
    'KnowledgeAnnotation_owner_check',
    'KnowledgeAnnotation_scope_organization_check',
    'KnowledgeAnnotation_deletion_state_check',
    'KnowledgeAnnotationRevision_content_check',
    'KnowledgeConversation_version_check',
    'KnowledgeConversation_content_hash_check',
    'KnowledgeConversation_idempotency_hash_check',
    'KnowledgeConversation_deletion_state_check',
    'KnowledgeConversationItem_owner_check',
    'KnowledgeConversationItem_ordinal_check',
    'KnowledgeConversationTurn_sequence_check',
    'KnowledgeConversationTurn_content_check',
    'KnowledgeConversationTurn_content_hash_check',
    'KnowledgeConversationTurn_role_origin_check',
    'KnowledgeSynthesis_version_check',
    'KnowledgeSynthesis_scope_organization_check',
    'KnowledgeSynthesis_deletion_state_check',
    'KnowledgeSynthesisVersion_content_check',
    'KnowledgeSynthesisVersion_questions_check',
    'KnowledgeSynthesisVersion_confidence_check',
    'KnowledgeSynthesisSource_ordinal_check',
  ];
  for (const name of constraints) {
    assert.match(migration, new RegExp(`CONSTRAINT "${name}"`), name);
  }
  assert.match(migration, /OCTET_LENGTH\("content"\) BETWEEN 1 AND 65536/);
  assert.match(migration, /OCTET_LENGTH\("content"\) BETWEEN 1 AND 262144/);
  assert.match(migration, /"confidenceBasisPoints" BETWEEN 0 AND 10000/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "KnowledgeAnnotationRevision_annotationId_revision_key"/,
  );
  assert.match(
    migration,
    /CREATE INDEX "KnowledgeSynthesis_organizationId_scope_deletedAt_updatedAt_idx"/,
  );
  assert.doesNotMatch(
    migration,
    /KnowledgeSynthesis_organizationId_scope_deletedAt_updatedAt_id_idx/,
  );
});

test('audit database constraint binds each provenance action group to its exact target table', () => {
  assert.match(migration, /"targetTable" IS NOT NULL/);
  assert.match(migration, /"targetId" IS NOT NULL/);
  const expected = [
    ['knowledge_annotation_created', 'knowledge_annotations'],
    ['knowledge_annotation_revised', 'knowledge_annotations'],
    ['knowledge_annotation_deleted', 'knowledge_annotations'],
    ['knowledge_conversation_created', 'knowledge_conversations'],
    ['knowledge_conversation_imported', 'knowledge_conversations'],
    ['knowledge_conversation_item_linked', 'knowledge_conversations'],
    ['knowledge_conversation_item_unlinked', 'knowledge_conversations'],
    ['knowledge_conversation_turn_appended', 'knowledge_conversations'],
    ['knowledge_synthesis_created', 'knowledge_syntheses'],
    ['knowledge_synthesis_version_appended', 'knowledge_syntheses'],
    ['knowledge_synthesis_source_linked', 'knowledge_syntheses'],
    ['knowledge_import_previewed', 'knowledge_imports'],
    ['knowledge_import_committed', 'knowledge_imports'],
    ['knowledge_import_duplicate_detected', 'knowledge_imports'],
    ['knowledge_import_rejected', 'knowledge_imports'],
  ];
  for (const [action, target] of expected) {
    assert.match(
      migration,
      new RegExp(`'${action}'[\\s\\S]*?"targetTable" = '${target}'`),
      `${action} -> ${target}`,
    );
  }
  assert.doesNotMatch(
    migration,
    /"targetTable" IN \(\s*'knowledge_annotations',\s*'knowledge_conversations'/,
  );
});

test('conversation links enforce same-owner identity, stable order, and a single primary item', () => {
  assert.match(
    migration,
    /KnowledgeConversationItem_conversationId_knowledgeItemId_key/,
  );
  assert.match(
    migration,
    /KnowledgeConversationItem_conversationId_ordinal_key/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "KnowledgeConversationItem_one_primary_key"[\s\S]*?WHERE "relationType" = 'primary'/,
  );
  assert.match(
    migration,
    /KnowledgeConversationItem_conversationId_ownerUserId_fkey"[\s\S]*?FOREIGN KEY \("conversationId", "ownerUserId"\)[\s\S]*?REFERENCES "KnowledgeConversation"\("id", "ownerUserId"\)/,
  );
  assert.match(
    migration,
    /KnowledgeConversationItem_knowledgeItemId_ownerUserId_fkey"[\s\S]*?FOREIGN KEY \("knowledgeItemId", "ownerUserId"\)[\s\S]*?REFERENCES "KnowledgeItem"\("id", "ownerUserId"\)/,
  );
  assert.match(migration, /KnowledgeConversation_id_ownerUserId_key/);
  assert.match(migration, /KnowledgeItem_id_ownerUserId_key/);
  assert.match(migration, /DEFERRABLE INITIALLY IMMEDIATE/);
  const relation = schemaBlock('model', 'KnowledgeConversationItem');
  assert.match(relation, /\bownerUserId\s+String/);
  assert.match(
    relation,
    /fields: \[conversationId, ownerUserId\], references: \[id, ownerUserId\]/,
  );
  assert.match(
    relation,
    /fields: \[knowledgeItemId, ownerUserId\], references: \[id, ownerUserId\]/,
  );
});

test('migration is expand-only and retains existing data on application rollback', () => {
  assert.doesNotMatch(
    migration,
    /\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|RENAME)\b/i,
  );
  assert.doesNotMatch(migration, /ON DELETE (?:CASCADE|SET NULL)/);
  assert.doesNotMatch(migration, /ALTER TYPE .* RENAME/i);
  assert.match(
    migration,
    /AuditLog_knowledge_provenance_target_check[\s\S]*?NOT VALID/,
  );
});

test('OpenAPI publishes the bounded provenance foundation without internal idempotency fields', () => {
  const operations = [
    ['/knowledge/items/{itemId}/annotations', 'get'],
    ['/knowledge/items/{itemId}/annotations', 'post'],
    ['/knowledge/items/{itemId}/annotations/{annotationId}', 'get'],
    ['/knowledge/items/{itemId}/annotations/{annotationId}', 'delete'],
    ['/knowledge/items/{itemId}/annotations/{annotationId}/revisions', 'get'],
    ['/knowledge/items/{itemId}/annotations/{annotationId}/revisions', 'post'],
    ['/knowledge/conversations', 'get'],
    ['/knowledge/conversations', 'post'],
    ['/knowledge/conversations/{conversationId}', 'get'],
    ['/knowledge/conversations/{conversationId}/items', 'post'],
    ['/knowledge/conversations/{conversationId}/items/{itemId}', 'delete'],
    ['/knowledge/conversations/{conversationId}/turns', 'get'],
    ['/knowledge/conversations/{conversationId}/turns', 'post'],
    ['/knowledge/conversations/import/preview', 'post'],
    ['/knowledge/conversations/import/commit', 'post'],
    ['/knowledge/syntheses', 'get'],
    ['/knowledge/syntheses', 'post'],
    ['/knowledge/syntheses/{synthesisId}', 'get'],
    ['/knowledge/syntheses/{synthesisId}/versions', 'get'],
    ['/knowledge/syntheses/{synthesisId}/versions', 'post'],
  ];
  for (const [path, method] of operations) {
    assert.ok(
      openapi.paths?.[path]?.[method],
      `${method.toUpperCase()} ${path}`,
    );
    assert.ok(openapi.paths[path][method].responses?.['400']);
    assert.ok(openapi.paths[path][method].responses?.['401']);
    assert.ok(openapi.paths[path][method].responses?.['403']);
    for (const status of ['400', '401']) {
      const failure =
        openapi.paths[path][method].responses[status].content[
          'application/json'
        ].schema;
      assert.equal(
        resolveOpenApiSchema(failure).properties.error.properties.details,
        undefined,
      );
    }
  }

  const annotationListParameters =
    openapi.paths['/knowledge/items/{itemId}/annotations'].get.parameters;
  const includeDeleted = annotationListParameters.find(
    (parameter) =>
      parameter.in === 'query' && parameter.name === 'includeDeleted',
  );
  assert.deepEqual(includeDeleted?.schema, {
    default: false,
    type: 'boolean',
  });

  const conversationList = openapi.paths['/knowledge/conversations'].get;
  const knowledgeItemFilter = conversationList.parameters.find(
    (parameter) =>
      parameter.in === 'query' && parameter.name === 'knowledgeItemId',
  );
  assert.deepEqual(knowledgeItemFilter?.schema, {
    maxLength: 100,
    minLength: 1,
    type: 'string',
  });
  assert.ok(conversationList.responses['404']);

  const conversation =
    openapi.paths['/knowledge/conversations'].post.responses['201'].content[
      'application/json'
    ].schema;
  for (const internal of [
    'idempotencyHash',
    'deletedAt',
    'deletedBy',
    'requestKey',
    'providerKey',
    'providerUrl',
  ]) {
    assert.equal(conversation.properties?.[internal], undefined, internal);
  }

  const synthesis =
    openapi.paths['/knowledge/syntheses/{synthesisId}'].get.responses['200']
      .content['application/json'].schema;
  const synthesisResponse = resolveOpenApiSchema(synthesis);
  const currentVersion = resolveOpenApiSchema(
    synthesisResponse.properties.currentVersion,
  );
  const source = resolveOpenApiSchema(currentVersion.properties.sources.items);
  assert.deepEqual(source.properties.sourceId, {
    nullable: true,
    type: 'string',
  });
  assert.deepEqual(source.properties.id, {
    nullable: true,
    type: 'string',
  });
  for (const internal of ['providerKey', 'providerUrl', 'rawMetadata']) {
    assert.equal(source.properties[internal], undefined);
  }
  const conversationResponse = resolveOpenApiSchema(
    openapi.paths['/knowledge/conversations'].post.responses['201'].content[
      'application/json'
    ].schema,
  );
  const nullableProvider = {
    type: 'string',
    nullable: true,
    enum: ['openai', 'anthropic', 'google', 'microsoft', 'other', null],
  };
  const nullableModel = {
    type: 'string',
    nullable: true,
    enum: ['gpt', 'claude', 'gemini', 'copilot', 'other', null],
  };
  assert.deepEqual(conversationResponse.properties.provider, nullableProvider);
  assert.deepEqual(conversationResponse.properties.model, nullableModel);
  const appendedTurnResponse = resolveOpenApiSchema(
    openapi.paths['/knowledge/conversations/{conversationId}/turns'].post
      .responses['201'].content['application/json'].schema,
  );
  const turnResponse = resolveOpenApiSchema(
    appendedTurnResponse.properties.turn,
  );
  assert.deepEqual(turnResponse.properties.name, {
    type: 'string',
    nullable: true,
    enum: ['search', 'browser', 'code', 'file', 'other', null],
  });

  const previewOperation =
    openapi.paths['/knowledge/conversations/import/preview'].post;
  const previewResponse =
    previewOperation.responses['200'].content['application/json'].schema;
  assert.equal(previewResponse.properties.warnings.maxItems, 0);
  assert.equal(previewResponse.properties.rejectedFields.maxItems, 0);
  for (const internal of [
    'canonicalPayloadHash',
    'requestKey',
    'itemIds',
    'content',
  ]) {
    assert.equal(previewResponse.properties[internal], undefined, internal);
  }
  const commitResponse =
    openapi.paths['/knowledge/conversations/import/commit'].post.responses[
      '200'
    ].content['application/json'].schema;
  for (const internal of [
    'canonicalPayloadHash',
    'requestKey',
    'previewToken',
    'providerKey',
  ]) {
    assert.equal(commitResponse.properties[internal], undefined, internal);
  }
  assert.ok(
    openapi.paths['/knowledge/conversations/import/commit'].post.responses[
      '409'
    ],
  );
});
