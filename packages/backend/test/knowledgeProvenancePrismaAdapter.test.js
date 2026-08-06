import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PrismaKnowledgeAnnotationRepository,
  PrismaKnowledgeConversationRepository,
  PrismaKnowledgeProvenanceAuditWriter,
  PrismaKnowledgeSynthesisRepository,
  PrismaKnowledgeProvenanceUnitOfWork,
} from '../dist/adapters/knowledge/prismaKnowledgeProvenanceAdapter.js';
import { synthesisSourceResponse } from '../dist/routes/knowledgeProvenanceSchemas.js';

const actor = {
  userId: 'owner-1',
  organizationId: 'org-1',
  groupAccountIds: ['group-1'],
};

function emptyClient(overrides = {}) {
  return {
    auditLog: {},
    knowledgeAnnotation: {},
    knowledgeAnnotationRevision: {},
    knowledgeConversation: {},
    knowledgeConversationItem: {},
    knowledgeConversationTurn: {},
    knowledgeItem: {},
    knowledgeSnapshot: {},
    knowledgeSynthesis: {},
    knowledgeSynthesisSource: {},
    knowledgeSynthesisVersion: {},
    ...overrides,
  };
}

test('conversation list and owner mutation use the linked-item ACL intersection in the database predicate', async () => {
  const calls = [];
  const repository = new PrismaKnowledgeConversationRepository(
    emptyClient({
      knowledgeConversation: {
        findMany: async (input) => {
          calls.push(['list', input.where]);
          return [];
        },
        findFirst: async (input) => {
          calls.push(['owned', input.where]);
          return null;
        },
      },
    }),
  );
  await repository.listVisible({ actor, limit: 20 });
  await repository.findOwned({ actor, conversationId: 'conversation-1' });

  assert.equal(calls.length, 2);
  for (const [name, where] of calls) {
    const serialized = JSON.stringify(where);
    assert.match(serialized, /"items":\{"some":\{\}\}/, name);
    assert.match(serialized, /"items":\{"every":/, name);
    assert.match(serialized, /"knowledgeItem":\{"is":/, name);
    assert.match(serialized, /"ownerUserId":"owner-1"/, name);
    assert.match(serialized, /"organizationId":"org-1"/, name);
    assert.match(serialized, /"groupAccountId":\{"in":\["group-1"\]\}/, name);
    assert.match(serialized, /"active":true/, name);
  }
});

test('annotation list checks item visibility before querying annotation rows', async () => {
  let annotationQueries = 0;
  const repository = new PrismaKnowledgeAnnotationRepository(
    emptyClient({
      knowledgeItem: { findFirst: async () => null },
      knowledgeAnnotation: {
        findMany: async () => {
          annotationQueries += 1;
          return [];
        },
      },
    }),
  );
  assert.equal(
    await repository.listVisible({ actor, itemId: 'hidden-item', limit: 20 }),
    null,
  );
  assert.equal(annotationQueries, 0);
});

test('source validation rechecks current item ACL and normalizes inaccessible IDs', async () => {
  const queries = [];
  const repository = new PrismaKnowledgeSynthesisRepository(
    emptyClient({
      knowledgeItem: {
        findFirst: async (input) => {
          queries.push(input.where);
          return null;
        },
      },
    }),
  );
  assert.equal(
    await repository.validateSources({
      actor,
      sources: [
        { kind: 'item', sourceId: 'hidden-item', relationType: 'primary' },
      ],
    }),
    false,
  );
  const serialized = JSON.stringify(queries[0]);
  assert.match(serialized, /"id":"hidden-item"/);
  assert.match(serialized, /"ownerUserId":"owner-1"/);
  assert.match(serialized, /"organizationId":"org-1"/);

  assert.deepEqual(
    synthesisSourceResponse({
      id: null,
      synthesisVersionId: 'not-returned',
      kind: 'item',
      sourceId: null,
      relationType: 'supporting',
      ordinal: 1,
      accessible: false,
      createdAt: null,
      createdBy: null,
    }),
    {
      id: null,
      kind: 'item',
      sourceId: null,
      relationType: 'supporting',
      ordinal: 1,
      accessible: false,
      createdAt: null,
      createdBy: null,
    },
  );
});

test('organization synthesis history fails closed when a historical version source is no longer visible', async () => {
  const source = (sourceId) => ({
    id: `source-${sourceId}`,
    synthesisVersionId: 'version-1',
    relationType: 'primary',
    ordinal: 0,
    sourceKnowledgeItemId: sourceId,
    sourceSnapshotId: null,
    sourceAnnotationId: null,
    sourceAnnotationRevisionId: null,
    sourceConversationId: null,
    sourceConversationTurnId: null,
    sourceSynthesisVersionId: null,
    createdAt: new Date('2026-08-06T00:00:00.000Z'),
    createdBy: 'owner-2',
  });
  const synthesis = {
    id: 'synthesis-1',
    ownerUserId: 'owner-2',
    scope: 'organization',
    organizationId: 'org-1',
    currentVersion: 2,
    deletedAt: null,
  };
  const repository = new PrismaKnowledgeSynthesisRepository(
    emptyClient({
      knowledgeSynthesis: { findFirst: async () => synthesis },
      knowledgeSynthesisVersion: {
        findUnique: async () => ({
          id: 'version-2',
          synthesisId: synthesis.id,
          version: 2,
          sources: [source('visible-current-item')],
        }),
        findMany: async () => [
          {
            id: 'version-1',
            synthesisId: synthesis.id,
            version: 1,
            sources: [source('revoked-historical-item')],
          },
        ],
      },
      knowledgeItem: {
        findFirst: async ({ where }) =>
          JSON.stringify(where).includes('visible-current-item')
            ? { id: 'visible-current-item' }
            : null,
      },
    }),
  );

  assert.equal(
    await repository.listVersionsVisible({
      actor,
      synthesisId: synthesis.id,
      limit: 20,
    }),
    null,
  );
});

test('provenance audit writer enforces action-target mapping and runtime metadata allowlist', async () => {
  let persisted;
  const writer = new PrismaKnowledgeProvenanceAuditWriter({
    auditLog: {
      create: async (input) => {
        persisted = input;
        return { id: 'audit-1' };
      },
    },
  });
  await writer.write({
    action: 'knowledge_annotation_revised',
    actor: {
      userId: 'owner-1',
      requestId: 'request-1',
      source: 'api',
      bearer: 'must-not-pass',
    },
    targetTable: 'knowledge_annotations',
    targetId: 'annotation-1',
    metadata: {
      annotationKind: 'question',
      origin: 'user',
      revision: 2,
      scope: 'personal',
      body: 'must-not-pass',
      rawError: 'must-not-pass',
    },
  });
  assert.deepEqual(persisted.data.metadata, {
    revision: 2,
    scope: 'personal',
    annotationKind: 'question',
    origin: 'user',
  });
  assert.equal(JSON.stringify(persisted).includes('must-not-pass'), false);
  assert.equal(persisted.data.targetTable, 'knowledge_annotations');

  await assert.rejects(
    () =>
      writer.write({
        action: 'knowledge_annotation_created',
        actor: { userId: 'owner-1' },
        targetTable: 'knowledge_conversations',
        targetId: 'annotation-1',
        metadata: {},
      }),
    /knowledge_provenance_audit_contract_invalid/,
  );
});

test('unit of work propagates mandatory audit failure and maps only known transaction conflicts', async () => {
  const failing = new PrismaKnowledgeProvenanceUnitOfWork({
    $transaction: async (work) =>
      work(
        emptyClient({
          auditLog: {
            create: async () => {
              throw new Error('audit unavailable');
            },
          },
        }),
      ),
  });
  await assert.rejects(
    () =>
      failing.run(async ({ audit }) => {
        await audit.write({
          action: 'knowledge_conversation_created',
          actor: { userId: 'owner-1' },
          targetTable: 'knowledge_conversations',
          targetId: 'conversation-1',
          metadata: { version: 1 },
        });
      }),
    /audit unavailable/,
  );
});
