import assert from 'node:assert/strict';

function parseDatabaseUrl(value) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

const databaseUrl = parseDatabaseUrl(process.env.DATABASE_URL);
if (
  process.env.KNOWLEDGE_SEARCH_INTEGRATION_CONFIRM !== '1' ||
  !databaseUrl ||
  !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== '/erp4_knowledge_search_test'
) {
  throw new Error(
    'Refusing to run outside the confirmed loopback erp4_knowledge_search_test database',
  );
}

const [
  { Prisma },
  { prisma },
  { PrismaKnowledgeSearchRepository },
  { PrismaKnowledgeSavedViewRepository, PrismaKnowledgeSavedViewUnitOfWork },
  { createKnowledgeCursorCodec },
  { createKnowledgeSearchService },
  { createKnowledgeSavedViewService },
] = await Promise.all([
  import('@prisma/client'),
  import('../dist/services/db.js'),
  import('../dist/adapters/knowledge/prismaKnowledgeSearchAdapter.js'),
  import('../dist/adapters/knowledge/prismaKnowledgeSavedViewAdapter.js'),
  import('../dist/application/knowledge/knowledgeCursor.js'),
  import('../dist/application/knowledge/knowledgeSearchUseCases.js'),
  import('../dist/application/knowledge/knowledgeSavedViewUseCases.js'),
]);

const searchRepository = new PrismaKnowledgeSearchRepository(prisma);
const search = createKnowledgeSearchService({
  repository: searchRepository,
  cursorCodec: createKnowledgeCursorCodec({
    NODE_ENV: 'test',
    KNOWLEDGE_CURSOR_SIGNING_SECRET:
      'knowledge-search-integration-secret-32-bytes-minimum',
  }),
});
const savedViews = createKnowledgeSavedViewService({
  repository: new PrismaKnowledgeSavedViewRepository(prisma),
  unitOfWork: new PrismaKnowledgeSavedViewUnitOfWork(prisma),
  search,
});

const actor = {
  userId: 'integration-owner',
  organizationId: 'integration-org',
  groupAccountIds: ['integration-group'],
};
const auditActor = {
  requestId: 'knowledge-search-integration',
  source: 'api',
};
const fixedTime = new Date('2026-08-05T03:00:00.000Z');

function expectOk(result, context) {
  assert.equal(result.ok, true, `${context}: ${JSON.stringify(result)}`);
  return result.value;
}

function expectFailure(result, code, context) {
  assert.equal(result.ok, false, context);
  assert.equal(result.code, code, context);
}

