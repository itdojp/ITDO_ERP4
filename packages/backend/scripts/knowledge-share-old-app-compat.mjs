import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const baseline = process.env.KNOWLEDGE_SHARE_OLD_APP_BASE_SHA;
const oldRoot = process.env.OLD_APP_ROOT;
const currentRoot = process.env.CURRENT_APP_ROOT;
const mode = process.env.KNOWLEDGE_SHARE_OLD_APP_MODE;

function parseDatabaseUrl(value) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

const databaseUrl = parseDatabaseUrl(process.env.DATABASE_URL);
if (
  process.env.KNOWLEDGE_SHARE_OLD_APP_CONFIRM !== '1' ||
  baseline !== '421b38e82fa545e46348c49d0646531f8ddc4cd2' ||
  !oldRoot ||
  !currentRoot ||
  !['seed', 'current-create', 'old-after', 'current-after'].includes(mode) ||
  !databaseUrl ||
  !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== '/erp4_knowledge_share_old_app_test'
) {
  throw new Error(
    'Refusing to run outside the confirmed loopback Knowledge share old-app database',
  );
}

const oldLoad = (path) => import(pathToFileURL(`${oldRoot}/${path}`).href);
const oldRequire = createRequire(
  pathToFileURL(`${oldRoot}/packages/backend/package.json`),
);
const currentRequire = createRequire(
  pathToFileURL(`${currentRoot}/packages/backend/package.json`),
);

const ownerId = 'share-old-app-owner';
const viewerId = 'share-old-app-viewer';
const roomId = 'share-old-app-room';
const sourceItemId = 'share-old-app-source-item';
const legacyMessageId = 'share-old-app-legacy-message';
const shareId = '11111111-2222-4333-8444-555555555555';
const shareMessageId = shareId;
const oldWriteMessageId = 'share-old-app-post-migration-message';
const genericBody = 'Knowledge was shared.';
const privateCanary = 'PRIVATE-SHARE-CONTENT-MUST-NOT-LEAK';
const hex = (value) => value.repeat(64);

function createPrisma(requireFromRoot) {
  const { PrismaClient } = requireFromRoot('@prisma/client');
  const { PrismaPg } = requireFromRoot('@prisma/adapter-pg');
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
}

function currentPrisma() {
  return createPrisma(currentRequire);
}

function oldPrisma() {
  return createPrisma(oldRequire);
}

