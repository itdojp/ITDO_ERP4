import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PrismaKnowledgeAnnotationRepository,
  PrismaKnowledgeConversationRepository,
  PrismaKnowledgeProvenanceAuditWriter,
  PrismaKnowledgeSynthesisRepository,
  PrismaKnowledgeProvenanceUnitOfWork,
} from '../dist/adapters/knowledge/prismaKnowledgeProvenanceAdapter.js';
import { createSynthesisAccessContext } from '../dist/application/knowledge/knowledgeSynthesisAccessContext.js';
import {
  conversationResponse,
  conversationTurnResponse,
  synthesisSourceResponse,
} from '../dist/routes/knowledgeProvenanceSchemas.js';

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

function itemSource(sourceId, overrides = {}) {
  return {
    id: `source-${sourceId}`,
    synthesisVersionId: 'version-parent',
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
    ...overrides,
  };
}

function versionSource(sourceId, overrides = {}) {
  return itemSource(sourceId, {
    id: `source-version-${sourceId}`,
    sourceKnowledgeItemId: null,
    sourceSynthesisVersionId: sourceId,
    ...overrides,
  });
}

function synthesisRow(id, overrides = {}) {
  const timestamp = new Date('2026-08-06T00:00:00.000Z');
  return {
    id,
    ownerUserId: 'owner-2',
    scope: 'organization',
    organizationId: 'org-1',
    title: `Synthesis ${id}`,
    currentVersion: 1,
    deletedAt: null,
    createdAt: timestamp,
    createdBy: 'owner-2',
    updatedAt: timestamp,
    updatedBy: 'owner-2',
    ...overrides,
  };
}

function conversationRow(id, overrides = {}) {
  const timestamp = new Date('2026-08-06T00:00:00.000Z');
  return {
    id,
    ownerUserId: 'owner-1',
    title: `Conversation ${id}`,
    sourceType: 'manual',
    provider: null,
    model: null,
    capturedAt: timestamp,
    importedAt: null,
    contentHash: 'a'.repeat(64),
    idempotencyHash: null,
    version: 1,
    deletedAt: null,
    deletedBy: null,
    createdAt: timestamp,
    createdBy: 'owner-1',
    updatedAt: timestamp,
    updatedBy: 'owner-1',
    items: [],
    ...overrides,
  };
}

test('conversation response keeps untrusted provider/model/tool labels redacted', () => {
  const now = new Date('2026-08-06T00:00:00.000Z');
  const response = conversationResponse({
    id: 'conversation-1',
    ownerUserId: 'owner-1',
    title: 'Synthetic conversation',
    sourceType: 'manual',
    provider: 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
    model: 'synthetic-credential-marker',
    capturedAt: now,
    importedAt: null,
    contentHash: 'a'.repeat(64),
    version: 1,
    deletedAt: null,
    createdAt: now,
    createdBy: 'owner-1',
    updatedAt: now,
    updatedBy: 'owner-1',
    items: [],
  });
  const turn = conversationTurnResponse({
    id: 'turn-1',
    conversationId: 'conversation-1',
    sequence: 1,
    role: 'tool',
    origin: 'tool',
    content: 'Synthetic tool result',
    name: 'AIzaSyntheticNotASecret',
    occurredAt: null,
    contentHash: 'b'.repeat(64),
    createdAt: now,
    createdBy: 'owner-1',
  });
  assert.equal(response.provider, null);
  assert.equal(response.model, null);
  assert.equal(turn.name, null);
  assert.equal(JSON.stringify({ response, turn }).includes('sk-proj-'), false);
  assert.equal(JSON.stringify({ response, turn }).includes('AKIA'), false);
  assert.equal(JSON.stringify({ response, turn }).includes('AIza'), false);
});

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