async function seed() {
  await prisma.groupAccount.create({
    data: {
      id: 'integration-group',
      displayName: 'Synthetic integration group',
      active: true,
    },
  });
  await prisma.knowledgeLabel.createMany({
    data: [
      {
        id: 'label-architecture',
        scope: 'personal',
        ownerUserId: actor.userId,
        displayName: 'Architecture',
        slug: 'architecture',
        updatedAt: fixedTime,
      },
      {
        id: 'label-backend',
        scope: 'personal',
        ownerUserId: actor.userId,
        displayName: 'Backend Architecture',
        slug: 'backend-architecture',
        parentId: 'label-architecture',
        updatedAt: fixedTime,
      },
      {
        id: 'label-topic',
        scope: 'personal',
        ownerUserId: actor.userId,
        displayName: 'Topic',
        slug: 'topic',
        updatedAt: fixedTime,
      },
      {
        id: 'label-excluded',
        scope: 'personal',
        ownerUserId: actor.userId,
        displayName: 'Excluded',
        slug: 'excluded',
        updatedAt: fixedTime,
      },
      {
        id: 'label-hidden-architecture',
        scope: 'personal',
        ownerUserId: 'hidden-owner',
        displayName: 'Architecture private',
        slug: 'architecture-private',
        updatedAt: fixedTime,
      },
      {
        id: 'label-operations',
        scope: 'organization',
        ownerUserId: actor.userId,
        organizationId: actor.organizationId,
        displayName: 'Operations',
        slug: 'operations',
        updatedAt: fixedTime,
      },
    ],
  });
  await prisma.knowledgeLabelPath.createMany({
    data: [
      ['label-architecture', 'label-architecture', 0],
      ['label-architecture', 'label-backend', 1],
      ['label-backend', 'label-backend', 0],
      ['label-topic', 'label-topic', 0],
      ['label-excluded', 'label-excluded', 0],
      ['label-hidden-architecture', 'label-hidden-architecture', 0],
      ['label-operations', 'label-operations', 0],
    ].map(([ancestorId, descendantId, depth], index) => ({
      id: `path-${index}`,
      ancestorId,
      descendantId,
      depth,
      createdBy: actor.userId,
    })),
  });
  await prisma.knowledgeLabelAlias.create({
    data: {
      id: 'alias-arch',
      labelId: 'label-architecture',
      alias: 'Arch',
      normalizedAlias: 'arch',
      updatedAt: fixedTime,
    },
  });
  await prisma.knowledgeLabelGroupGrant.create({
    data: {
      id: 'grant-operations',
      labelId: 'label-operations',
      groupAccountId: 'integration-group',
      capability: 'use',
      active: true,
      updatedAt: fixedTime,
    },
  });

  await prisma.knowledgeItem.createMany({
    data: [
      ['item-1', actor.userId, 'personal', null, 'First'],
      ['item-2', actor.userId, 'personal', null, 'Second'],
      ['item-3', actor.userId, 'personal', null, 'Third'],
      ['item-hidden', 'hidden-owner', 'personal', null, 'Hidden'],
      [
        'item-organization',
        'organization-owner',
        'organization',
        actor.organizationId,
        'Organization',
      ],
    ].map(([id, ownerUserId, scope, organizationId, title]) => ({
      id,
      ownerUserId,
      scope,
      organizationId,
      sourceType: 'web',
      title,
      capturedAt: fixedTime,
      status: 'inbox',
      updatedAt: fixedTime,
    })),
  });
  await prisma.knowledgeItemGroupGrant.create({
    data: {
      id: 'item-org-grant',
      knowledgeItemId: 'item-organization',
      groupAccountId: 'integration-group',
    },
  });
  await prisma.knowledgeItemLabel.createMany({
    data: [
      ['assignment-1', 'item-1', 'label-backend', null],
      ['assignment-2', 'item-1', 'label-topic', null],
      ['assignment-3', 'item-2', 'label-architecture', null],
      ['assignment-4', 'item-3', 'label-backend', null],
      ['assignment-5', 'item-3', 'label-topic', null],
      ['assignment-6', 'item-3', 'label-excluded', fixedTime],
      ['assignment-hidden', 'item-hidden', 'label-hidden-architecture', null],
      [
        'assignment-organization',
        'item-organization',
        'label-operations',
        null,
      ],
    ].map(([id, knowledgeItemId, labelId, detachedAt]) => ({
      id,
      knowledgeItemId,
      labelId,
      assignmentSource: 'manual',
      assignedBy: actor.userId,
      detachedAt,
      detachedBy: detachedAt ? actor.userId : null,
      updatedAt: fixedTime,
    })),
  });

  const perfItems = Array.from({ length: 300 }, (_, index) => ({
    id: `perf-${String(index).padStart(4, '0')}`,
    ownerUserId: actor.userId,
    scope: 'personal',
    sourceType: 'manual',
    title: `Synthetic ${index}`,
    capturedAt: new Date(fixedTime.getTime() - index * 1000),
    status: index % 2 === 0 ? 'inbox' : 'processed',
    updatedAt: new Date(fixedTime.getTime() - index * 1000),
  }));
  await prisma.knowledgeItem.createMany({ data: perfItems });
  await prisma.knowledgeItemLabel.createMany({
    data: perfItems.map((item, index) => ({
      id: `perf-assignment-${index}`,
      knowledgeItemId: item.id,
      labelId: 'label-topic',
      assignmentSource: 'manual',
      assignedBy: actor.userId,
      updatedAt: item.updatedAt,
    })),
  });
}

