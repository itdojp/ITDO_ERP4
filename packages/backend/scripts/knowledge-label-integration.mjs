import assert from 'node:assert/strict';

const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (
  process.env.KNOWLEDGE_LABEL_INTEGRATION_CONFIRM !== '1' ||
  !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== '/erp4_knowledge_label_test'
) {
  throw new Error(
    'Refusing to run outside the confirmed loopback erp4_knowledge_label_test database',
  );
}

const [
  { Prisma },
  { prisma },
  {
    PrismaKnowledgeItemLabelRepository,
    PrismaKnowledgeLabelRepository,
    prismaKnowledgeLabelRepository,
    prismaKnowledgeLabelUnitOfWork,
  },
  { prismaKnowledgeItemRepository, prismaKnowledgeUnitOfWork },
  { createKnowledgeLabelService },
  { createKnowledgeItemService },
] = await Promise.all([
  import('@prisma/client'),
  import('../dist/services/db.js'),
  import('../dist/adapters/knowledge/prismaKnowledgeLabelAdapter.js'),
  import('../dist/adapters/knowledge/prismaKnowledgeItemAdapter.js'),
  import('../dist/application/knowledge/knowledgeLabelUseCases.js'),
  import('../dist/application/knowledge/knowledgeItemUseCases.js'),
]);

const labelService = createKnowledgeLabelService({
  reader: prismaKnowledgeLabelRepository,
  unitOfWork: prismaKnowledgeLabelUnitOfWork,
});
const itemService = createKnowledgeItemService({
  reader: prismaKnowledgeItemRepository,
  unitOfWork: prismaKnowledgeUnitOfWork,
});

const owner = {
  userId: 'integration-owner',
  organizationId: 'integration-org',
  groupAccountIds: [],
};
const useOnly = {
  userId: 'integration-user',
  organizationId: 'integration-org',
  groupAccountIds: [],
};
const outsider = {
  userId: 'integration-outsider',
  organizationId: 'other-org',
  groupAccountIds: [],
};
const auditActor = { requestId: 'knowledge-label-integration', source: 'api' };

function expectOk(result, context) {
  assert.equal(result.ok, true, `${context}: ${JSON.stringify(result)}`);
  return result.value;
}

function expectFailure(result, code, context) {
  assert.equal(result.ok, false, context);
  assert.equal(result.code, code, context);
}

async function createLabel(actor, body) {
  return expectOk(
    await labelService.create({ actor, auditActor, body }),
    `create ${body.slug}`,
  );
}

async function assertUnauthorizedRequestDoesNotWaitForRowLock({
  acquireLock,
  request,
  context,
}) {
  let announceLocked;
  let releaseLock;
  const locked = new Promise((resolve) => {
    announceLocked = resolve;
  });
  const released = new Promise((resolve) => {
    releaseLock = resolve;
  });
  const blocker = prisma.$transaction(async (transaction) => {
    await acquireLock(transaction);
    announceLocked();
    await released;
  });
  await locked;
  const requestPromise = request();
  let outcome;
  let timeout;
  try {
    outcome = await Promise.race([
      requestPromise.then((result) => ({ status: 'completed', result })),
      new Promise(
        (resolve) =>
          (timeout = setTimeout(() => resolve({ status: 'blocked' }), 1500)),
      ),
    ]);
  } finally {
    clearTimeout(timeout);
    releaseLock();
    await blocker;
  }
  const result = await requestPromise;
  assert.equal(
    outcome.status,
    'completed',
    `${context}: unauthorized request waited for an authorized row lock`,
  );
  return result;
}