test('annotation content queries repeat the current parent ACL predicate', async () => {
  const annotationPredicates = [];
  const repository = new PrismaKnowledgeAnnotationRepository(
    emptyClient({
      knowledgeItem: {
        findFirst: async () => ({
          id: 'item-1',
          ownerUserId: 'owner-1',
          scope: 'personal',
          organizationId: null,
        }),
      },
      knowledgeAnnotation: {
        findMany: async ({ where }) => {
          annotationPredicates.push(where);
          return [];
        },
        findFirst: async ({ where }) => {
          annotationPredicates.push(where);
          return null;
        },
      },
    }),
  );

  await repository.listVisible({ actor, itemId: 'item-1', limit: 20 });
  await repository.findVisible({
    actor,
    itemId: 'item-1',
    annotationId: 'annotation-1',
  });

  assert.equal(annotationPredicates.length, 2);
  for (const predicate of annotationPredicates) {
    const serialized = JSON.stringify(predicate);
    assert.match(serialized, /"knowledgeItem":\{"is":/);
    assert.match(serialized, /"ownerUserId":"owner-1"/);
    assert.match(serialized, /"deletedAt":null/);
  }
});

test('annotation history and owner mutations require a non-deleted parent item', async () => {
  const predicates = [];
  const repository = new PrismaKnowledgeAnnotationRepository(
    emptyClient({
      knowledgeAnnotation: {
        findFirst: async ({ where }) => {
          predicates.push(where);
          return null;
        },
        updateMany: async ({ where }) => {
          predicates.push(where);
          return { count: 0 };
        },
      },
    }),
  );
  await repository.listRevisionsVisible({
    actor,
    itemId: 'item-1',
    annotationId: 'annotation-1',
    limit: 20,
  });
  await repository.findOwned({
    actor,
    itemId: 'item-1',
    annotationId: 'annotation-1',
    deleted: false,
  });
  await repository.revise({
    actor,
    annotationId: 'annotation-1',
    expectedRevision: 1,
    kind: 'note',
    origin: 'user',
    content: 'Synthetic revision',
  });
  await repository.logicallyDelete({
    actor,
    annotationId: 'annotation-1',
    expectedRevision: 1,
    deletedAt: new Date('2026-08-06T00:00:00.000Z'),
  });

  assert.equal(predicates.length, 4);
  for (const predicate of predicates) {
    const serialized = JSON.stringify(predicate);
    assert.match(serialized, /"knowledgeItem"/);
    assert.match(serialized, /"ownerUserId":"owner-1"/);
    assert.match(serialized, /"deletedAt":null/);
  }
});

test('annotation revision rows repeat current parent ACL after the initial visibility check', async () => {
  let revisionPredicate;
  const repository = new PrismaKnowledgeAnnotationRepository(
    emptyClient({
      knowledgeAnnotation: {
        findFirst: async () => ({ id: 'annotation-1' }),
      },
      knowledgeAnnotationRevision: {
        findMany: async ({ where }) => {
          revisionPredicate = where;
          return [];
        },
      },
    }),
  );

  assert.deepEqual(
    await repository.listRevisionsVisible({
      actor,
      itemId: 'item-1',
      annotationId: 'annotation-1',
      limit: 20,
    }),
    { items: [], nextBoundary: null },
  );

  const serialized = JSON.stringify(revisionPredicate);
  assert.match(serialized, /"annotation":\{"is":/);
  assert.match(serialized, /"knowledgeItemId":"item-1"/);
  assert.match(serialized, /"ownerUserId":"owner-1"/);
  assert.match(serialized, /"organizationId":"org-1"/);
  assert.match(serialized, /"groupAccountId":\{"in":\["group-1"\]\}/);
  assert.match(serialized, /"active":true/);
  assert.match(serialized, /"deletedAt":null/);
});

test('conversation turn rows repeat the linked-item ACL intersection after the initial visibility check', async () => {
  let turnPredicate;
  const repository = new PrismaKnowledgeConversationRepository(
    emptyClient({
      knowledgeConversation: {
        findFirst: async () => conversationRow('conversation-1'),
      },
      knowledgeConversationTurn: {
        findMany: async ({ where }) => {
          turnPredicate = where;
          return [];
        },
      },
    }),
  );

  assert.deepEqual(
    await repository.listTurnsVisible({
      actor,
      conversationId: 'conversation-1',
      limit: 20,
    }),
    { items: [], nextBoundary: null },
  );

  const serialized = JSON.stringify(turnPredicate);
  assert.match(serialized, /"conversation":\{"is":/);
  assert.match(serialized, /"items":\{"some":\{\}\}/);
  assert.match(serialized, /"items":\{"every":/);
  assert.match(serialized, /"knowledgeItem":\{"is":/);
  assert.match(serialized, /"ownerUserId":"owner-1"/);
  assert.match(serialized, /"organizationId":"org-1"/);
  assert.match(serialized, /"groupAccountId":\{"in":\["group-1"\]\}/);
  assert.match(serialized, /"active":true/);
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
      accessContext: createSynthesisAccessContext(),
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

test('provenance reads and mutations use one Repeatable Read snapshot', async () => {
  const isolationLevels = [];
  const transactionClient = emptyClient({
    knowledgeItem: { findFirst: async () => ({ id: 'visible-item' }) },
  });
  const host = emptyClient({
    $transaction: async (read, options) => {
      isolationLevels.push(options?.isolationLevel);
      return read(transactionClient);
    },
  });
  const annotationRepository = new PrismaKnowledgeAnnotationRepository(host);
  const conversationRepository = new PrismaKnowledgeConversationRepository(
    host,
  );
  const repository = new PrismaKnowledgeSynthesisRepository(host);
  assert.equal(
    await annotationRepository.withConsistentSnapshot(async () =>
      Promise.resolve('annotation'),
    ),
    'annotation',
  );
  assert.equal(
    await conversationRepository.withConsistentSnapshot(async () =>
      Promise.resolve('conversation'),
    ),
    'conversation',
  );
  const visible = await repository.withConsistentSnapshot((reader) =>
    reader.validateSources({
      actor,
      accessContext: createSynthesisAccessContext(),
      sources: [
        { kind: 'item', sourceId: 'visible-item', relationType: 'primary' },
      ],
    }),
  );
  assert.equal(visible, true);
  assert.deepEqual(isolationLevels, [
    'RepeatableRead',
    'RepeatableRead',
    'RepeatableRead',
  ]);

  const noTransactionRepository = new PrismaKnowledgeAnnotationRepository(
    emptyClient({
      knowledgeItem: {},
    }),
  );
  assert.equal(
    await noTransactionRepository.withConsistentSnapshot(async () =>
      Promise.resolve('existing-transaction'),
    ),
    'existing-transaction',
  );
  const noTransactionConversationRepository =
    new PrismaKnowledgeConversationRepository(emptyClient());
  assert.equal(
    await noTransactionConversationRepository.withConsistentSnapshot(async () =>
      Promise.resolve('existing-conversation-transaction'),
    ),
    'existing-conversation-transaction',
  );

  let mutationIsolation;
  const unitOfWork = new PrismaKnowledgeProvenanceUnitOfWork({
    $transaction: async (work, options) => {
      mutationIsolation = options?.isolationLevel;
      return work(emptyClient());
    },
  });
  await unitOfWork.run(async () => undefined);
  assert.equal(mutationIsolation, 'RepeatableRead');
});

test('same-synthesis historical versions are rejected as sources', async () => {
  const predicates = [];
  const repository = new PrismaKnowledgeSynthesisRepository(
    emptyClient({
      knowledgeSynthesisVersion: {
        findFirst: async ({ where }) => {
          predicates.push(where);
          return where.synthesisId === 'synthesis-target'
            ? { id: where.id }
            : null;
        },
      },
    }),
  );
  assert.equal(
    await repository.validateSources({
      actor,
      accessContext: createSynthesisAccessContext(),
      excludedSynthesisId: 'synthesis-target',
      sources: [
        {
          kind: 'synthesis_version',
          sourceId: 'version-old',
          relationType: 'primary',
        },
      ],
    }),
    false,
  );
  assert.deepEqual(predicates, [
    { id: 'version-old', synthesisId: 'synthesis-target' },
  ]);
});

test('recursive synthesis access is memoized, detects cycles, and enforces the documented depth', async () => {
  function chainRepository(versionCount) {
    let versionQueries = 0;
    let itemQueries = 0;
    const repository = new PrismaKnowledgeSynthesisRepository(
      emptyClient({
        knowledgeSynthesisVersion: {
          findFirst: async ({ where }) => {
            versionQueries += 1;
            const sequence = Number(where.id.slice(1));
            return {
              id: where.id,
              synthesisId: `synthesis-${where.id}`,
              version: 1,
              synthesis: { ownerUserId: 'owner-2' },
              sources:
                sequence < versionCount
                  ? [versionSource(`v${sequence + 1}`)]
                  : [itemSource('visible-item')],
            };
          },
        },
        knowledgeItem: {
          findFirst: async () => {
            itemQueries += 1;
            return { id: 'visible-item' };
          },
        },
      }),
    );
    return { repository, counts: () => ({ versionQueries, itemQueries }) };
  }

  const depth16 = chainRepository(16);
  assert.equal(
    await depth16.repository.validateSources({
      actor,
      accessContext: createSynthesisAccessContext(),
      sources: [
        { kind: 'synthesis_version', sourceId: 'v1', relationType: 'primary' },
      ],
    }),
    true,
  );
  assert.deepEqual(depth16.counts(), { versionQueries: 16, itemQueries: 1 });

  const depth17 = chainRepository(17);
  assert.equal(
    await depth17.repository.validateSources({
      actor,
      accessContext: createSynthesisAccessContext(),
      sources: [
        { kind: 'synthesis_version', sourceId: 'v1', relationType: 'primary' },
      ],
    }),
    false,
  );
  assert.deepEqual(depth17.counts(), { versionQueries: 16, itemQueries: 0 });

  const cycle = new PrismaKnowledgeSynthesisRepository(
    emptyClient({
      knowledgeSynthesisVersion: {
        findFirst: async ({ where }) => ({
          id: where.id,
          synthesisId: `synthesis-${where.id}`,
          version: 1,
          synthesis: { ownerUserId: 'owner-2' },
          sources: [versionSource(where.id === 'v1' ? 'v2' : 'v1')],
        }),
      },
    }),
  );
  assert.equal(
    await cycle.validateSources({
      actor,
      accessContext: createSynthesisAccessContext(),
      sources: [
        { kind: 'synthesis_version', sourceId: 'v1', relationType: 'primary' },
      ],
    }),
    false,
  );
});

test('shared synthesis provenance DAG uses request-scoped memoization', async () => {
  let versionQueries = 0;
  let itemQueries = 0;
  const graph = {
    v1: [versionSource('v2'), versionSource('v3', { ordinal: 1 })],
    v2: [versionSource('v4')],
    v3: [versionSource('v4')],
    v4: [itemSource('visible-item')],
  };
  const repository = new PrismaKnowledgeSynthesisRepository(
    emptyClient({
      knowledgeSynthesisVersion: {
        findFirst: async ({ where }) => {
          versionQueries += 1;
          return {
            id: where.id,
            synthesisId: `synthesis-${where.id}`,
            version: 1,
            synthesis: { ownerUserId: 'owner-2' },
            sources: graph[where.id],
          };
        },
      },
      knowledgeItem: {
        findFirst: async () => {
          itemQueries += 1;
          return { id: 'visible-item' };
        },
      },
    }),
  );
  assert.equal(
    await repository.validateSources({
      actor,
      accessContext: createSynthesisAccessContext(),
      sources: [
        { kind: 'synthesis_version', sourceId: 'v1', relationType: 'primary' },
      ],
    }),
    true,
  );
  assert.equal(versionQueries, 4);
  assert.equal(itemQueries, 1);
});

test('mixed-depth shared provenance DAG fails closed regardless of source order', async () => {
  const graph = {
    shared: [versionSource('leaf')],
    leaf: [itemSource('visible-item')],
  };
  for (let depth = 1; depth <= 15; depth += 1) {
    graph[`deep-${depth}`] = [
      versionSource(depth === 15 ? 'shared' : `deep-${depth + 1}`),
    ];
  }
  for (const order of [
    ['shared', 'deep-1'],
    ['deep-1', 'shared'],
  ]) {
    const repository = new PrismaKnowledgeSynthesisRepository(
      emptyClient({
        knowledgeSynthesisVersion: {
          findFirst: async ({ where }) => ({
            id: where.id,
            synthesisId: `synthesis-${where.id}`,
            version: 1,
            synthesis: { ownerUserId: 'owner-2' },
            sources: graph[where.id],
          }),
        },
        knowledgeItem: {
          findFirst: async () => ({ id: 'visible-item' }),
        },
      }),
    );
    assert.equal(
      await repository.validateSources({
        actor,
        accessContext: createSynthesisAccessContext(),
        sources: order.map((sourceId, ordinal) => ({
          kind: 'synthesis_version',
          sourceId,
          relationType: ordinal === 0 ? 'primary' : 'supporting',
        })),
      }),
      false,
      order.join(','),
    );
  }
});

test('synthesis mutation reuses one access context across repository operations', async () => {
  let itemQueries = 0;
  const synthesis = synthesisRow('synthesis-owned', {
    ownerUserId: actor.userId,
    scope: 'personal',
    organizationId: null,
  });
  const version = {
    id: 'version-owned',
    synthesisId: synthesis.id,
    version: 1,
    content: 'Synthetic conclusion',
    unresolvedQuestions: [],
    confidenceBasisPoints: null,
    createdAt: synthesis.createdAt,
    createdBy: actor.userId,
    sources: [itemSource('item-shared', { createdBy: actor.userId })],
  };
  const repository = new PrismaKnowledgeSynthesisRepository(
    emptyClient({
      knowledgeSynthesis: {
        findFirst: async () => synthesis,
        updateMany: async () => ({ count: 1 }),
      },
      knowledgeSynthesisVersion: {
        findUniqueOrThrow: async () => version,
        create: async () => version,
      },
      knowledgeItem: {
        findFirst: async () => {
          itemQueries += 1;
          return { id: 'item-shared' };
        },
      },
    }),
  );
  const accessContext = createSynthesisAccessContext();
  const owned = await repository.findOwned({
    actor,
    synthesisId: synthesis.id,
    accessContext,
  });
  assert.ok(owned);
  assert.equal(
    await repository.validateSources({
      actor,
      accessContext,
      sources: [
        { kind: 'item', sourceId: 'item-shared', relationType: 'primary' },
      ],
    }),
    true,
  );
  const appended = await repository.appendVersion({
    actor,
    synthesisId: synthesis.id,
    expectedVersion: 1,
    content: 'Synthetic conclusion version two',
    unresolvedQuestions: [],
    confidenceBasisPoints: null,
    sources: [
      { kind: 'item', sourceId: 'item-shared', relationType: 'primary' },
    ],
    accessContext,
  });
  assert.ok(appended);
  assert.equal(itemQueries, 1);
  assert.equal(accessContext.queries, 1);
});

test('provenance edge/query budget fails closed before unbounded database work', async () => {
  let itemQueries = 0;
  const repository = new PrismaKnowledgeSynthesisRepository(
    emptyClient({
      knowledgeSynthesisVersion: {
        findFirst: async ({ where }) => ({
          id: where.id,
          synthesisId: `synthesis-${where.id}`,
          version: 1,
          synthesis: { ownerUserId: 'owner-2' },
          sources: Array.from({ length: 513 }, (_, ordinal) =>
            itemSource(`item-${ordinal}`, { ordinal }),
          ),
        }),
      },
      knowledgeItem: {
        findFirst: async () => {
          itemQueries += 1;
          return { id: 'visible-item' };
        },
      },
    }),
  );
  await assert.rejects(
    () =>
      repository.validateSources({
        actor,
        accessContext: createSynthesisAccessContext(),
        sources: [
          {
            kind: 'synthesis_version',
            sourceId: 'v1',
            relationType: 'primary',
          },
        ],
      }),
    /knowledge_synthesis_access_budget_exceeded/,
  );
  assert.ok(itemQueries <= 511);
});

test('provenance version-node budget fails closed independently of edge depth', async () => {
  let versionQueries = 0;
  const repository = new PrismaKnowledgeSynthesisRepository(
    emptyClient({
      knowledgeSynthesisVersion: {
        findFirst: async ({ where }) => {
          versionQueries += 1;
          return {
            id: where.id,
            synthesisId: `synthesis-${where.id}`,
            version: 1,
            synthesis: {
              ownerUserId: where.id === 'root' ? 'owner-2' : actor.userId,
            },
            sources:
              where.id === 'root'
                ? Array.from({ length: 129 }, (_, ordinal) =>
                    versionSource(`leaf-${ordinal}`, { ordinal }),
                  )
                : [],
          };
        },
      },
    }),
  );
  await assert.rejects(
    () =>
      repository.validateSources({
        actor,
        accessContext: createSynthesisAccessContext(),
        sources: [
          {
            kind: 'synthesis_version',
            sourceId: 'root',
            relationType: 'primary',
          },
        ],
      }),
    /knowledge_synthesis_access_budget_exceeded/,
  );
  assert.equal(versionQueries, 128);
});

test('provenance query budget fails closed before the candidate scan limit', async () => {
  let scanned = 0;
  const repository = new PrismaKnowledgeSynthesisRepository(
    emptyClient({
      knowledgeSynthesis: {
        findMany: async ({ take }) =>
          Array.from({ length: take }, (_, index) =>
            synthesisRow(`hidden-query-${scanned + index}`),
          ),
        findFirst: async ({ where }) => {
          scanned += 1;
          return synthesisRow(where.id);
        },
      },
      knowledgeSynthesisVersion: {
        findUnique: async ({ where }) => {
          const synthesisId = where.synthesisId_version.synthesisId;
          return {
            id: `version-${synthesisId}`,
            synthesisId,
            version: 1,
            sources: [itemSource(`source-${synthesisId}`)],
          };
        },
      },
      knowledgeItem: { findFirst: async () => null },
    }),
  );
  const accessContext = createSynthesisAccessContext();
  await assert.rejects(
    () => repository.listVisible({ actor, limit: 1, accessContext }),
    /knowledge_synthesis_access_budget_exceeded/,
  );
  assert.ok(scanned < 200);
  assert.equal(accessContext.queries, 513);
  assert.ok(accessContext.edges < 512);
});

test('source-less organization synthesis fails closed for non-owner readers', async () => {
  const synthesis = synthesisRow('synthesis-source-less');
  const repository = new PrismaKnowledgeSynthesisRepository(
    emptyClient({
      knowledgeSynthesis: { findFirst: async () => synthesis },
      knowledgeSynthesisVersion: {
        findUnique: async () => ({
          id: 'version-source-less',
          synthesisId: synthesis.id,
          version: 1,
          sources: [],
        }),
      },
    }),
  );
  assert.equal(
    await repository.findVisible({
      actor,
      synthesisId: synthesis.id,
      accessContext: createSynthesisAccessContext(),
    }),
    null,
  );
});

test('synthesis list stops at a fixed hidden-candidate budget with a non-disclosing empty page', async () => {
  let candidateQueries = 0;
  let scanned = 0;
  const repository = new PrismaKnowledgeSynthesisRepository(
    emptyClient({
      knowledgeSynthesis: {
        findMany: async ({ take }) => {
          candidateQueries += 1;
          return Array.from({ length: take }, (_, index) =>
            synthesisRow(`hidden-${scanned + index}`),
          );
        },
        findFirst: async ({ where }) => {
          scanned += 1;
          return synthesisRow(where.id);
        },
      },
      knowledgeSynthesisVersion: {
        findUnique: async () => ({
          id: 'version-source-less',
          synthesisId: 'hidden',
          version: 1,
          sources: [],
        }),
      },
    }),
  );

  const page = await repository.listVisible({
    actor,
    limit: 1,
    accessContext: createSynthesisAccessContext(),
  });
  assert.deepEqual(page, { items: [], nextBoundary: null });
  assert.equal(scanned, 200);
  assert.equal(candidateQueries, 100);
});

test('synthesis list suppresses the cursor when the 200th candidate is visible lookahead', async () => {
  const candidates = Array.from({ length: 200 }, (_, index) =>
    synthesisRow(
      index < 100 || index === 199 ? `visible-${index}` : `hidden-${index}`,
      {
        ownerUserId: actor.userId,
        scope: 'personal',
        organizationId: null,
        updatedAt: new Date(Date.UTC(2026, 7, 6, 0, 0, 200 - index)),
      },
    ),
  );
  let offset = 0;
  const repository = new PrismaKnowledgeSynthesisRepository(
    emptyClient({
      knowledgeSynthesis: {
        findMany: async ({ take }) => {
          const page = candidates.slice(offset, offset + take);
          offset += page.length;
          return page;
        },
        findFirst: async ({ where }) =>
          where.id.startsWith('visible-')
            ? (candidates.find((candidate) => candidate.id === where.id) ??
              null)
            : null,
      },
      knowledgeSynthesisVersion: {
        findUnique: async ({ where }) => {
          const synthesisId = where.synthesisId_version.synthesisId;
          return {
            id: `version-${synthesisId}`,
            synthesisId,
            version: 1,
            sources: [],
          };
        },
      },
    }),
  );
  const page = await repository.listVisible({
    actor,
    limit: 100,
    accessContext: createSynthesisAccessContext(),
  });
  assert.equal(page.items.length, 100);
  assert.equal(page.nextBoundary, null);
  assert.equal(offset, 200);
});

test('synthesis list paginates visible-hidden-visible candidates without hidden boundaries, duplicates, or gaps', async () => {
  const timestamps = [
    '2026-08-06T04:00:00.000Z',
    '2026-08-06T03:00:00.000Z',
    '2026-08-06T02:00:00.000Z',
    '2026-08-06T01:00:00.000Z',
  ].map((value) => new Date(value));
  const candidates = [
    synthesisRow('visible-a', { updatedAt: timestamps[0] }),
    synthesisRow('hidden-between', { updatedAt: timestamps[1] }),
    synthesisRow('visible-b', { updatedAt: timestamps[2] }),
    synthesisRow('visible-c', { updatedAt: timestamps[3] }),
  ];
  const sourceFor = (id) =>
    itemSource(id.startsWith('visible') ? `source-${id}` : 'source-hidden');
  const repository = new PrismaKnowledgeSynthesisRepository(
    emptyClient({
      knowledgeSynthesis: {
        findMany: async ({ where, take }) => {
          const boundary = where.AND?.[1]?.OR;
          const beforeDate = boundary?.[0]?.updatedAt?.lt;
          const sameDate = boundary?.[1]?.updatedAt;
          const beforeId = boundary?.[1]?.id?.lt;
          return candidates
            .filter(
              (row) =>
                !beforeDate ||
                row.updatedAt < beforeDate ||
                (row.updatedAt.getTime() === sameDate?.getTime() &&
                  row.id < beforeId),
            )
            .slice(0, take);
        },
        findFirst: async ({ where }) =>
          candidates.find((row) => row.id === where.id) ?? null,
      },
      knowledgeSynthesisVersion: {
        findUnique: async ({ where }) => {
          const id = where.synthesisId_version.synthesisId;
          return {
            id: `version-${id}`,
            synthesisId: id,
            version: 1,
            sources: [sourceFor(id)],
          };
        },
      },
      knowledgeItem: {
        findFirst: async ({ where }) => {
          const serialized = JSON.stringify(where);
          return serialized.includes('source-visible')
            ? { id: 'visible-source' }
            : null;
        },
      },
    }),
  );
  const first = await repository.listVisible({
    actor,
    limit: 2,
    accessContext: createSynthesisAccessContext(),
  });
  assert.deepEqual(
    first.items.map((item) => item.id),
    ['visible-a', 'visible-b'],
  );
  assert.equal(first.nextBoundary?.id, 'visible-b');
  assert.notEqual(first.nextBoundary?.id, 'hidden-between');

  const second = await repository.listVisible({
    actor,
    limit: 2,
    boundary: first.nextBoundary,
    accessContext: createSynthesisAccessContext(),
  });
  assert.deepEqual(
    second.items.map((item) => item.id),
    ['visible-c'],
  );
  assert.equal(second.nextBoundary, null);
  assert.deepEqual(
    [...first.items, ...second.items].map((item) => item.id),
    ['visible-a', 'visible-b', 'visible-c'],
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
      accessContext: createSynthesisAccessContext(),
    }),
    null,
  );
});

test('organization synthesis history validates the lookahead row before emitting a cursor', async () => {
  const synthesis = synthesisRow('synthesis-lookahead', { currentVersion: 3 });
  const queriedItems = [];
  const visibleSource = itemSource('visible-item');
  const hiddenSource = itemSource('hidden-lookahead-item');
  const repository = new PrismaKnowledgeSynthesisRepository(
    emptyClient({
      knowledgeSynthesis: { findFirst: async () => synthesis },
      knowledgeSynthesisVersion: {
        findUnique: async () => ({
          id: 'version-3',
          synthesisId: synthesis.id,
          version: 3,
          sources: [visibleSource],
        }),
        findMany: async () => [
          {
            id: 'version-2',
            synthesisId: synthesis.id,
            version: 2,
            sources: [visibleSource],
          },
          {
            id: 'version-1',
            synthesisId: synthesis.id,
            version: 1,
            sources: [hiddenSource],
          },
        ],
      },
      knowledgeItem: {
        findFirst: async ({ where }) => {
          const serialized = JSON.stringify(where);
          queriedItems.push(serialized);
          return serialized.includes('visible-item')
            ? { id: 'visible-item' }
            : null;
        },
      },
    }),
  );

  assert.equal(
    await repository.listVersionsVisible({
      actor,
      synthesisId: synthesis.id,
      limit: 1,
      accessContext: createSynthesisAccessContext(),
    }),
    null,
  );
  assert.ok(
    queriedItems.some((query) => query.includes('hidden-lookahead-item')),
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
      source: 'agent',
      principalUserId: 'principal-1',
      actorUserId: 'agent-1',
      authScopes: [
        'knowledge:write',
        'https://idp.example/knowledge.write',
      ],
      authTokenId: 'token-1',
      authAudience: ['erp4-agent'],
      authExpiresAt: 1_900_000_000,
      agentRunId: 'agent-run-1',
      decisionRequestId: 'decision-request-1',
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
    _auth: {
      principalUserId: 'principal-1',
      actorUserId: 'agent-1',
      scopes: [
        'knowledge:write',
        'https://idp.example/knowledge.write',
      ],
      tokenId: 'token-1',
      audience: ['erp4-agent'],
      expiresAt: 1_900_000_000,
    },
    _request: { id: 'request-1', source: 'agent' },
    _agent: {
      runId: 'agent-run-1',
      decisionRequestId: 'decision-request-1',
    },
  });
  assert.equal(JSON.stringify(persisted).includes('must-not-pass'), false);
  assert.equal(persisted.data.targetTable, 'knowledge_annotations');

  await assert.rejects(
    () =>
      writer.write({
        action: 'knowledge_annotation_created',
        actor: {
          userId: 'owner-1',
          requestId: 'request-2',
          source: 'api',
        },
        targetTable: 'knowledge_annotations',
        targetId: 'annotation-2',
        metadata: {},
      }),
    /knowledge_provenance_audit_contract_invalid/,
  );

  const boundaryScopes = Array.from(
    { length: 100 },
    (_, index) => `scope:${index.toString().padStart(3, '0')}`,
  );
  let boundaryPersisted;
  const boundaryClient = emptyClient({
    auditLog: {
      create: async (args) => {
        boundaryPersisted = args;
        return args;
      },
    },
  });
  const boundaryWriter = new PrismaKnowledgeProvenanceAuditWriter(
    boundaryClient,
  );
  await boundaryWriter.write({
    action: 'knowledge_annotation_created',
    actor: {
      userId: 'owner-1',
      requestId: 'request-scope-boundary',
      source: 'agent',
      principalUserId: 'principal-1',
      actorUserId: 'agent-1',
      authScopes: [
        ' a'.padEnd(256, 'a'),
        'scope:duplicate',
        'scope:duplicate',
        ...boundaryScopes.slice(0, 97),
      ],
    },
    targetTable: 'knowledge_annotations',
    targetId: 'annotation-scope-boundary',
    metadata: {},
  });
  assert.ok(boundaryPersisted);
  assert.equal(boundaryPersisted.data.metadata._auth.scopes.length, 99);
  assert.equal(boundaryPersisted.data.metadata._auth.scopes[0].length, 255);
  assert.equal(
    boundaryPersisted.data.metadata._auth.scopes.filter(
      (scope) => scope === 'scope:duplicate',
    ).length,
    1,
  );

  for (const authScopes of [
    Array.from({ length: 101 }, (_, index) => `scope:${index}`),
    ['a'.repeat(256)],
    ['   '],
    ['scope\u0085control'],
    ['scope\u202econtrol'],
    ['https://idp.example/knowledge.write?token=synthetic'],
  ]) {
    await assert.rejects(
      () =>
        boundaryWriter.write({
          action: 'knowledge_annotation_created',
          actor: {
            userId: 'owner-1',
            requestId: 'request-invalid-scope-boundary',
            source: 'agent',
            principalUserId: 'principal-1',
            actorUserId: 'agent-1',
            authScopes,
          },
          targetTable: 'knowledge_annotations',
          targetId: 'annotation-invalid-scope-boundary',
          metadata: {},
        }),
      /knowledge_provenance_audit_contract_invalid/,
    );
  }

  await assert.rejects(
    () =>
      writer.write({
        action: 'knowledge_annotation_created',
        actor: {
          userId: 'owner-1',
          requestId: 'request-4',
          source: 'agent',
          principalUserId: 'principal-1',
          actorUserId: 'agent-1',
          authScopes: ['knowledge:write', 'scope\nwith-control'],
        },
        targetTable: 'knowledge_annotations',
        targetId: 'annotation-4',
        metadata: {},
      }),
    /knowledge_provenance_audit_contract_invalid/,
  );

  await assert.rejects(
    () =>
      writer.write({
        action: 'knowledge_annotation_created',
        actor: {
          userId: 'owner-1',
          requestId: 'request-3',
          source: 'agent',
          principalUserId: 'principal\nwith-control',
          actorUserId: 'agent-1',
        },
        targetTable: 'knowledge_annotations',
        targetId: 'annotation-3',
        metadata: {},
      }),
    /knowledge_provenance_audit_contract_invalid/,
  );

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
  let isolationLevel;
  const failing = new PrismaKnowledgeProvenanceUnitOfWork({
    $transaction: async (work, options) => {
      isolationLevel = options?.isolationLevel;
      return work(
        emptyClient({
          auditLog: {
            create: async () => {
              throw new Error('audit unavailable');
            },
          },
        }),
      );
    },
  });
  await assert.rejects(
    () =>
      failing.run(async ({ audit }) => {
        await audit.write({
          action: 'knowledge_conversation_created',
          actor: {
            userId: 'owner-1',
            requestId: 'request-transaction-failure',
            source: 'api',
            principalUserId: 'owner-1',
            actorUserId: 'owner-1',
          },
          targetTable: 'knowledge_conversations',
          targetId: 'conversation-1',
          metadata: { version: 1 },
        });
      }),
    /audit unavailable/,
  );
  assert.equal(isolationLevel, 'RepeatableRead');
});
