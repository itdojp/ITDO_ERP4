import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = '20260806090000_add_knowledge_provenance_foundation';
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
});

test('conversation links enforce identity, stable order, and a single primary item', () => {
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
    [
      '/knowledge/items/{itemId}/annotations/{annotationId}/revisions',
      'get',
    ],
    [
      '/knowledge/items/{itemId}/annotations/{annotationId}/revisions',
      'post',
    ],
    ['/knowledge/conversations', 'get'],
    ['/knowledge/conversations', 'post'],
    ['/knowledge/conversations/{conversationId}', 'get'],
    ['/knowledge/conversations/{conversationId}/items', 'post'],
    ['/knowledge/conversations/{conversationId}/items/{itemId}', 'delete'],
    ['/knowledge/conversations/{conversationId}/turns', 'get'],
    ['/knowledge/conversations/{conversationId}/turns', 'post'],
    ['/knowledge/syntheses', 'get'],
    ['/knowledge/syntheses', 'post'],
    ['/knowledge/syntheses/{synthesisId}', 'get'],
    ['/knowledge/syntheses/{synthesisId}/versions', 'get'],
    ['/knowledge/syntheses/{synthesisId}/versions', 'post'],
  ];
  for (const [path, method] of operations) {
    assert.ok(openapi.paths?.[path]?.[method], `${method.toUpperCase()} ${path}`);
    assert.ok(openapi.paths[path][method].responses?.['403']);
  }

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
});
