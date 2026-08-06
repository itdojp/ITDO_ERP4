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
  provenanceAdapter,
] = await Promise.all([
  import('../dist/services/db.js'),
  import('../dist/application/knowledge/knowledgeItemUseCases.js'),
  import('../dist/adapters/knowledge/prismaKnowledgeItemAdapter.js'),
  import('../dist/application/knowledge/knowledgeAnnotationUseCases.js'),
  import('../dist/application/knowledge/knowledgeConversationUseCases.js'),
  import('../dist/application/knowledge/knowledgeSynthesisUseCases.js'),
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

const auditActor = {
  requestId: 'knowledge-provenance-integration',
  source: 'api',
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
  const owner = {
    userId: 'integration-owner',
    organizationId: 'integration-org',
    groupAccountIds: [groupA.id, groupB.id],
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
    await synthesisService.detail({
      actor: bothGroups,
      synthesisId: organizationSynthesis.synthesis.id,
    }),
    'not_found',
    'organization synthesis source revoked',
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
      annotationRevisions: history.items.length,
      conversationItems: linkedBoth.items.length,
      conversationTurns: storedTurns.length,
      synthesisVersionRace: 'one_success_one_conflict',
      sourceRevocationRedacted: true,
      auditFailureRolledBack: true,
    }),
  );
} finally {
  await prisma.$disconnect();
}