try {
  const manageGroup = await prisma.groupAccount.create({
    data: { displayName: 'Knowledge integration manage', active: true },
  });
  const useGroup = await prisma.groupAccount.create({
    data: { displayName: 'Knowledge integration use', active: true },
  });
  owner.groupAccountIds = [manageGroup.id];
  useOnly.groupAccountIds = [useGroup.id];

  const personalRoot = await createLabel(owner, {
    scope: 'personal',
    displayName: 'Personal Root',
    slug: 'personal-root',
  });
  const personalChild = await createLabel(owner, {
    scope: 'personal',
    displayName: 'Personal Child',
    slug: 'personal-child',
    parentId: personalRoot.id,
  });
  const personalGrandchild = await createLabel(owner, {
    scope: 'personal',
    displayName: 'Personal Grandchild',
    slug: 'personal-grandchild',
    parentId: personalChild.id,
  });

  const initialPaths = await prisma.knowledgeLabelPath.findMany({
    where: { descendantId: personalGrandchild.id },
    orderBy: { depth: 'asc' },
  });
  assert.deepEqual(
    initialPaths.map((path) => [path.ancestorId, path.depth]),
    [
      [personalGrandchild.id, 0],
      [personalChild.id, 1],
      [personalRoot.id, 2],
    ],
  );

  const cycle = await labelService.update({
    actor: owner,
    auditActor,
    labelId: personalRoot.id,
    body: { expectedVersion: 1, parentId: personalGrandchild.id },
  });
  expectFailure(cycle, 'invalid_request', 'indirect cycle');
  assert.equal(
    (
      await prisma.knowledgeLabel.findUniqueOrThrow({
        where: { id: personalRoot.id },
      })
    ).parentId,
    null,
  );

  const reparented = expectOk(
    await labelService.update({
      actor: owner,
      auditActor,
      labelId: personalChild.id,
      body: { expectedVersion: 1, parentId: null },
    }),
    'reparent child to root',
  );
  assert.equal(reparented.version, 2);
  const reparentedPaths = await prisma.knowledgeLabelPath.findMany({
    where: { descendantId: personalGrandchild.id },
    orderBy: { depth: 'asc' },
  });
  assert.deepEqual(
    reparentedPaths.map((path) => [path.ancestorId, path.depth]),
    [
      [personalGrandchild.id, 0],
      [personalChild.id, 1],
    ],
  );

  let depthParent = personalGrandchild;
  for (let depth = 2; depth <= 8; depth += 1) {
    depthParent = await createLabel(owner, {
      scope: 'personal',
      displayName: `Depth ${depth}`,
      slug: `depth-${depth}`,
      parentId: depthParent.id,
    });
  }
  const tooDeep = await labelService.create({
    actor: owner,
    auditActor,
    body: {
      scope: 'personal',
      displayName: 'Depth 9',
      slug: 'depth-9',
      parentId: depthParent.id,
    },
  });
  expectFailure(tooDeep, 'invalid_request', 'depth nine');
  assert.equal(
    await prisma.knowledgeLabel.count({ where: { slug: 'depth-9' } }),
    0,
  );

  const concurrentNameResults = await Promise.all([
    labelService.create({
      actor: owner,
      auditActor,
      body: {
        scope: 'personal',
        displayName: 'Concurrent label A',
        slug: 'concurrent-label',
      },
    }),
    labelService.create({
      actor: owner,
      auditActor,
      body: {
        scope: 'personal',
        displayName: 'Concurrent label B',
        slug: 'concurrent-label',
      },
    }),
  ]);
  assert.equal(
    concurrentNameResults.filter((result) => result.ok).length,
    1,
    'exactly one concurrent canonical name claim succeeds',
  );
  assert.equal(
    concurrentNameResults.filter(
      (result) => !result.ok && result.code === 'label_conflict',
    ).length,
    1,
    'the conflicting name claim is normalized after transaction retry',
  );
  assert.equal(
    await prisma.knowledgeLabel.count({
      where: { ownerUserId: owner.userId, slug: 'concurrent-label' },
    }),
    1,
  );

  const concurrentParentA = await createLabel(owner, {
    scope: 'personal',
    displayName: 'Concurrent parent A',
    slug: 'concurrent-parent-a',
  });
  const concurrentParentB = await createLabel(owner, {
    scope: 'personal',
    displayName: 'Concurrent parent B',
    slug: 'concurrent-parent-b',
  });
  const concurrentReparentResults = await Promise.all([
    labelService.update({
      actor: owner,
      auditActor,
      labelId: concurrentParentA.id,
      body: { expectedVersion: 1, parentId: concurrentParentB.id },
    }),
    labelService.update({
      actor: owner,
      auditActor,
      labelId: concurrentParentB.id,
      body: { expectedVersion: 1, parentId: concurrentParentA.id },
    }),
  ]);
  assert.equal(
    concurrentReparentResults.filter((result) => result.ok).length,
    1,
    'exactly one opposite concurrent reparent succeeds',
  );
  assert.equal(
    concurrentReparentResults.filter(
      (result) => !result.ok && result.code === 'invalid_request',
    ).length,
    1,
    'the opposite reparent is rejected as a cycle after retry',
  );
  const concurrentParentRows = await prisma.knowledgeLabel.findMany({
    where: { id: { in: [concurrentParentA.id, concurrentParentB.id] } },
    select: { id: true, parentId: true },
  });
  assert.equal(
    concurrentParentRows.filter((row) => row.parentId !== null).length,
    1,
  );
  const concurrentPathRows = await prisma.knowledgeLabelPath.findMany({
    where: {
      ancestorId: { in: [concurrentParentA.id, concurrentParentB.id] },
      descendantId: { in: [concurrentParentA.id, concurrentParentB.id] },
    },
  });
  assert.equal(
    concurrentPathRows.filter(
      (path) => path.ancestorId === path.descendantId && path.depth === 0,
    ).length,
    2,
  );
  assert.equal(
    concurrentPathRows.filter(
      (path) => path.ancestorId !== path.descendantId && path.depth === 1,
    ).length,
    1,
  );

  const organizationLabel = await createLabel(owner, {
    scope: 'organization',
    displayName: 'Organization Label',
    slug: 'organization-label',
    groupGrants: [
      { groupAccountId: manageGroup.id, capability: 'manage' },
      { groupAccountId: useGroup.id, capability: 'use' },
    ],
  });
  expectOk(
    await labelService.detail({
      actor: useOnly,
      labelId: organizationLabel.id,
    }),
    'use grant detail',
  );
  expectFailure(
    await labelService.update({
      actor: useOnly,
      auditActor,
      labelId: organizationLabel.id,
      body: { expectedVersion: 1, displayName: 'Forbidden rename' },
    }),
    'not_found',
    'use grant cannot manage',
  );
  expectFailure(
    await labelService.detail({
      actor: outsider,
      labelId: organizationLabel.id,
    }),
    'not_found',
    'cross organization detail',
  );
  expectFailure(
    await labelService.detail({
      actor: { ...owner, userId: 'other-owner' },
      labelId: personalRoot.id,
    }),
    'not_found',
    'personal cross-owner detail',
  );

  const aliasResult = expectOk(
    await labelService.addAlias({
      actor: owner,
      auditActor,
      labelId: organizationLabel.id,
      expectedVersion: 1,
      alias: 'Org Label',
    }),
    'add alias',
  );
  assert.equal(aliasResult.labelVersion, 2);
  expectFailure(
    await labelService.addAlias({
      actor: owner,
      auditActor,
      labelId: organizationLabel.id,
      expectedVersion: 2,
      alias: 'Ｏｒｇ Ｌａｂｅｌ',
    }),
    'label_conflict',
    'duplicate normalized self alias',
  );
  expectFailure(
    await labelService.update({
      actor: owner,
      auditActor,
      labelId: organizationLabel.id,
      body: { expectedVersion: 2, displayName: 'Org Label' },
    }),
    'label_conflict',
    'canonical name conflicts with self alias',
  );
  assert.equal(
    (
      await prisma.knowledgeLabel.findUniqueOrThrow({
        where: { id: organizationLabel.id },
      })
    ).version,
    2,
  );

  const personalItem = expectOk(
    await itemService.create({
      actor: owner,
      auditActor,
      body: { scope: 'personal', sourceType: 'manual', title: 'Personal item' },
    }),
    'create personal item',
  );
  expectFailure(
    await assertUnauthorizedRequestDoesNotWaitForRowLock({
      acquireLock: (transaction) =>
        transaction.$queryRaw(Prisma.sql`
          SELECT "id"
          FROM "KnowledgeLabel"
          WHERE "id" = ${personalRoot.id}
          FOR UPDATE
        `),
      request: () =>
        labelService.update({
          actor: outsider,
          auditActor,
          labelId: personalRoot.id,
          body: { expectedVersion: 1, displayName: 'Must stay hidden' },
        }),
      context: 'hidden label lock oracle',
    }),
    'not_found',
    'hidden label lock oracle',
  );
  expectFailure(
    await assertUnauthorizedRequestDoesNotWaitForRowLock({
      acquireLock: (transaction) =>
        transaction.$queryRaw(Prisma.sql`
          SELECT "id"
          FROM "KnowledgeItem"
          WHERE "id" = ${personalItem.id}
          FOR UPDATE
        `),
      request: () =>
        labelService.attach({
          actor: outsider,
          auditActor,
          itemId: personalItem.id,
          body: { expectedVersion: 1, labelId: personalRoot.id },
        }),
      context: 'hidden item lock oracle',
    }),
    'not_found',
    'hidden item lock oracle',
  );
  const concurrentAttachResults = await Promise.all([
    labelService.attach({
      actor: owner,
      auditActor,
      itemId: personalItem.id,
      body: { expectedVersion: 1, labelId: personalRoot.id },
    }),
    labelService.attach({
      actor: owner,
      auditActor,
      itemId: personalItem.id,
      body: { expectedVersion: 1, labelId: personalRoot.id },
    }),
  ]);
  assert.equal(
    concurrentAttachResults.filter((result) => result.ok).length,
    1,
    'exactly one concurrent attach succeeds',
  );
  assert.equal(
    concurrentAttachResults.filter(
      (result) => !result.ok && result.code === 'version_conflict',
    ).length,
    1,
    'the stale concurrent attach is rejected',
  );
  const attached = expectOk(
    concurrentAttachResults.find((result) => result.ok),
    'attach personal label',
  );
  assert.equal(attached.itemVersion, 2);
  assert.equal(attached.assignment.labelId, personalRoot.id);

  const crossDomainAttach = await labelService.attach({
    actor: owner,
    auditActor,
    itemId: personalItem.id,
    body: { expectedVersion: 2, labelId: organizationLabel.id },
  });
  expectFailure(crossDomainAttach, 'not_found', 'cross-domain attach');
  assert.equal(
    (
      await prisma.knowledgeItem.findUniqueOrThrow({
        where: { id: personalItem.id },
      })
    ).version,
    2,
  );

  const concurrentDetachResults = await Promise.all([
    labelService.detach({
      actor: owner,
      auditActor,
      itemId: personalItem.id,
      labelId: personalRoot.id,
      expectedVersion: 2,
    }),
    labelService.detach({
      actor: owner,
      auditActor,
      itemId: personalItem.id,
      labelId: personalRoot.id,
      expectedVersion: 2,
    }),
  ]);
  assert.equal(
    concurrentDetachResults.filter((result) => result.ok).length,
    1,
    'exactly one concurrent detach succeeds',
  );
  assert.equal(
    concurrentDetachResults.filter(
      (result) => !result.ok && result.code === 'version_conflict',
    ).length,
    1,
    'the stale concurrent detach is rejected',
  );
  const detached = expectOk(
    concurrentDetachResults.find((result) => result.ok),
    'detach personal label',
  );
  assert.equal(detached.itemVersion, 3);
  assert.ok(detached.assignment.detachedAt instanceof Date);
  assert.equal(detached.assignment.detachedBy, owner.userId);
  const detachedRows = await prisma.knowledgeItemLabel.findMany({
    where: { knowledgeItemId: personalItem.id, labelId: personalRoot.id },
    orderBy: { createdAt: 'asc' },
  });
  assert.equal(detachedRows.length, 1);
  assert.equal(detachedRows[0].assignmentSource, 'manual');
  assert.equal(detachedRows[0].assignedBy, owner.userId);
  assert.ok(detachedRows[0].detachedAt instanceof Date);
  assert.equal(detachedRows[0].detachedBy, owner.userId);

  const reattached = expectOk(
    await labelService.attach({
      actor: owner,
      auditActor,
      itemId: personalItem.id,
      body: { expectedVersion: 3, labelId: personalRoot.id },
    }),
    'reattach personal label',
  );
  assert.equal(reattached.itemVersion, 4);
  assert.equal(reattached.assignment.detachedAt, null);
  assert.equal(reattached.assignment.detachedBy, null);
  const assignmentHistory = await prisma.knowledgeItemLabel.findMany({
    where: { knowledgeItemId: personalItem.id, labelId: personalRoot.id },
    orderBy: { createdAt: 'asc' },
  });
  assert.equal(assignmentHistory.length, 2);
  assert.equal(
    assignmentHistory.filter((row) => row.detachedAt === null).length,
    1,
  );
  assert.equal(
    assignmentHistory.filter((row) => row.detachedAt !== null).length,
    1,
  );
  assert.equal(assignmentHistory[0].assignmentSource, 'manual');
  assert.equal(assignmentHistory[0].assignedBy, owner.userId);
  await assert.rejects(
    () =>
      prisma.knowledgeItemLabel.create({
        data: {
          knowledgeItemId: personalItem.id,
          labelId: personalRoot.id,
          assignmentSource: 'manual',
          assignedBy: owner.userId,
          confidenceBasisPoints: null,
        },
      }),
    (error) => error?.code === 'P2002',
    'partial unique index rejects a second active assignment',
  );

  const organizationItem = expectOk(
    await itemService.create({
      actor: owner,
      auditActor,
      body: {
        scope: 'organization',
        sourceType: 'manual',
        title: 'Organization item',
        organizationGroupIds: [manageGroup.id],
      },
    }),
    'create organization item',
  );
  expectOk(
    await labelService.attach({
      actor: owner,
      auditActor,
      itemId: organizationItem.id,
      body: {
        expectedVersion: 1,
        labelId: organizationLabel.id,
        assignmentSource: 'ai_suggestion',
        confidenceBasisPoints: 7500,
      },
    }),
    'attach organization label',
  );

  const currentOrganizationVersion = (
    await prisma.knowledgeLabel.findUniqueOrThrow({
      where: { id: organizationLabel.id },
    })
  ).version;
  expectOk(
    await labelService.replaceGrants({
      actor: owner,
      auditActor,
      labelId: organizationLabel.id,
      expectedVersion: currentOrganizationVersion,
      groupGrants: [{ groupAccountId: manageGroup.id, capability: 'manage' }],
    }),
    'revoke use-only group',
  );
  expectFailure(
    await labelService.detail({
      actor: useOnly,
      labelId: organizationLabel.id,
    }),
    'not_found',
    'revoked detail',
  );

  const rollbackSlug = 'audit-rollback-label';
  const rollbackService = createKnowledgeLabelService({
    reader: prismaKnowledgeLabelRepository,
    unitOfWork: {
      run: (work) =>
        prisma.$transaction(
          (transaction) =>
            work({
              labels: new PrismaKnowledgeLabelRepository(transaction),
              itemLabels: new PrismaKnowledgeItemLabelRepository(transaction),
              audit: {
                write: async () => {
                  throw new Error('synthetic_audit_failure');
                },
              },
            }),
          { isolationLevel: 'Serializable' },
        ),
    },
  });
  await assert.rejects(
    () =>
      rollbackService.create({
        actor: owner,
        auditActor,
        body: {
          scope: 'personal',
          displayName: 'Audit rollback label',
          slug: rollbackSlug,
        },
      }),
    /synthetic_audit_failure/,
  );
  assert.equal(
    await prisma.knowledgeLabel.count({ where: { slug: rollbackSlug } }),
    0,
  );

  await assert.rejects(
    () =>
      prisma.knowledgeItemLabel.create({
        data: {
          knowledgeItemId: organizationItem.id,
          labelId: organizationLabel.id,
          assignmentSource: 'manual',
          assignedBy: owner.userId,
          confidenceBasisPoints: 1,
        },
      }),
    /constraint|check/i,
  );

  const labelIds = (
    await prisma.knowledgeLabel.findMany({ select: { id: true } })
  ).map((row) => row.id);
  const labelAudits = await prisma.auditLog.findMany({
    where: {
      action: {
        in: [
          'knowledge_label_created',
          'knowledge_label_updated',
          'knowledge_label_alias_added',
          'knowledge_label_grants_replaced',
          'knowledge_item_label_attached',
          'knowledge_item_label_detached',
        ],
      },
    },
  });
  const serializedAudits = JSON.stringify(labelAudits);
  for (const labelId of labelIds) {
    assert.equal(
      serializedAudits.includes(labelId),
      false,
      'raw label id audit',
    );
  }
  assert.ok(
    labelAudits
      .filter((entry) => entry.targetTable === 'knowledge_labels')
      .every((entry) => entry.targetId === 'label_master'),
  );

  console.log(
    JSON.stringify({
      result: 'PASS',
      labels: await prisma.knowledgeLabel.count(),
      paths: await prisma.knowledgeLabelPath.count(),
      assignments: await prisma.knowledgeItemLabel.count(),
      activeAssignments: await prisma.knowledgeItemLabel.count({
        where: { detachedAt: null },
      }),
      detachedAssignments: await prisma.knowledgeItemLabel.count({
        where: { detachedAt: { not: null } },
      }),
      labelAudits: labelAudits.length,
      maxDepth: Math.max(
        ...(
          await prisma.knowledgeLabelPath.findMany({
            select: { depth: true },
          })
        ).map((path) => path.depth),
      ),
    }),
  );
} finally {
  await prisma.$disconnect();
}
