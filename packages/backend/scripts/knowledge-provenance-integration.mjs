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
  process.env.KNOWLEDGE_PROVENANCE_INTEGRATION_CONFIRM !== '1' ||
  !databaseUrl ||
  !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== '/erp4_knowledge_provenance_test'
) {
  throw new Error(
    'Refusing to run outside the confirmed loopback erp4_knowledge_provenance_test database',
  );
}

const [
  { prisma },
  { createKnowledgeItemService },
  { prismaKnowledgeItemRepository, prismaKnowledgeUnitOfWork },
  { createKnowledgeAnnotationService },
  { createKnowledgeConversationService },
  { createKnowledgeSynthesisService },
  { createSynthesisAccessContext },
  provenanceAdapter,
] = await Promise.all([
  import('../dist/services/db.js'),
  import('../dist/application/knowledge/knowledgeItemUseCases.js'),
  import('../dist/adapters/knowledge/prismaKnowledgeItemAdapter.js'),
  import('../dist/application/knowledge/knowledgeAnnotationUseCases.js'),
  import('../dist/application/knowledge/knowledgeConversationUseCases.js'),
  import('../dist/application/knowledge/knowledgeSynthesisUseCases.js'),
  import('../dist/application/knowledge/knowledgeSynthesisAccessContext.js'),
  import('../dist/adapters/knowledge/prismaKnowledgeProvenanceAdapter.js'),
]);

const itemService = createKnowledgeItemService({
  reader: prismaKnowledgeItemRepository,
  unitOfWork: prismaKnowledgeUnitOfWork,
  now: () => new Date('2026-08-06T00:00:00.000Z'),
});
const annotationService = createKnowledgeAnnotationService({
  reader: provenanceAdapter.prismaKnowledgeAnnotationRepository,
  unitOfWork: provenanceAdapter.prismaKnowledgeProvenanceUnitOfWork,
  now: () => new Date('2026-08-06T00:10:00.000Z'),
});
const conversationService = createKnowledgeConversationService({
  reader: provenanceAdapter.prismaKnowledgeConversationRepository,
  unitOfWork: provenanceAdapter.prismaKnowledgeProvenanceUnitOfWork,
  now: () => new Date('2026-08-06T00:20:00.000Z'),
});
const synthesisService = createKnowledgeSynthesisService({
  reader: provenanceAdapter.prismaKnowledgeSynthesisRepository,
  unitOfWork: provenanceAdapter.prismaKnowledgeProvenanceUnitOfWork,
});

function interleavingTransactionHost(delegateName, methodName, afterRead) {
  return {
    $transaction: (work, options) =>
      prisma.$transaction(async (client) => {
        const proxiedClient = new Proxy(client, {
          get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (property !== delegateName) {
              return typeof value === 'function' ? value.bind(target) : value;
            }
            return new Proxy(value, {
              get(delegate, method, delegateReceiver) {
                const operation = Reflect.get(
                  delegate,
                  method,
                  delegateReceiver,
                );
                if (method !== methodName) {
                  return typeof operation === 'function'
                    ? operation.bind(delegate)
                    : operation;
                }
                return async (input) => {
                  const result = await operation.call(delegate, input);
                  await afterRead();
                  return result;
                };
              },
            });
          },
        });
        return work(proxiedClient);
      }, options),
  };
}

const auditActor = {
  requestId: 'knowledge-provenance-integration',
  source: 'api',
  principalUserId: 'knowledge-provenance-integration-user',
  actorUserId: 'knowledge-provenance-integration-user',
  authScopes: ['knowledge:write'],
};

function expectOk(result, context) {
  assert.equal(result.ok, true, `${context}: ${JSON.stringify(result)}`);
  return result.value;
}

function expectFailure(result, code, context) {
  assert.equal(result.ok, false, context);
  assert.equal(result.code, code, context);
}

async function createItem(actor, body) {
  return expectOk(
    await itemService.create({ actor, auditActor, body }),
    `create item ${body.title}`,
  );
}

