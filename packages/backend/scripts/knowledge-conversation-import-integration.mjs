import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

function parseDatabaseUrl(value) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

const databaseUrl = parseDatabaseUrl(process.env.DATABASE_URL);
if (
  process.env.KNOWLEDGE_CONVERSATION_IMPORT_INTEGRATION_CONFIRM !== '1' ||
  !databaseUrl ||
  !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== '/erp4_knowledge_conversation_import_test'
) {
  throw new Error(
    'Refusing to run outside the confirmed loopback erp4_knowledge_conversation_import_test database',
  );
}

const [
  { Prisma },
  { prisma },
  { createKnowledgeItemService },
  { prismaKnowledgeItemRepository, prismaKnowledgeUnitOfWork },
  { createKnowledgeConversationImportUseCases },
  { createKnowledgeConversationImportTokenCodec },
  { encodeKnowledgeConversationImportInput },
  {
    PrismaKnowledgeConversationImportRepository,
    PrismaKnowledgeConversationImportUnitOfWork,
  },
  { PrismaKnowledgeProvenanceAuditWriter },
] = await Promise.all([
  import('@prisma/client'),
  import('../dist/services/db.js'),
  import('../dist/application/knowledge/knowledgeItemUseCases.js'),
  import('../dist/adapters/knowledge/prismaKnowledgeItemAdapter.js'),
  import('../dist/application/knowledge/knowledgeConversationImportUseCases.js'),
  import('../dist/application/knowledge/knowledgeConversationImportToken.js'),
  import('../dist/application/knowledge/knowledgeConversationImportParser.js'),
  import('../dist/adapters/knowledge/prismaKnowledgeConversationImportAdapter.js'),
  import('../dist/adapters/knowledge/prismaKnowledgeProvenanceAuditAdapter.js'),
]);

const actor = {
  userId: 'conversation-import-owner',
  organizationId: 'integration-org',
  groupAccountIds: [],
};
const otherActor = {
  userId: 'conversation-import-other-owner',
  organizationId: 'integration-org',
  groupAccountIds: [],
};
const auditActor = {
  requestId: 'knowledge-conversation-import-integration',
  source: 'api',
  principalUserId: actor.userId,
  actorUserId: actor.userId,
  authScopes: ['knowledge:write'],
};

function expectOk(result, context) {
  assert.equal(result.ok, true, `${context}: ${JSON.stringify(result)}`);
  return result.value;
}

function expectFailure(result, code, context) {
  assert.equal(result.ok, false, context);
  assert.equal(result.code, code, context);
  return result;
}

function structuredEnvelope(format, title, linkedItems, suffix = '') {
  const conversation = {
    title,
    provider: 'openai',
    model: 'gpt',
    turns: [
      {
        role: 'user',
        origin: 'user',
        content: `Synthetic question${suffix}`,
        occurredAt: '2026-08-08T00:00:00.000Z',
      },
      {
        role: 'assistant',
        origin: 'ai',
        content: `Synthetic answer${suffix}`,
      },
      {
        role: 'system',
        origin: 'system',
        content: 'Synthetic policy context',
      },
      {
        role: 'tool',
        origin: 'tool',
        name: 'search',
        content: 'Synthetic tool result',
      },
    ],
  };
  if (format === 'markdown') {
    const markdown = `# Knowledge Conversation v1
title: ${title}
provider: openai
model: gpt

## Turn
role: user
origin: user
occurredAt: 2026-08-08T00:00:00.000Z

Synthetic question${suffix}

## Turn
role: assistant
origin: ai

Synthetic answer${suffix}

## Turn
role: system
origin: system

Synthetic policy context

## Turn
role: tool
origin: tool
name: search

Synthetic tool result`;
    return {
      format,
      inputBase64: encodeKnowledgeConversationImportInput(markdown),
      linkedItems,
    };
  }
  return {
    format,
    inputBase64: encodeKnowledgeConversationImportInput(
      JSON.stringify(conversation),
    ),
    linkedItems,
  };
}