async function verifySearch() {
  const any = expectOk(
    await search.search({
      actor,
      body: {
        labels: {
          any: [{ reference: 'Arch', includeDescendants: true }],
        },
        sourceType: 'web',
        facets: ['label', 'status'],
        limit: 10,
      },
    }),
    'ANY descendant search',
  );
  assert.deepEqual(
    any.items.map((item) => item.id),
    ['item-3', 'item-2', 'item-1'],
  );
  assert.equal(any.total, 3);
  assert.ok(any.facets.label.every((bucket) => !bucket.id.includes('hidden')));
  assert.ok(
    any.facets.label.every((bucket) => bucket.id !== 'label-excluded'),
    'detached assignment must not contribute to facets',
  );

  const all = expectOk(
    await search.search({
      actor,
      body: {
        labels: {
          all: [
            { reference: 'Architecture', includeDescendants: true },
            { reference: 'Topic' },
          ],
          not: [{ reference: 'Excluded' }],
        },
        sourceType: 'web',
        limit: 10,
      },
    }),
    'ALL root sets and NOT search',
  );
  assert.deepEqual(
    all.items.map((item) => item.id),
    ['item-3', 'item-1'],
    'ALL requires one assignment from each root set; detached NOT is ignored',
  );

  const pages = [];
  let cursor;
  do {
    const page = expectOk(
      await search.search({
        actor,
        body: {
          labels: {
            any: [{ reference: 'Architecture', includeDescendants: true }],
          },
          sourceType: 'web',
          limit: 1,
          cursor,
        },
      }),
      'equal timestamp page',
    );
    pages.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.deepEqual(pages, ['item-3', 'item-2', 'item-1']);
  assert.equal(new Set(pages).size, pages.length);

  const suggestions = expectOk(
    await search.suggest({ actor, query: 'arch', limit: 10 }),
    'suggestions',
  );
  assert.deepEqual(
    suggestions.map((suggestion) => suggestion.id),
    ['label-backend', 'label-architecture'],
  );
  assert.deepEqual(
    suggestions.map((suggestion) => suggestion.usageCount),
    [2, 1],
  );
}

async function verifySavedViews() {
  const created = expectOk(
    await savedViews.create({
      actor,
      auditActor,
      name: 'Operations current view',
      filter: {
        labels: { any: [{ reference: 'Operations' }] },
        scope: 'organization',
      },
    }),
    'create saved view',
  );
  const beforeRevoke = expectOk(
    await savedViews.execute({
      actor,
      savedViewId: created.id,
      limit: 10,
    }),
    'execute saved view before revoke',
  );
  assert.equal(beforeRevoke.total, 1);

  await prisma.knowledgeLabelGroupGrant.update({
    where: { id: 'grant-operations' },
    data: { active: false },
  });
  expectFailure(
    await savedViews.execute({
      actor,
      savedViewId: created.id,
      limit: 10,
    }),
    'invalid_saved_view',
    'execute after current ACL revoke',
  );
  expectFailure(
    await savedViews.detail({ actor, savedViewId: created.id }),
    'invalid_saved_view',
    'detail after current ACL revoke',
  );
  expectFailure(
    await savedViews.list({ actor, query: { limit: 20, offset: 0 } }),
    'invalid_saved_view',
    'list after current ACL revoke',
  );
  const recovery = expectOk(
    await savedViews.listRecoveryMetadata({
      actor,
      query: { limit: 20, offset: 0 },
    }),
    'list recovery metadata after current ACL revoke',
  );
  assert.deepEqual(
    recovery.map(({ id, version }) => ({ id, version })),
    [{ id: created.id, version: created.version }],
  );
  assert.equal('filter' in recovery[0], false);
  expectOk(
    await savedViews.remove({
      actor,
      auditActor,
      savedViewId: created.id,
      expectedVersion: created.version,
    }),
    'owner can delete stale view',
  );

  const audits = await prisma.auditLog.findMany({
    where: { targetTable: 'knowledge_saved_views' },
    orderBy: { createdAt: 'asc' },
  });
  assert.equal(audits.length, 2);
  for (const audit of audits) {
    assert.equal(audit.targetId, 'saved_view');
    const serialized = JSON.stringify(audit.metadata);
    assert.doesNotMatch(serialized, /Operations|label-|filter/i);
  }
}

async function verifyPlans() {
  await prisma.$executeRaw`SET enable_seqscan = off`;
  const itemPlan = await prisma.$queryRaw(Prisma.sql`
    EXPLAIN (FORMAT JSON)
    SELECT item."id"
    FROM "KnowledgeItem" AS item
    WHERE item."ownerUserId" = ${actor.userId}
      AND item."deletedAt" IS NULL
    ORDER BY item."updatedAt" DESC, item."id" DESC
    LIMIT 50
  `);
  assert.match(
    JSON.stringify(itemPlan),
    /KnowledgeItem_ownerUserId_deletedAt_updatedAt_id_idx/,
  );
  const assignmentPlan = await prisma.$queryRaw(Prisma.sql`
    EXPLAIN (FORMAT JSON)
    SELECT assignment."knowledgeItemId"
    FROM "KnowledgeItemLabel" AS assignment
    WHERE assignment."labelId" = ${'label-topic'}
      AND assignment."detachedAt" IS NULL
  `);
  assert.match(
    JSON.stringify(assignmentPlan),
    /KnowledgeItemLabel_active_labelId_knowledgeItemId_idx/,
  );
  await prisma.$executeRaw`RESET enable_seqscan`;
}

try {
  await seed();
  await verifySearch();
  await verifySavedViews();
  await verifyPlans();
  const [items, assignments, views, audits] = await Promise.all([
    prisma.knowledgeItem.count(),
    prisma.knowledgeItemLabel.count(),
    prisma.knowledgeSavedView.count(),
    prisma.auditLog.count({ where: { targetTable: 'knowledge_saved_views' } }),
  ]);
  console.log(
    JSON.stringify({
      result: 'PASS',
      items,
      assignments,
      views,
      audits,
      equalTimestampPages: 3,
      planIndexes: 2,
    }),
  );
} finally {
  await prisma.$disconnect();
}