if (mode === 'seed') {
  const prisma = oldPrisma();
  try {
    await prisma.chatRoom.create({
      data: {
        id: roomId,
        type: 'private_group',
        name: 'Synthetic Knowledge share compatibility room',
        isOfficial: false,
      },
    });
    await prisma.chatRoomMember.createMany({
      data: [
        { roomId, userId: ownerId },
        { roomId, userId: viewerId },
      ],
    });
    const legacy = await prisma.chatMessage.create({
      data: {
        id: legacyMessageId,
        roomId,
        userId: ownerId,
        body: 'Synthetic legacy root message',
        createdAt: new Date('2026-08-10T00:00:00.000Z'),
      },
      select: { activitySequence: true },
    });
    await prisma.chatReadState.create({
      data: {
        roomId,
        userId: viewerId,
        lastReadAt: new Date('2026-08-10T00:00:00.000Z'),
        lastReadMessageId: legacyMessageId,
        lastReadActivitySequence: legacy.activitySequence,
      },
    });
    await prisma.knowledgeItem.create({
      data: {
        id: sourceItemId,
        ownerUserId: ownerId,
        scope: 'personal',
        sourceType: 'manual',
        title: privateCanary,
        status: 'inbox',
        version: 1,
        createdBy: ownerId,
        updatedBy: ownerId,
      },
    });
    console.log(JSON.stringify({ mode, result: 'SEEDED', baseline }));
  } finally {
    await prisma.$disconnect();
  }
} else if (mode === 'current-create') {
  const [
    { createKnowledgeShareUseCases },
    { createKnowledgeShareTokenCodec },
    { prismaKnowledgeShareAdapter },
  ] = await Promise.all([
    import(
      pathToFileURL(
        `${currentRoot}/packages/backend/dist/application/knowledge/knowledgeShareUseCases.js`,
      ).href
    ),
    import(
      pathToFileURL(
        `${currentRoot}/packages/backend/dist/application/knowledge/knowledgeShareToken.js`,
      ).href
    ),
    import(
      pathToFileURL(
        `${currentRoot}/packages/backend/dist/adapters/knowledge/prismaKnowledgeShareAdapter.js`,
      ).href
    ),
  ]);
  const prisma = currentPrisma();
  try {
    const actor = {
      userId: ownerId,
      groupAccountIds: [],
    };
    const chatActor = {
      canonicalUserId: ownerId,
      userId: ownerId,
      roles: ['user'],
      projectIds: [],
      groupIds: [],
      groupAccountIds: [],
    };
    const auditActor = {
      requestId: 'knowledge-share-old-app-current-create',
      source: 'api',
      principalUserId: ownerId,
      actorUserId: ownerId,
    };
    const selection = {
      includeTitle: false,
      includeSourceType: true,
      includeCanonicalUrl: false,
      snapshot: null,
      labelAssignmentIds: [],
      annotations: [],
      conversationTurnIds: [],
      syntheses: [],
      sharerNote: null,
    };
    const service = createKnowledgeShareUseCases({
      store: prismaKnowledgeShareAdapter,
      chatIntegration: prismaKnowledgeShareAdapter,
      tokenCodec: createKnowledgeShareTokenCodec({
        env: { NODE_ENV: 'test' },
        randomId: () => shareId,
      }),
    });
    const preview = await service.preview({
      actor,
      chatActor,
      auditActor,
      itemId: sourceItemId,
      body: { destinationRoomId: roomId, selection },
    });
    assert.equal(preview.ok, true, JSON.stringify(preview));
    const committed = await service.commit({
      actor,
      chatActor,
      auditActor,
      itemId: sourceItemId,
      body: {
        destinationRoomId: roomId,
        selection,
        previewToken: preview.value.previewToken,
        requestKey: 'synthetic-old-app-compat-request',
        confirmed: true,
      },
    });
    assert.equal(committed.ok, true, JSON.stringify(committed));
    assert.equal(committed.value.status, 'posted');
    assert.equal(committed.value.shareId, shareId);
    assert.equal(committed.value.chatMessageId, shareMessageId);
    const message = await prisma.chatMessage.findUniqueOrThrow({
      where: { id: shareMessageId },
    });
    assert.equal(message.messageType, 'text');
    assert.equal(message.body, genericBody);
    const notification = await prisma.appNotification.findFirst({
      where: {
        userId: viewerId,
        kind: 'chat_message',
        messageId: shareMessageId,
      },
    });
    assert.ok(notification);
    assert.equal(JSON.stringify(notification).includes(privateCanary), false);
    const enumRows = await prisma.$queryRaw`
      SELECT enumlabel
      FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'ChatMessageType'
      ORDER BY enumsortorder
    `;
    assert.deepEqual(
      enumRows.map((row) => row.enumlabel),
      ['text'],
    );
    console.log(
      JSON.stringify({
        mode,
        result: 'PASS',
        sideTableDiscriminator: true,
        genericTextRoot: true,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
} else if (mode === 'old-after') {
  const [{ buildServer }] = await Promise.all([
    oldLoad('packages/backend/dist/server.js'),
  ]);
  const prisma = oldPrisma();
  let server;
  try {
    await prisma.chatMessage.create({
      data: {
        id: oldWriteMessageId,
        roomId,
        userId: ownerId,
        body: 'Synthetic old application write after migration',
        createdAt: new Date('2026-08-10T00:02:00.000Z'),
      },
    });

    server = await buildServer({ logger: false });
    const headers = { 'x-user-id': viewerId, 'x-roles': 'user' };
    const health = await server.inject({ method: 'GET', url: '/healthz' });
    const ready = await server.inject({ method: 'GET', url: '/readyz' });
    assert.equal(health.statusCode, 200, health.body);
    assert.equal(ready.statusCode, 200, ready.body);

    const timeline = await server.inject({
      method: 'GET',
      url: `/chat-rooms/${roomId}/messages?limit=20`,
      headers,
    });
    assert.equal(timeline.statusCode, 200, timeline.body);
    const timelineItems = timeline.json().items;
    assert.ok(timelineItems.some((item) => item.id === legacyMessageId));
    const shareMessage = timelineItems.find(
      (item) => item.id === shareMessageId,
    );
    assert.ok(shareMessage);
    assert.equal(shareMessage.messageType, 'text');
    assert.equal(shareMessage.body, genericBody);
    assert.equal(shareMessage.parentMessageId, null);
    assert.equal(shareMessage.threadRootId, null);
    assert.doesNotMatch(
      JSON.stringify(timeline.json()),
      new RegExp(privateCanary),
    );

    const thread = await server.inject({
      method: 'GET',
      url: `/chat-messages/${shareMessageId}/thread?limit=20`,
      headers,
    });
    assert.equal(thread.statusCode, 200, thread.body);
    assert.equal(thread.json().root.id, shareMessageId);
    assert.equal(thread.json().root.body, genericBody);
    assert.deepEqual(thread.json().replies, []);

    const search = await server.inject({
      method: 'GET',
      url: '/chat-messages/search?q=Knowledge&limit=20',
      headers,
    });
    assert.equal(search.statusCode, 200, search.body);
    const searchItem = search
      .json()
      .items.find((item) => item.id === shareMessageId);
    assert.ok(searchItem);
    assert.equal(searchItem.body, genericBody);
    assert.doesNotMatch(
      JSON.stringify(search.json()),
      new RegExp(privateCanary),
    );

    const unread = await server.inject({
      method: 'GET',
      url: `/chat-rooms/${roomId}/unread`,
      headers,
    });
    assert.equal(unread.statusCode, 200, unread.body);
    assert.ok(unread.json().unreadCount >= 1);

    const notifications = await server.inject({
      method: 'GET',
      url: '/notifications?unread=1&limit=200',
      headers,
    });
    assert.equal(notifications.statusCode, 200, notifications.body);
    const notification = notifications
      .json()
      .items.find((item) => item.messageId === shareMessageId);
    assert.ok(notification);
    assert.doesNotMatch(
      JSON.stringify(notifications.json()),
      new RegExp(privateCanary),
    );

    console.log(
      JSON.stringify({
        mode,
        result: 'PASS',
        timeline: true,
        thread: true,
        search: true,
        unread: true,
        notification: true,
        healthReadiness: true,
        oldWrite: true,
      }),
    );
  } finally {
    if (server) await server.close();
    await prisma.$disconnect();
  }
} else {
  const [
    { createPrismaKnowledgeShareAdapter },
    { createPrismaChatThreadRepository },
  ] = await Promise.all([
    import(
      pathToFileURL(
        `${currentRoot}/packages/backend/dist/adapters/knowledge/prismaKnowledgeShareAdapter.js`,
      ).href
    ),
    import(
      pathToFileURL(
        `${currentRoot}/packages/backend/dist/adapters/chat/prismaChatThreadAdapter.js`,
      ).href
    ),
  ]);
  const prisma = currentPrisma();
  try {
    const share = await prisma.knowledgeShare.findUniqueOrThrow({
      where: { id: shareId },
      include: { chatMessage: true },
    });
    assert.equal(share.status, 'posted');
    assert.equal(share.chatMessageId, shareMessageId);
    assert.equal(share.chatMessage.messageType, 'text');
    assert.equal(share.chatMessage.body, genericBody);
    assert.equal(share.selectedTitle, null);
    assert.equal(share.selectedCanonicalUrl, null);
    assert.equal(share.selectedSharerNote, null);

    const viewerChatActor = {
      canonicalUserId: viewerId,
      userId: viewerId,
      roles: ['user'],
      projectIds: [],
      groupIds: [],
      groupAccountIds: [],
    };
    const card = await createPrismaKnowledgeShareAdapter({
      $transaction: (...args) => prisma.$transaction(...args),
    }).readRoomCard({
      actor: { userId: viewerId, groupAccountIds: [] },
      chatActor: viewerChatActor,
      messageId: shareMessageId,
    });
    assert.equal(card.ok, true, JSON.stringify(card));
    assert.equal(card.value.status, 'posted');
    assert.equal(card.value.canOpenSource, false);
    assert.equal(card.value.card.sourceType, 'manual');
    assert.equal(card.value.card.title, undefined);
    assert.equal(JSON.stringify(card.value).includes(privateCanary), false);

    const summaries = await createPrismaChatThreadRepository(
      prisma,
    ).listKnowledgeShareSummaries({
      actor: viewerChatActor,
      roomId,
      messageIds: [legacyMessageId, shareMessageId, oldWriteMessageId],
    });
    assert.ok(summaries);
    const currentShareRoot = summaries.find(
      (message) => message.messageId === shareMessageId,
    );
    assert.ok(currentShareRoot);
    assert.deepEqual(currentShareRoot, {
      messageId: shareMessageId,
      shareId,
      status: 'posted',
      version: 2,
      schemaVersion: 1,
    });

    const oldWrite = await prisma.chatMessage.findUniqueOrThrow({
      where: { id: oldWriteMessageId },
    });
    assert.equal(oldWrite.messageType, 'text');
    assert.equal(oldWrite.parentMessageId, null);
    assert.equal(oldWrite.threadRootId, null);

    const counts = await Promise.all([
      prisma.knowledgeShare.count({ where: { id: shareId } }),
      prisma.chatMessage.count({ where: { id: shareMessageId } }),
    ]);
    assert.deepEqual(counts, [1, 1]);

    const source = await prisma.knowledgeItem.findUniqueOrThrow({
      where: { id: sourceItemId },
      select: { version: true, updatedAt: true },
    });
    const pendingData = (
      id,
      requestHash,
      selectionHash,
      contentHash,
      includeScalar = true,
    ) => ({
      id,
      sourceKnowledgeItemId: sourceItemId,
      sourceOwnerUserId: ownerId,
      sharerUserId: ownerId,
      chatPosterUserId: ownerId,
      destinationRoomId: roomId,
      selectionSchemaVersion: 1,
      requestKeyHash: requestHash,
      requestPayloadHash: requestHash,
      selectionHash,
      contentHash,
      sourceItemVersion: source.version,
      sourceItemUpdatedAt: source.updatedAt,
      ...(includeScalar ? { selectedSourceType: 'manual' } : {}),
      createdBy: ownerId,
      updatedBy: ownerId,
    });

    await assert.rejects(
      prisma.$executeRaw`
        INSERT INTO "KnowledgeShare" (
          "id", "sourceKnowledgeItemId", "sourceOwnerUserId", "sharerUserId",
          "chatPosterUserId", "destinationRoomId", "selectionSchemaVersion", "requestKeyHash",
          "requestPayloadHash", "selectionHash", "contentHash",
          "sourceItemVersion", "sourceItemUpdatedAt", "createdBy", "updatedAt",
          "updatedBy"
        ) VALUES (
          'share-old-app-empty-selection', ${sourceItemId}, ${ownerId}, ${ownerId},
          ${ownerId}, ${roomId}, 1, ${hex('d')}, ${hex('d')}, ${hex('e')}, ${hex('f')},
          ${source.version}, ${source.updatedAt}, ${ownerId}, CURRENT_TIMESTAMP,
          ${ownerId}
        )
      `,
    );

    const annotationId = 'share-old-app-stale-annotation';
    const annotationRevisionId = 'share-old-app-stale-annotation-revision';
    const annotationShareId = '22222222-3333-4444-8555-666666666666';
    await prisma.knowledgeAnnotation.create({
      data: {
        id: annotationId,
        knowledgeItemId: sourceItemId,
        ownerUserId: ownerId,
        authorUserId: ownerId,
        scope: 'personal',
        kind: 'note',
        origin: 'user',
        currentRevision: 2,
        createdBy: ownerId,
        updatedBy: ownerId,
        revisions: {
          create: [
            {
              id: annotationRevisionId,
              revision: 1,
              kind: 'note',
              origin: 'user',
              content: 'Synthetic superseded annotation revision',
              createdBy: ownerId,
            },
            {
              id: 'share-old-app-current-annotation-revision',
              revision: 2,
              kind: 'note',
              origin: 'user',
              content: 'Synthetic current annotation revision',
              createdBy: ownerId,
            },
          ],
        },
      },
    });
    await prisma.knowledgeShare.create({
      data: pendingData(annotationShareId, hex('5'), hex('6'), hex('7')),
    });
    await assert.rejects(
      prisma.knowledgeShareAnnotationSnapshot.create({
        data: {
          shareId: annotationShareId,
          sourceKnowledgeItemId: sourceItemId,
          sourceOwnerUserId: ownerId,
          sourceAnnotationId: annotationId,
          sourceRevisionId: annotationRevisionId,
          revision: 1,
          kind: 'note',
          origin: 'user',
          content: 'Synthetic superseded annotation revision',
          ordinal: 0,
          contentHash: hex('8'),
          createdBy: ownerId,
        },
      }),
    );

    const nestedShareId = '44444444-5555-4666-8777-888888888888';
    await prisma.$transaction(async (tx) => {
      await tx.knowledgeShare.create({
        data: pendingData(nestedShareId, hex('0'), hex('1'), hex('2'), false),
      });
      await tx.knowledgeShareAnnotationSnapshot.create({
        data: {
          shareId: nestedShareId,
          sourceKnowledgeItemId: sourceItemId,
          sourceOwnerUserId: ownerId,
          sourceAnnotationId: annotationId,
          sourceRevisionId: 'share-old-app-current-annotation-revision',
          revision: 2,
          kind: 'note',
          origin: 'user',
          content: 'Synthetic current annotation revision',
          ordinal: 0,
          contentHash: hex('2'),
          createdBy: ownerId,
        },
      });
    });

    const synthesisId = 'share-old-app-stale-synthesis';
    const synthesisVersionId = 'share-old-app-stale-synthesis-version';
    const synthesisShareId = '33333333-4444-4555-8666-777777777777';
    await prisma.knowledgeSynthesis.create({
      data: {
        id: synthesisId,
        ownerUserId: ownerId,
        scope: 'personal',
        title: 'Synthetic synthesis',
        currentVersion: 2,
        createdBy: ownerId,
        updatedBy: ownerId,
        versions: {
          create: [
            {
              id: synthesisVersionId,
              version: 1,
              content: 'Synthetic superseded synthesis',
              unresolvedQuestions: [],
              createdBy: ownerId,
            },
            {
              id: 'share-old-app-current-synthesis-version',
              version: 2,
              content: 'Synthetic current synthesis',
              unresolvedQuestions: [],
              createdBy: ownerId,
            },
          ],
        },
      },
    });
    await prisma.knowledgeShare.create({
      data: pendingData(synthesisShareId, hex('9'), hex('a'), hex('b')),
    });
    await assert.rejects(
      prisma.knowledgeShareSynthesisSnapshot.create({
        data: {
          shareId: synthesisShareId,
          sourceKnowledgeItemId: sourceItemId,
          sourceOwnerUserId: ownerId,
          sourceSynthesisId: synthesisId,
          sourceSynthesisVersionId: synthesisVersionId,
          version: 1,
          title: 'Synthetic synthesis',
          content: 'Synthetic superseded synthesis',
          unresolvedQuestions: [],
          ordinal: 0,
          contentHash: hex('c'),
          createdBy: ownerId,
        },
      }),
    );

    await assert.rejects(
      prisma.auditLog.create({
        data: {
          action: 'knowledge_share_posted',
          targetTable: 'chat_messages',
          targetId: shareId,
        },
      }),
    );
    await prisma.auditLog.create({
      data: {
        action: 'knowledge_share_posted',
        targetTable: 'knowledge_shares',
        targetId: shareId,
      },
    });
    console.log(
      JSON.stringify({
        mode,
        result: 'PASS',
        postedReferenceRetained: true,
        oldApplicationDefaultRetained: true,
        selectedPrivateCanaryStored: false,
        roomOnlyCardRead: true,
        compactTimelineDiscriminator: true,
        staleAnnotationRevisionRejected: true,
        staleSynthesisVersionRejected: true,
        auditTargetConstraint: true,
        directEmptySelectionRejected: true,
        deferredNestedSelectionAccepted: true,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}