const tokenCodec = createKnowledgeConversationImportTokenCodec({
  env: {
    NODE_ENV: 'test',
    KNOWLEDGE_CURSOR_SIGNING_SECRET:
      'conversation-import-integration-signing-secret-0001',
  },
});
const service = createKnowledgeConversationImportUseCases({
  unitOfWork: new PrismaKnowledgeConversationImportUnitOfWork(prisma),
  tokenCodec,
});
const itemService = createKnowledgeItemService({
  reader: prismaKnowledgeItemRepository,
  unitOfWork: prismaKnowledgeUnitOfWork,
});

async function createItem(itemActor, title) {
  return expectOk(
    await itemService.create({
      actor: itemActor,
      auditActor: {
        ...auditActor,
        principalUserId: itemActor.userId,
        actorUserId: itemActor.userId,
      },
      body: { scope: 'personal', sourceType: 'manual', title },
    }),
    `create ${title}`,
  );
}

async function preview(payload, serviceOverride = service) {
  return expectOk(
    await serviceOverride.preview({ actor, auditActor, body: payload }),
    `preview ${payload.format}`,
  );
}

async function commit(
  payload,
  previewResult,
  requestKey,
  serviceOverride = service,
) {
  return serviceOverride.commit({
    actor,
    auditActor,
    body: {
      ...payload,
      previewToken: previewResult.previewToken,
      requestKey,
    },
  });
}