try {
  const groupA = await prisma.groupAccount.create({
    data: { displayName: 'Knowledge provenance group A', active: true },
  });
  const groupB = await prisma.groupAccount.create({
    data: { displayName: 'Knowledge provenance group B', active: true },
  });
  const interleaveGroup = await prisma.groupAccount.create({
    data: {
      displayName: 'Knowledge provenance ACL interleave group',
      active: true,
    },
  });
  const owner = {
    userId: 'integration-owner',
    organizationId: 'integration-org',
    groupAccountIds: [groupA.id, groupB.id, interleaveGroup.id],
  };
  const bothGroups = {
    userId: 'integration-both-groups',
    organizationId: 'integration-org',
    groupAccountIds: [groupA.id, groupB.id],
  };
  const groupAOnly = {
    userId: 'integration-group-a-only',
    organizationId: 'integration-org',
    groupAccountIds: [groupA.id],
  };
  const outsider = {
    userId: 'integration-outsider',
    organizationId: 'other-org',
    groupAccountIds: [],
  };
  const interleaveReader = {
    userId: 'integration-acl-interleave-reader',
    organizationId: 'integration-org',
    groupAccountIds: [interleaveGroup.id],
  };

  const personalItem = await createItem(owner, {
    scope: 'personal',
    sourceType: 'manual',
    title: 'Synthetic personal source',
  });
  const orgItemA = await createItem(owner, {
    scope: 'organization',
    organizationGroupIds: [groupA.id, groupB.id],
    sourceType: 'manual',
    title: 'Synthetic organization source A',
  });
  const orgItemB = await createItem(owner, {
    scope: 'organization',
    organizationGroupIds: [groupB.id],
    sourceType: 'manual',
    title: 'Synthetic organization source B',
  });
  const aclSwapItemA = await createItem(owner, {
    scope: 'organization',
    organizationGroupIds: [groupA.id],
    sourceType: 'manual',
    title: 'Synthetic ACL snapshot source A',
  });
  const aclSwapItemB = await createItem(owner, {
    scope: 'organization',
    organizationGroupIds: [groupB.id],
    sourceType: 'manual',
    title: 'Synthetic ACL snapshot source B',
  });
  const annotationInterleaveItem = await createItem(owner, {
    scope: 'organization',
    organizationGroupIds: [interleaveGroup.id],
    sourceType: 'manual',
    title: 'Synthetic annotation ACL interleave source',
  });
  const conversationInterleaveItem = await createItem(owner, {
    scope: 'organization',
    organizationGroupIds: [interleaveGroup.id],
    sourceType: 'manual',
    title: 'Synthetic conversation ACL interleave source',
  });
  await prisma.knowledgeItemGroupGrant.delete({
    where: {
      knowledgeItemId_groupAccountId: {
        knowledgeItemId: aclSwapItemB.id,
        groupAccountId: groupB.id,
      },
    },
  });

  let firstAclReadComplete;
  const firstAclRead = new Promise((resolve) => {
    firstAclReadComplete = resolve;
  });
  let releaseAclRead;
  const aclSwapCommitted = new Promise((resolve) => {
    releaseAclRead = resolve;
  });
  const consistentAclRead = prisma.$transaction(
    async (client) => {
      const repository =
        new provenanceAdapter.PrismaKnowledgeSynthesisRepository(client);
      const contextA = createSynthesisAccessContext();
      const sourceAVisible = await repository.validateSources({
        actor: bothGroups,
        accessContext: contextA,
        sources: [
          {
            kind: 'item',
            sourceId: aclSwapItemA.id,
            relationType: 'primary',
          },
        ],
      });
      firstAclReadComplete();
      await aclSwapCommitted;
      const sourceBVisible = await repository.validateSources({
        actor: bothGroups,
        accessContext: contextA,
        sources: [
          {
            kind: 'item',
            sourceId: aclSwapItemB.id,
            relationType: 'supporting',
          },
        ],
      });
      return { sourceAVisible, sourceBVisible };
    },
    { isolationLevel: 'RepeatableRead' },
  );
  await firstAclRead;
  try {
    await prisma.$transaction([
      prisma.knowledgeItemGroupGrant.delete({
        where: {
          knowledgeItemId_groupAccountId: {
            knowledgeItemId: aclSwapItemA.id,
            groupAccountId: groupA.id,
          },
        },
      }),
      prisma.knowledgeItemGroupGrant.create({
        data: {
          knowledgeItemId: aclSwapItemB.id,
          groupAccountId: groupB.id,
          createdBy: owner.userId,
        },
      }),
    ]);
  } finally {
    releaseAclRead();
  }
  assert.deepEqual(await consistentAclRead, {
    sourceAVisible: true,
    sourceBVisible: false,
  });
  assert.equal(
    await provenanceAdapter.prismaKnowledgeSynthesisRepository.withConsistentSnapshot(
      (repository) =>
        repository.validateSources({
          actor: bothGroups,
          accessContext: createSynthesisAccessContext(),
          sources: [
            {
              kind: 'item',
              sourceId: aclSwapItemB.id,
              relationType: 'primary',
            },
          ],
        }),
    ),
    true,
  );
  const otherOwnerItem = await createItem(
    {
      userId: 'integration-other-owner',
      groupAccountIds: [],
    },
    {
      scope: 'personal',
      sourceType: 'manual',
      title: 'Synthetic cross-owner source',
    },
  );

  const createdAnnotation = expectOk(
    await annotationService.create({
      actor: owner,
      auditActor,
      itemId: personalItem.id,
      body: {
        kind: 'note',
        origin: 'user',
        content: 'Synthetic personal annotation',
      },
    }),
    'create annotation',
  );
  expectFailure(
    await annotationService.detail({
      actor: outsider,
      itemId: personalItem.id,
      annotationId: createdAnnotation.id,
    }),
    'not_found',
    'personal annotation outsider',
  );
  const revisedAnnotation = expectOk(
    await annotationService.revise({
      actor: owner,
      auditActor,
      itemId: personalItem.id,
      annotationId: createdAnnotation.id,
      body: {
        expectedRevision: 1,
        kind: 'question',
        origin: 'user',
        content: 'Synthetic revised question',
      },
    }),
    'revise annotation',
  );
  assert.equal(revisedAnnotation.currentRevision, 2);
  const history = expectOk(
    await annotationService.history({
      actor: owner,
      itemId: personalItem.id,
      annotationId: createdAnnotation.id,
      limit: 20,
    }),
    'annotation history',
  );
  assert.deepEqual(
    history.items.map((entry) => [entry.revision, entry.content]),
    [
      [2, 'Synthetic revised question'],
      [1, 'Synthetic personal annotation'],
    ],
  );
  const revisionThree = expectOk(
    await annotationService.revise({
      actor: owner,
      auditActor,
      itemId: personalItem.id,
      annotationId: createdAnnotation.id,
      body: {
        expectedRevision: 2,
        kind: 'hypothesis',
        origin: 'user',
        content: 'Synthetic revision three',
      },
    }),
    'annotation revision three',
  );
  expectOk(
    await annotationService.revise({
      actor: owner,
      auditActor,
      itemId: personalItem.id,
      annotationId: createdAnnotation.id,
      body: {
        expectedRevision: revisionThree.currentRevision,
        kind: 'todo',
        origin: 'user',
        content: 'Synthetic revision four',
      },
    }),
    'annotation revision four',
  );
  const annotationPageOne = expectOk(
    await annotationService.history({
      actor: owner,
      itemId: personalItem.id,
      annotationId: createdAnnotation.id,
      limit: 2,
    }),
    'annotation history page one',
  );
  assert.deepEqual(
    annotationPageOne.items.map((entry) => entry.revision),
    [4, 3],
  );
  assert.equal(annotationPageOne.nextBoundary?.sequence, 3);
  const annotationPageTwo = expectOk(
    await annotationService.history({
      actor: owner,
      itemId: personalItem.id,
      annotationId: createdAnnotation.id,
      limit: 2,
      beforeRevision: annotationPageOne.nextBoundary.sequence,
    }),
    'annotation history page two',
  );
  assert.deepEqual(
    annotationPageTwo.items.map((entry) => entry.revision),
    [2, 1],
  );
  assert.equal(annotationPageTwo.nextBoundary, null);

  const deletedParentItem = await createItem(owner, {
    scope: 'personal',
    sourceType: 'manual',
    title: 'Synthetic deleted annotation parent',
  });
  const deletedParentAnnotation = expectOk(
    await annotationService.create({
      actor: owner,
      auditActor,
      itemId: deletedParentItem.id,
      body: {
        kind: 'note',
        origin: 'user',
        content: 'Synthetic deleted parent annotation',
      },
    }),
    'create deleted-parent annotation',
  );
  expectOk(
    await itemService.remove({
      actor: owner,
      auditActor,
      itemId: deletedParentItem.id,
      expectedVersion: deletedParentItem.version,
      reasonCode: 'owner_request',
    }),
    'delete annotation parent item',
  );
  expectFailure(
    await annotationService.history({
      actor: owner,
      itemId: deletedParentItem.id,
      annotationId: deletedParentAnnotation.id,
      limit: 20,
    }),
    'not_found',
    'deleted parent annotation history',
  );
  expectFailure(
    await annotationService.revise({
      actor: owner,
      auditActor,
      itemId: deletedParentItem.id,
      annotationId: deletedParentAnnotation.id,
      body: {
        expectedRevision: 1,
        kind: 'question',
        origin: 'user',
        content: 'Must not be persisted',
      },
    }),
    'not_found',
    'deleted parent annotation mutation',
  );

  const orgAnnotation = expectOk(
    await annotationService.create({
      actor: owner,
      auditActor,
      itemId: orgItemA.id,
      body: { kind: 'quote', origin: 'external', content: 'Synthetic quote' },
    }),
    'create organization annotation',
  );
  assert.equal(
    (
      await annotationService.detail({
        actor: bothGroups,
        itemId: orgItemA.id,
        annotationId: orgAnnotation.id,
      })
    ).ok,
    true,
  );
  expectFailure(
    await annotationService.detail({
      actor: outsider,
      itemId: orgItemA.id,
      annotationId: orgAnnotation.id,
    }),
    'not_found',
    'organization annotation outsider',
  );

  const annotationInterleave = expectOk(
    await annotationService.create({
      actor: owner,
      auditActor,
      itemId: annotationInterleaveItem.id,
      body: {
        kind: 'note',
        origin: 'user',
        content: 'Synthetic annotation before ACL revocation',
      },
    }),
    'create annotation ACL interleave fixture',
  );
  let annotationFirstReadComplete;
  const annotationFirstRead = new Promise((resolve) => {
    annotationFirstReadComplete = resolve;
  });
  let releaseAnnotationRead;
  const annotationAclChanged = new Promise((resolve) => {
    releaseAnnotationRead = resolve;
  });
  const annotationInterleaveRepository =
    new provenanceAdapter.PrismaKnowledgeAnnotationRepository(
      interleavingTransactionHost(
        'knowledgeAnnotation',
        'findFirst',
        async () => {
          annotationFirstReadComplete();
          await annotationAclChanged;
        },
      ),
    );
  const annotationInterleaveService = createKnowledgeAnnotationService({
    reader: annotationInterleaveRepository,
    unitOfWork: provenanceAdapter.prismaKnowledgeProvenanceUnitOfWork,
  });
  const interleavedAnnotationHistoryPromise =
    annotationInterleaveService.history({
      actor: interleaveReader,
      itemId: annotationInterleaveItem.id,
      annotationId: annotationInterleave.id,
      limit: 20,
    });
  await annotationFirstRead;
  try {
    await prisma.knowledgeItemGroupGrant.delete({
      where: {
        knowledgeItemId_groupAccountId: {
          knowledgeItemId: annotationInterleaveItem.id,
          groupAccountId: interleaveGroup.id,
        },
      },
    });
    expectOk(
      await annotationService.revise({
        actor: owner,
        auditActor,
        itemId: annotationInterleaveItem.id,
        annotationId: annotationInterleave.id,
        body: {
          expectedRevision: annotationInterleave.currentRevision,
          kind: 'question',
          origin: 'user',
          content: 'Synthetic annotation after ACL revocation',
        },
      }),
      'append annotation after ACL revocation',
    );
  } finally {
    releaseAnnotationRead();
  }
  const interleavedAnnotationHistory = expectOk(
    await interleavedAnnotationHistoryPromise,
    'annotation Repeatable Read ACL interleave',
  );
  assert.deepEqual(
    interleavedAnnotationHistory.items.map((entry) => entry.content),
    ['Synthetic annotation before ACL revocation'],
  );
  assert.equal(interleavedAnnotationHistory.nextBoundary, null);
  assert.equal(
    await prisma.knowledgeAnnotationRevision.count({
      where: { annotationId: annotationInterleave.id },
    }),
    2,
  );

  const organizationSynthesis = expectOk(
    await synthesisService.create({
      actor: owner,
      auditActor,
      body: {
        scope: 'organization',
        title: 'Synthetic organization synthesis',
        content: 'Synthetic organization conclusion',
        sources: [
          {
            kind: 'annotation',
            sourceId: orgAnnotation.id,
            relationType: 'primary',
          },
        ],
      },
    }),
    'create organization synthesis',
  );
  assert.equal(
    (
      await synthesisService.detail({
        actor: bothGroups,
        synthesisId: organizationSynthesis.synthesis.id,
      })
    ).ok,
    true,
  );
  expectFailure(
    await synthesisService.detail({
      actor: outsider,
      synthesisId: organizationSynthesis.synthesis.id,
    }),
    'not_found',
    'organization synthesis outsider',
  );
  const organizationSynthesisVersionTwo = expectOk(
    await synthesisService.appendVersion({
      actor: owner,
      auditActor,
      synthesisId: organizationSynthesis.synthesis.id,
      body: {
        expectedVersion: 1,
        content: 'Synthetic organization conclusion version two',
        sources: [
          {
            kind: 'annotation',
            sourceId: orgAnnotation.id,
            relationType: 'primary',
          },
        ],
      },
    }),
    'append organization synthesis version two',
  );
  assert.equal(organizationSynthesisVersionTwo.synthesis.currentVersion, 2);
  const organizationHistoryBeforeRevoke = expectOk(
    await synthesisService.history({
      actor: bothGroups,
      synthesisId: organizationSynthesis.synthesis.id,
      limit: 1,
    }),
    'organization synthesis history before revoke',
  );
  assert.deepEqual(
    organizationHistoryBeforeRevoke.items.map((entry) => entry.version),
    [2],
  );
  assert.equal(organizationHistoryBeforeRevoke.nextBoundary?.sequence, 2);
  const sourceLessOrganizationSynthesis =
    await prisma.knowledgeSynthesis.create({
      data: {
        ownerUserId: owner.userId,
        scope: 'organization',
        organizationId: owner.organizationId,
        title: 'Synthetic source-less organization synthesis',
        createdBy: owner.userId,
        updatedBy: owner.userId,
        versions: {
          create: {
            version: 1,
            content: 'Synthetic source-less conclusion',
            unresolvedQuestions: [],
            createdBy: owner.userId,
          },
        },
      },
    });
  assert.equal(
    (
      await synthesisService.detail({
        actor: owner,
        synthesisId: sourceLessOrganizationSynthesis.id,
      })
    ).ok,
    true,
  );
  expectFailure(
    await synthesisService.detail({
      actor: bothGroups,
      synthesisId: sourceLessOrganizationSynthesis.id,
    }),
    'not_found',
    'source-less organization synthesis non-owner',
  );
  expectOk(
    await annotationService.remove({
      actor: owner,
      auditActor,
      itemId: orgItemA.id,
      annotationId: orgAnnotation.id,
      expectedRevision: orgAnnotation.currentRevision,
    }),
    'logically delete organization annotation',
  );
  expectFailure(
    await annotationService.detail({
      actor: owner,
      itemId: orgItemA.id,
      annotationId: orgAnnotation.id,
    }),
    'not_found',
    'deleted annotation detail',
  );
  assert.equal(
    (
      await annotationService.history({
        actor: owner,
        itemId: orgItemA.id,
        annotationId: orgAnnotation.id,
        limit: 20,
      })
    ).ok,
    true,
  );
  expectFailure(
    await annotationService.history({
      actor: bothGroups,
      itemId: orgItemA.id,
      annotationId: orgAnnotation.id,
      limit: 20,
    }),
    'not_found',
    'deleted organization annotation history for non-owner',
  );
  expectFailure(
    await synthesisService.detail({
      actor: bothGroups,
      synthesisId: organizationSynthesis.synthesis.id,
    }),
    'not_found',
    'organization synthesis source revoked',
  );
  expectFailure(
    await synthesisService.history({
      actor: bothGroups,
      synthesisId: organizationSynthesis.synthesis.id,
      limit: 1,
      beforeVersion: organizationHistoryBeforeRevoke.nextBoundary.sequence,
    }),
    'not_found',
    'organization synthesis cursor after source revoke',
  );
  const organizationOwnerAfterRevocation = expectOk(
    await synthesisService.detail({
      actor: owner,
      synthesisId: organizationSynthesis.synthesis.id,
    }),
    'organization synthesis owner after source revocation',
  );
  assert.equal(
    organizationOwnerAfterRevocation.currentVersion.sources[0].accessible,
    false,
  );
  assert.equal(
    organizationOwnerAfterRevocation.currentVersion.sources[0].sourceId,
    null,
  );

  const conversation = expectOk(
    await conversationService.create({
      actor: owner,
      auditActor,
      body: { title: 'Synthetic organization conversation' },
    }),
    'create conversation',
  );
  const linkedA = expectOk(
    await conversationService.addItem({
      actor: owner,
      auditActor,
      conversationId: conversation.id,
      body: {
        itemId: orgItemA.id,
        relationType: 'primary',
        ordinal: 0,
        expectedVersion: conversation.version,
      },
    }),
    'link item A',
  );
  const linkedBoth = expectOk(
    await conversationService.addItem({
      actor: owner,
      auditActor,
      conversationId: conversation.id,
      body: {
        itemId: orgItemB.id,
        relationType: 'supporting',
        ordinal: 1,
        expectedVersion: linkedA.version,
      },
    }),
    'link item B',
  );
  assert.equal(
    (
      await conversationService.detail({
        actor: bothGroups,
        conversationId: conversation.id,
      })
    ).ok,
    true,
  );
  expectFailure(
    await conversationService.detail({
      actor: groupAOnly,
      conversationId: conversation.id,
    }),
    'not_found',
    'conversation ACL intersection',
  );
  expectFailure(
    await conversationService.addItem({
      actor: owner,
      auditActor,
      conversationId: conversation.id,
      body: {
        itemId: otherOwnerItem.id,
        relationType: 'context',
        ordinal: 2,
        expectedVersion: linkedBoth.version,
      },
    }),
    'not_found',
    'cross-owner relation',
  );
  await assert.rejects(
    () =>
      prisma.knowledgeConversationItem.create({
        data: {
          conversationId: conversation.id,
          knowledgeItemId: otherOwnerItem.id,
          ownerUserId: owner.userId,
          relationType: 'context',
          ordinal: 2,
          createdBy: owner.userId,
        },
      }),
    /foreign key constraint|P2003/i,
  );

  const transferableItem = await createItem(owner, {
    scope: 'personal',
    sourceType: 'manual',
    title: 'Synthetic same-owner transfer item',
  });
  const transferableConversation = await prisma.knowledgeConversation.create({
    data: {
      ownerUserId: owner.userId,
      title: 'Synthetic same-owner transfer conversation',
      sourceType: 'manual',
      contentHash: 'a'.repeat(64),
      createdBy: owner.userId,
      updatedBy: owner.userId,
    },
  });
  const transferableRelation = await prisma.knowledgeConversationItem.create({
    data: {
      conversationId: transferableConversation.id,
      knowledgeItemId: transferableItem.id,
      ownerUserId: owner.userId,
      relationType: 'primary',
      ordinal: 0,
      createdBy: owner.userId,
    },
  });
  const transferredOwner = 'integration-transferred-owner';
  await prisma.$transaction(async (client) => {
    await client.$executeRawUnsafe(`
      SET CONSTRAINTS
        "KnowledgeConversationItem_conversationId_ownerUserId_fkey",
        "KnowledgeConversationItem_knowledgeItemId_ownerUserId_fkey"
      DEFERRED
    `);
    await client.knowledgeConversation.update({
      where: { id: transferableConversation.id },
      data: { ownerUserId: transferredOwner },
    });
    await client.knowledgeItem.update({
      where: { id: transferableItem.id },
      data: { ownerUserId: transferredOwner },
    });
  });
  const transferredRelation =
    await prisma.knowledgeConversationItem.findUniqueOrThrow({
      where: { id: transferableRelation.id },
    });
  assert.equal(transferredRelation.ownerUserId, transferredOwner);

  const raceItem = await createItem(owner, {
    scope: 'personal',
    sourceType: 'manual',
    title: 'Synthetic same-owner race item',
  });
  const raceConversation = await prisma.knowledgeConversation.create({
    data: {
      ownerUserId: owner.userId,
      title: 'Synthetic same-owner race conversation',
      sourceType: 'manual',
      contentHash: 'b'.repeat(64),
      createdBy: owner.userId,
      updatedBy: owner.userId,
    },
  });
  let markRaceRelationInserted;
  const raceRelationReady = new Promise((resolve) => {
    markRaceRelationInserted = resolve;
  });
  let releaseRaceRelation;
  const raceRelationRelease = new Promise((resolve) => {
    releaseRaceRelation = resolve;
  });
  const raceRelationInsert = prisma.$transaction(
    async (client) => {
      await client.knowledgeConversationItem.create({
        data: {
          conversationId: raceConversation.id,
          knowledgeItemId: raceItem.id,
          ownerUserId: owner.userId,
          relationType: 'primary',
          ordinal: 0,
          createdBy: owner.userId,
        },
      });
      markRaceRelationInserted();
      await raceRelationRelease;
    },
    { timeout: 10_000 },
  );
  await raceRelationReady;
  let publishRaceOwnerUpdatePid;
  const raceOwnerUpdatePidReady = new Promise((resolve) => {
    publishRaceOwnerUpdatePid = resolve;
  });
  const raceOwnerUpdate = prisma
    .$transaction(
      async (client) => {
        const [session] = await client.$queryRawUnsafe(
          'SELECT pg_backend_pid()::integer AS pid',
        );
        publishRaceOwnerUpdatePid(session.pid);
        return client.knowledgeItem.update({
          where: { id: raceItem.id },
          data: { ownerUserId: 'integration-racing-owner' },
        });
      },
      { timeout: 10_000 },
    )
    .then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );
  let raceOwnerLockObserved = false;
  let raceObservationError = null;
  let pidWaitTimeout;
  try {
    const raceOwnerUpdatePid = await Promise.race([
      raceOwnerUpdatePidReady,
      new Promise((_, reject) => {
        pidWaitTimeout = setTimeout(
          () => reject(new Error('owner update session did not start')),
          2_000,
        );
      }),
    ]);
    clearTimeout(pidWaitTimeout);
    const lockObservationDeadline = Date.now() + 2_000;
    while (Date.now() < lockObservationDeadline) {
      const [activity] = await prisma.$queryRawUnsafe(
        `SELECT
           "wait_event_type" AS "waitEventType",
           "wait_event" AS "waitEvent",
           "state"
         FROM "pg_stat_activity"
         WHERE "pid" = $1`,
        raceOwnerUpdatePid,
      );
      if (activity?.waitEventType === 'Lock') {
        raceOwnerLockObserved = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(
      raceOwnerLockObserved,
      true,
      'owner update must enter a PostgreSQL lock wait before relation commit',
    );
  } catch (error) {
    raceObservationError = error;
  } finally {
    clearTimeout(pidWaitTimeout);
    releaseRaceRelation();
  }
  await raceRelationInsert;
  const raceOwnerUpdateResult = await raceOwnerUpdate;
  if (raceObservationError) throw raceObservationError;
  assert.equal(raceOwnerUpdateResult.ok, false);
  assert.match(
    String(raceOwnerUpdateResult.error),
    /foreign key constraint|P2003/i,
  );
  await assert.rejects(
    () =>
      prisma.knowledgeItem.update({
        where: { id: orgItemA.id },
        data: { ownerUserId: 'integration-owner-change-rejected' },
      }),
    /foreign key constraint|P2003/i,
  );
  await assert.rejects(
    () =>
      prisma.knowledgeConversation.update({
        where: { id: conversation.id },
        data: { ownerUserId: 'integration-owner-change-rejected' },
      }),
    /foreign key constraint|P2003/i,
  );

  const concurrentTurns = await Promise.all([
    conversationService.appendTurn({
      actor: owner,
      auditActor,
      conversationId: conversation.id,
      body: {
        expectedVersion: linkedBoth.version,
        role: 'user',
        origin: 'user',
        content: 'Synthetic user turn',
      },
    }),
    conversationService.appendTurn({
      actor: owner,
      auditActor,
      conversationId: conversation.id,
      body: {
        expectedVersion: linkedBoth.version,
        role: 'assistant',
        origin: 'ai',
        content: 'Synthetic assistant turn',
      },
    }),
  ]);
  assert.equal(concurrentTurns.filter((result) => result.ok).length, 1);
  assert.equal(
    concurrentTurns.filter(
      (result) => !result.ok && result.code === 'version_conflict',
    ).length,
    1,
  );
  const storedTurns = await prisma.knowledgeConversationTurn.findMany({
    where: { conversationId: conversation.id },
  });
  assert.equal(storedTurns.length, 1);
  assert.equal(storedTurns[0].sequence, 1);
  await assert.rejects(
    () =>
      prisma.knowledgeConversationTurn.create({
        data: {
          conversationId: conversation.id,
          sequence: 2,
          role: 'system',
          origin: 'ai',
          content: 'Synthetic invalid role origin',
          contentHash: 'f'.repeat(64),
          createdBy: owner.userId,
        },
      }),
    /constraint|check/i,
  );
  const winningTurn = expectOk(
    concurrentTurns.find((result) => result.ok),
    'winning concurrent turn',
  );
  const turnTwo = expectOk(
    await conversationService.appendTurn({
      actor: owner,
      auditActor,
      conversationId: conversation.id,
      body: {
        expectedVersion: winningTurn.conversation.version,
        role: 'system',
        origin: 'system',
        content: 'Synthetic system turn',
      },
    }),
    'append turn two',
  );
  expectOk(
    await conversationService.appendTurn({
      actor: owner,
      auditActor,
      conversationId: conversation.id,
      body: {
        expectedVersion: turnTwo.conversation.version,
        role: 'tool',
        origin: 'tool',
        content: 'Synthetic tool turn',
      },
    }),
    'append turn three',
  );
  const turnPageOne = expectOk(
    await conversationService.listTurns({
      actor: owner,
      conversationId: conversation.id,
      limit: 2,
    }),
    'conversation turns page one',
  );
  assert.deepEqual(
    turnPageOne.items.map((entry) => entry.sequence),
    [1, 2],
  );
  assert.equal(turnPageOne.nextBoundary?.sequence, 2);
  const turnPageTwo = expectOk(
    await conversationService.listTurns({
      actor: owner,
      conversationId: conversation.id,
      limit: 2,
      boundary: turnPageOne.nextBoundary,
    }),
    'conversation turns page two',
  );
  assert.deepEqual(
    turnPageTwo.items.map((entry) => entry.sequence),
    [3],
  );
  assert.equal(turnPageTwo.nextBoundary, null);

  const conversationInterleave = expectOk(
    await conversationService.create({
      actor: owner,
      auditActor,
      body: { title: 'Synthetic conversation ACL interleave fixture' },
    }),
    'create conversation ACL interleave fixture',
  );
  const conversationInterleaveLinked = expectOk(
    await conversationService.addItem({
      actor: owner,
      auditActor,
      conversationId: conversationInterleave.id,
      body: {
        itemId: conversationInterleaveItem.id,
        relationType: 'primary',
        ordinal: 0,
        expectedVersion: conversationInterleave.version,
      },
    }),
    'link conversation ACL interleave item',
  );
  const conversationInterleaveTurn = expectOk(
    await conversationService.appendTurn({
      actor: owner,
      auditActor,
      conversationId: conversationInterleave.id,
      body: {
        expectedVersion: conversationInterleaveLinked.version,
        role: 'user',
        origin: 'user',
        content: 'Synthetic turn before ACL revocation',
      },
    }),
    'append conversation turn before ACL revocation',
  );
  let conversationFirstReadComplete;
  const conversationFirstRead = new Promise((resolve) => {
    conversationFirstReadComplete = resolve;
  });
  let releaseConversationRead;
  const conversationAclChanged = new Promise((resolve) => {
    releaseConversationRead = resolve;
  });
  const conversationInterleaveRepository =
    new provenanceAdapter.PrismaKnowledgeConversationRepository(
      interleavingTransactionHost(
        'knowledgeConversation',
        'findFirst',
        async () => {
          conversationFirstReadComplete();
          await conversationAclChanged;
        },
      ),
    );
  const conversationInterleaveService = createKnowledgeConversationService({
    reader: conversationInterleaveRepository,
    unitOfWork: provenanceAdapter.prismaKnowledgeProvenanceUnitOfWork,
  });
  const interleavedConversationTurnsPromise =
    conversationInterleaveService.listTurns({
      actor: interleaveReader,
      conversationId: conversationInterleave.id,
      limit: 20,
    });
  await conversationFirstRead;
  try {
    await prisma.knowledgeItemGroupGrant.delete({
      where: {
        knowledgeItemId_groupAccountId: {
          knowledgeItemId: conversationInterleaveItem.id,
          groupAccountId: interleaveGroup.id,
        },
      },
    });
    expectOk(
      await conversationService.appendTurn({
        actor: owner,
        auditActor,
        conversationId: conversationInterleave.id,
        body: {
          expectedVersion: conversationInterleaveTurn.conversation.version,
          role: 'assistant',
          origin: 'ai',
          content: 'Synthetic turn after ACL revocation',
        },
      }),
      'append conversation turn after ACL revocation',
    );
  } finally {
    releaseConversationRead();
  }
  const interleavedConversationTurns = expectOk(
    await interleavedConversationTurnsPromise,
    'conversation Repeatable Read ACL interleave',
  );
  assert.deepEqual(
    interleavedConversationTurns.items.map((entry) => entry.content),
    ['Synthetic turn before ACL revocation'],
  );
  assert.equal(interleavedConversationTurns.nextBoundary, null);
  assert.equal(
    await prisma.knowledgeConversationTurn.count({
      where: { conversationId: conversationInterleave.id },
    }),
    2,
  );

  const synthesis = expectOk(
    await synthesisService.create({
      actor: owner,
      auditActor,
      body: {
        scope: 'personal',
        title: 'Synthetic personal synthesis',
        content: 'Synthetic conclusion',
        unresolvedQuestions: ['Synthetic unresolved question'],
        confidenceBasisPoints: 7200,
        sources: [
          {
            kind: 'item',
            sourceId: personalItem.id,
            relationType: 'primary',
          },
          {
            kind: 'annotation_revision',
            sourceId: revisedAnnotation.revision.id,
            relationType: 'supporting',
          },
        ],
      },
    }),
    'create synthesis',
  );
  expectFailure(
    await synthesisService.detail({
      actor: outsider,
      synthesisId: synthesis.synthesis.id,
    }),
    'not_found',
    'personal synthesis outsider',
  );

  const concurrentVersions = await Promise.all([
    synthesisService.appendVersion({
      actor: owner,
      auditActor,
      synthesisId: synthesis.synthesis.id,
      body: {
        expectedVersion: 1,
        content: 'Synthetic conclusion version two A',
        sources: [
          {
            kind: 'item',
            sourceId: personalItem.id,
            relationType: 'primary',
          },
        ],
      },
    }),
    synthesisService.appendVersion({
      actor: owner,
      auditActor,
      synthesisId: synthesis.synthesis.id,
      body: {
        expectedVersion: 1,
        content: 'Synthetic conclusion version two B',
        sources: [
          {
            kind: 'item',
            sourceId: personalItem.id,
            relationType: 'primary',
          },
        ],
      },
    }),
  ]);
  assert.equal(concurrentVersions.filter((result) => result.ok).length, 1);
  assert.equal(
    concurrentVersions.filter(
      (result) => !result.ok && result.code === 'version_conflict',
    ).length,
    1,
  );
  const versionTwo = expectOk(
    concurrentVersions.find((result) => result.ok),
    'winning synthesis version',
  );
  expectOk(
    await synthesisService.appendVersion({
      actor: owner,
      auditActor,
      synthesisId: synthesis.synthesis.id,
      body: {
        expectedVersion: versionTwo.synthesis.currentVersion,
        content: 'Synthetic conclusion version three',
        sources: [
          {
            kind: 'item',
            sourceId: personalItem.id,
            relationType: 'primary',
          },
        ],
      },
    }),
    'append synthesis version three',
  );
  const synthesisVersionOne =
    await prisma.knowledgeSynthesisVersion.findUniqueOrThrow({
      where: {
        synthesisId_version: {
          synthesisId: synthesis.synthesis.id,
          version: 1,
        },
      },
    });
  expectFailure(
    await synthesisService.appendVersion({
      actor: owner,
      auditActor,
      synthesisId: synthesis.synthesis.id,
      body: {
        expectedVersion: 3,
        content: 'Synthetic same-aggregate source must be rejected',
        sources: [
          {
            kind: 'synthesis_version',
            sourceId: synthesisVersionOne.id,
            relationType: 'primary',
          },
        ],
      },
    }),
    'not_found',
    'same synthesis historical version source',
  );
  const synthesisPageOne = expectOk(
    await synthesisService.history({
      actor: owner,
      synthesisId: synthesis.synthesis.id,
      limit: 2,
    }),
    'synthesis history page one',
  );
  assert.deepEqual(
    synthesisPageOne.items.map((entry) => entry.version),
    [3, 2],
  );
  assert.equal(synthesisPageOne.nextBoundary?.sequence, 2);
  const synthesisPageTwo = expectOk(
    await synthesisService.history({
      actor: owner,
      synthesisId: synthesis.synthesis.id,
      limit: 2,
      beforeVersion: synthesisPageOne.nextBoundary.sequence,
    }),
    'synthesis history page two',
  );
  assert.deepEqual(
    synthesisPageTwo.items.map((entry) => entry.version),
    [1],
  );
  assert.equal(synthesisPageTwo.nextBoundary, null);

  const removedSource = expectOk(
    await itemService.remove({
      actor: owner,
      auditActor,
      itemId: personalItem.id,
      expectedVersion: personalItem.version,
      reasonCode: 'owner_request',
    }),
    'logically delete synthesis source',
  );
  assert.ok(removedSource.deletedAt);
  const redacted = expectOk(
    await synthesisService.detail({
      actor: owner,
      synthesisId: synthesis.synthesis.id,
    }),
    'owner reads synthesis after source loss',
  );
  assert.ok(
    redacted.currentVersion.sources.some(
      (entry) =>
        entry.kind === 'item' &&
        entry.accessible === false &&
        entry.sourceId === null &&
        entry.id === null &&
        entry.createdBy === null,
    ),
  );

  const immutableSynthesisSource =
    await prisma.knowledgeSynthesisSource.findFirstOrThrow({
      where: { synthesisVersionId: synthesisVersionOne.id },
      select: { id: true },
    });
  const immutableHistoryMutations = [
    () =>
      prisma.knowledgeAnnotationRevision.update({
        where: { id: revisedAnnotation.revision.id },
        data: { content: 'Synthetic destructive annotation rewrite' },
      }),
    () =>
      prisma.knowledgeConversationTurn.update({
        where: { id: storedTurns[0].id },
        data: { content: 'Synthetic destructive turn rewrite' },
      }),
    () =>
      prisma.knowledgeSynthesisVersion.update({
        where: { id: synthesisVersionOne.id },
        data: { content: 'Synthetic destructive synthesis rewrite' },
      }),
    () =>
      prisma.knowledgeSynthesisSource.update({
        where: { id: immutableSynthesisSource.id },
        data: { relationType: 'context' },
      }),
    () =>
      prisma.knowledgeSynthesisSource.delete({
        where: { id: immutableSynthesisSource.id },
      }),
  ];
  for (const mutateHistory of immutableHistoryMutations) {
    await assert.rejects(
      mutateHistory,
      /immutable knowledge provenance history/i,
    );
  }

  await assert.rejects(
    () =>
      prisma.knowledgeSynthesisSource.create({
        data: {
          synthesisVersionId: redacted.currentVersion.id,
          relationType: 'context',
          ordinal: 99,
          createdBy: owner.userId,
        },
      }),
    /constraint|check/i,
  );
  await assert.rejects(
    () =>
      prisma.knowledgeSynthesisSource.create({
        data: {
          synthesisVersionId: redacted.currentVersion.id,
          relationType: 'context',
          ordinal: 98,
          sourceSynthesisVersionId: synthesisVersionOne.id,
          createdBy: owner.userId,
        },
      }),
    /23514|own version history/i,
  );
  await assert.rejects(
    () =>
      prisma.knowledgeSynthesisSource.create({
        data: {
          synthesisVersionId: redacted.currentVersion.id,
          relationType: 'context',
          ordinal: 99,
          sourceKnowledgeItemId: orgItemA.id,
          sourceConversationId: conversation.id,
          createdBy: owner.userId,
        },
      }),
    /constraint|check/i,
  );
  await assert.rejects(
    () =>
      prisma.auditLog.create({
        data: {
          action: 'knowledge_annotation_created',
          userId: owner.userId,
          targetTable: 'knowledge_conversations',
          targetId: conversation.id,
          metadata: {},
        },
      }),
    /constraint|check/i,
  );
  await assert.rejects(
    () =>
      prisma.auditLog.create({
        data: {
          action: 'knowledge_annotation_created',
          userId: owner.userId,
          targetTable: null,
          targetId: conversation.id,
          metadata: {},
        },
      }),
    /constraint|check/i,
  );
  await assert.rejects(
    () =>
      prisma.auditLog.create({
        data: {
          action: 'knowledge_annotation_created',
          userId: owner.userId,
          targetTable: 'knowledge_annotations',
          targetId: null,
          metadata: {},
        },
      }),
    /constraint|check/i,
  );

  const auditFailureItem = await createItem(owner, {
    scope: 'personal',
    sourceType: 'manual',
    title: 'Synthetic audit rollback item',
  });
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION reject_knowledge_annotation_audit() RETURNS trigger AS $$
    BEGIN
      IF NEW."action" = 'knowledge_annotation_created' THEN
        RAISE EXCEPTION 'synthetic audit rejection';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER reject_knowledge_annotation_audit_trigger
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION reject_knowledge_annotation_audit();
  `);
  try {
    await assert.rejects(
      () =>
        annotationService.create({
          actor: owner,
          auditActor,
          itemId: auditFailureItem.id,
          body: {
            kind: 'note',
            origin: 'user',
            content: 'Synthetic body must roll back',
          },
        }),
      /synthetic audit rejection/,
    );
  } finally {
    await prisma.$executeRawUnsafe(`
      DROP TRIGGER reject_knowledge_annotation_audit_trigger ON "AuditLog";
      DROP FUNCTION reject_knowledge_annotation_audit();
    `);
  }
  assert.equal(
    await prisma.knowledgeAnnotation.count({
      where: { knowledgeItemId: auditFailureItem.id },
    }),
    0,
  );

  const auditRows = await prisma.auditLog.findMany({
    where: {
      action: {
        in: [
          'knowledge_annotation_created',
          'knowledge_annotation_revised',
          'knowledge_annotation_deleted',
          'knowledge_conversation_created',
          'knowledge_conversation_item_linked',
          'knowledge_conversation_turn_appended',
          'knowledge_synthesis_created',
          'knowledge_synthesis_version_appended',
          'knowledge_synthesis_source_linked',
        ],
      },
    },
    select: { action: true, metadata: true },
  });
  assert.ok(auditRows.length >= 10);
  for (const row of auditRows) {
    assert.deepEqual(row.metadata?._auth, {
      principalUserId: auditActor.principalUserId,
      actorUserId: auditActor.actorUserId,
      scopes: auditActor.authScopes,
    });
    assert.deepEqual(row.metadata?._request, {
      id: auditActor.requestId,
      source: auditActor.source,
    });
  }
  const serializedAudit = JSON.stringify(auditRows);
  for (const body of [
    'Synthetic personal annotation',
    'Synthetic revised question',
    'Synthetic organization conclusion',
    'Synthetic user turn',
    'Synthetic assistant turn',
    'Synthetic conclusion',
    'Synthetic unresolved question',
  ]) {
    assert.equal(serializedAudit.includes(body), false, body);
  }

  console.log(
    JSON.stringify({
      result: 'PASS',
      annotationRevisions:
        annotationPageOne.items.length + annotationPageTwo.items.length,
      conversationItems: linkedBoth.items.length,
      conversationTurns: turnPageOne.items.length + turnPageTwo.items.length,
      synthesisVersionRace: 'one_success_one_conflict',
      sourceRevocationRedacted: true,
      aclSwapSnapshotConsistent: true,
      annotationReadSnapshotConsistent: true,
      conversationReadSnapshotConsistent: true,
      annotationHistoryAclInterleaveRedacted: true,
      conversationTurnAclInterleaveRedacted: true,
      crossOwnerRelationDbRejected: true,
      parentOwnerUpdateRejected: true,
      deferredOwnerTransferConsistent: true,
      concurrentOwnerLockObserved: raceOwnerLockObserved,
      concurrentOwnerRaceRejected: true,
      sameSynthesisSourceRejected: true,
      immutableHistoryEnforced: true,
      auditFailureRolledBack: true,
    }),
  );
} finally {
  await prisma.$disconnect();
}