try {
  await prisma.userAccount.createMany({
    data: [
      {
        id: actor.userId,
        userName: actor.userId,
        active: true,
        organization: actor.organizationId,
      },
      {
        id: otherActor.userId,
        userName: otherActor.userId,
        active: true,
        organization: otherActor.organizationId,
      },
    ],
  });
  const primaryItem = await createItem(actor, 'Import primary item');
  const otherOwnerItem = await createItem(otherActor, 'Other owner item');

  const formatResults = [];
  for (const format of ['manual', 'json', 'markdown']) {
    const payload = structuredEnvelope(format, `Synthetic ${format} import`, [
      { itemId: primaryItem.id, relationType: 'primary' },
    ]);
    const previewResult = await preview(payload);
    const committed = expectOk(
      await commit(payload, previewResult, `request-${format}-${randomUUID()}`),
      `commit ${format}`,
    );
    assert.equal(committed.created, true);
    assert.equal(committed.turnCount, 4);
    assert.equal(committed.linkedItemCount, 1);
    formatResults.push(committed);
  }

  const replayPayload = structuredEnvelope(
    'manual',
    'Concurrent replay import',
    [{ itemId: primaryItem.id, relationType: 'primary' }],
    '-replay',
  );
  const replayPreview = await preview(replayPayload);
  const replayKey = `request-replay-${randomUUID()}`;
  const concurrentReplay = await Promise.all([
    commit(replayPayload, replayPreview, replayKey),
    commit(replayPayload, replayPreview, replayKey),
  ]);
  assert.equal(
    concurrentReplay.every((result) => result.ok),
    true,
  );
  assert.equal(
    new Set(concurrentReplay.map((result) => result.value.conversationId)).size,
    1,
  );
  assert.deepEqual(
    concurrentReplay.map((result) => result.value.created).sort(),
    [false, true],
  );
  const replayConversationId = concurrentReplay[0].value.conversationId;
  assert.equal(
    await prisma.knowledgeConversationTurn.count({
      where: { conversationId: replayConversationId },
    }),
    4,
  );
  const replayWithNewKey = expectOk(
    await commit(
      replayPayload,
      replayPreview,
      `request-replay-second-${randomUUID()}`,
    ),
    'same payload with a new key',
  );
  assert.equal(replayWithNewKey.conversationId, replayConversationId);
  assert.equal(replayWithNewKey.reused, true);

  const conflictA = structuredEnvelope(
    'json',
    'Concurrent conflict A',
    [{ itemId: primaryItem.id, relationType: 'primary' }],
    '-conflict-a',
  );
  const conflictB = structuredEnvelope(
    'json',
    'Concurrent conflict B',
    [{ itemId: primaryItem.id, relationType: 'primary' }],
    '-conflict-b',
  );
  const [previewA, previewB] = await Promise.all([
    preview(conflictA),
    preview(conflictB),
  ]);
  const conflictKey = `request-conflict-${randomUUID()}`;
  const conflicting = await Promise.all([
    commit(conflictA, previewA, conflictKey),
    commit(conflictB, previewB, conflictKey),
  ]);
  assert.equal(conflicting.filter((result) => result.ok).length, 1);
  assert.equal(
    conflicting.filter(
      (result) => !result.ok && result.code === 'idempotency_conflict',
    ).length,
    1,
  );

  const crossOwnerPayload = structuredEnvelope(
    'manual',
    'Cross owner rejection',
    [{ itemId: otherOwnerItem.id, relationType: 'primary' }],
  );
  expectFailure(
    await service.preview({ actor, auditActor, body: crossOwnerPayload }),
    'not_found',
    'cross-owner item must not be disclosed',
  );

  const expiringItem = await createItem(actor, 'ACL loss item');
  const aclLossPayload = structuredEnvelope('manual', 'ACL loss import', [
    { itemId: expiringItem.id, relationType: 'primary' },
  ]);
  const aclLossPreview = await preview(aclLossPayload);
  expectOk(
    await itemService.remove({
      actor,
      auditActor,
      itemId: expiringItem.id,
      expectedVersion: 1,
      reasonCode: 'owner_request',
    }),
    'delete item between preview and commit',
  );
  expectFailure(
    await commit(
      aclLossPayload,
      aclLossPreview,
      `request-acl-loss-${randomUUID()}`,
    ),
    'not_found',
    'ACL must be rechecked at commit',
  );

  const failingUnitOfWork = {
    run: (work) =>
      prisma.$transaction(
        async (client) => {
          const writer = new PrismaKnowledgeProvenanceAuditWriter(client);
          return work({
            imports: new PrismaKnowledgeConversationImportRepository(client),
            audit: {
              async write(entry) {
                if (entry.action === 'knowledge_import_committed') {
                  throw new Error('synthetic mandatory audit failure');
                }
                return writer.write(entry);
              },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
  };
  const failingService = createKnowledgeConversationImportUseCases({
    unitOfWork: failingUnitOfWork,
    tokenCodec,
  });
  const rollbackPayload = structuredEnvelope(
    'manual',
    'Mandatory audit rollback import',
    [{ itemId: primaryItem.id, relationType: 'primary' }],
    '-rollback-private-body',
  );
  const rollbackPreview = await preview(rollbackPayload, failingService);
  const ledgerCountBefore =
    await prisma.knowledgeConversationImportRequest.count();
  await assert.rejects(
    () =>
      commit(
        rollbackPayload,
        rollbackPreview,
        `request-audit-rollback-${randomUUID()}`,
        failingService,
      ),
    /synthetic mandatory audit failure/,
  );
  assert.equal(
    await prisma.knowledgeConversationImportRequest.count(),
    ledgerCountBefore,
  );
  assert.equal(
    await prisma.knowledgeConversation.count({
      where: { title: 'Mandatory audit rollback import' },
    }),
    0,
  );

  const firstLedger =
    await prisma.knowledgeConversationImportRequest.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
    });
  await assert.rejects(
    () =>
      prisma.knowledgeConversationImportRequest.update({
        where: { id: firstLedger.id },
        data: { createdBy: actor.userId },
      }),
    /immutable|P2010|P2004|P2025/i,
  );
  await assert.rejects(
    () =>
      prisma.knowledgeConversationImportRequest.delete({
        where: { id: firstLedger.id },
      }),
    /immutable|P2010|P2004|P2025/i,
  );
  await assert.rejects(
    () =>
      prisma.knowledgeConversationImportRequest.create({
        data: {
          id: randomUUID(),
          ownerUserId: actor.userId,
          requestKeyHash: 'not-a-hash',
          canonicalPayloadHash: 'b'.repeat(64),
          sourceType: 'manual',
          conversationId: firstLedger.conversationId,
          createdBy: actor.userId,
        },
      }),
    /check|P2004|P2010/i,
  );
  await assert.rejects(
    () =>
      prisma.knowledgeConversationImportRequest.create({
        data: {
          id: randomUUID(),
          ownerUserId: otherActor.userId,
          requestKeyHash: 'a'.repeat(64),
          canonicalPayloadHash: 'b'.repeat(64),
          sourceType: 'manual',
          conversationId: firstLedger.conversationId,
          createdBy: otherActor.userId,
        },
      }),
    /foreign key|P2003|P2010/i,
  );
  await assert.rejects(
    () =>
      prisma.knowledgeConversationImportRequest.create({
        data: {
          id: randomUUID(),
          ownerUserId: actor.userId,
          requestKeyHash: 'b'.repeat(64),
          canonicalPayloadHash: 'c'.repeat(64),
          sourceType: 'manual',
          conversationId: firstLedger.conversationId,
          createdBy: otherActor.userId,
        },
      }),
    /check|P2004|P2010/i,
  );
  await assert.rejects(
    () =>
      prisma.knowledgeConversationImportRequest.create({
        data: {
          id: randomUUID(),
          ownerUserId: actor.userId,
          requestKeyHash: 'c'.repeat(64),
          canonicalPayloadHash: 'not-a-hash',
          sourceType: 'manual',
          conversationId: firstLedger.conversationId,
          createdBy: actor.userId,
        },
      }),
    /check|P2004|P2010/i,
  );
  await assert.rejects(
    () =>
      prisma.knowledgeConversationImportRequest.create({
        data: {
          id: randomUUID(),
          ownerUserId: actor.userId,
          requestKeyHash: firstLedger.requestKeyHash,
          canonicalPayloadHash: firstLedger.canonicalPayloadHash,
          sourceType: firstLedger.sourceType,
          conversationId: firstLedger.conversationId,
          createdBy: actor.userId,
        },
      }),
    /unique|P2002|P2010/i,
  );

  const importedToolTurn =
    await prisma.knowledgeConversationTurn.findFirstOrThrow({
      where: {
        conversationId: formatResults[0].conversationId,
        role: 'tool',
      },
    });
  assert.equal(importedToolTurn.name, 'search');
  await assert.rejects(
    () =>
      prisma.knowledgeConversationTurn.create({
        data: {
          id: randomUUID(),
          conversationId: formatResults[0].conversationId,
          sequence: 999,
          role: 'user',
          origin: 'user',
          content: 'Synthetic invalid role-bound tool provenance',
          name: 'search',
          contentHash: 'd'.repeat(64),
          createdBy: actor.userId,
        },
      }),
    /check|P2004|P2010/i,
  );

  const importAudits = await prisma.auditLog.findMany({
    where: {
      action: {
        in: [
          'knowledge_import_previewed',
          'knowledge_import_committed',
          'knowledge_import_duplicate_detected',
          'knowledge_import_rejected',
        ],
      },
    },
    select: { action: true, targetTable: true, metadata: true },
  });
  assert.ok(importAudits.length > 0);
  assert.equal(
    importAudits.every((entry) => entry.targetTable === 'knowledge_imports'),
    true,
  );
  const serializedAudit = JSON.stringify(importAudits);
  for (const forbidden of [
    'Synthetic question',
    'Synthetic answer',
    'rollback-private-body',
    'request-replay',
    primaryItem.id,
  ]) {
    assert.equal(serializedAudit.includes(forbidden), false);
  }

  const importedCounts = await prisma.knowledgeConversation.aggregate({
    where: { ownerUserId: actor.userId, importedAt: { not: null } },
    _count: true,
  });
  assert.ok(importedCounts._count >= 5);
  console.log(
    JSON.stringify({
      result: 'PASS',
      formats: formatResults.length,
      concurrentReplay: 'converged',
      concurrentConflict: 'one-created-one-conflict',
      aclLoss: 'fail-closed',
      auditRollback: 'verified',
      immutableLedger: 'verified',
      databaseConstraints: 'negative-inserts-rejected',
    }),
  );
} finally {
  await prisma.$disconnect();
}
