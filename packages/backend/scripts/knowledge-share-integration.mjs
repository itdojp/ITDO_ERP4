import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;

function parseDatabaseUrl(value) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

const databaseUrl = parseDatabaseUrl(process.env.DATABASE_URL);
if (
  process.env.KNOWLEDGE_SHARE_INTEGRATION_CONFIRM !== '1' ||
  !databaseUrl ||
  !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== '/erp4_knowledge_share_test'
) {
  throw new Error(
    'Refusing to run outside the confirmed loopback erp4_knowledge_share_test database',
  );
}

const [
  { prisma },
  { createPrismaKnowledgeShareAdapter },
  { createKnowledgeShareUseCases },
  { createKnowledgeShareTokenCodec },
  { createChatMessageLifecycleService },
] = await Promise.all([
  import('../dist/services/db.js'),
  import('../dist/adapters/knowledge/prismaKnowledgeShareAdapter.js'),
  import('../dist/application/knowledge/knowledgeShareUseCases.js'),
  import('../dist/application/knowledge/knowledgeShareToken.js'),
  import('../dist/services/chatMessageLifecycle.js'),
]);

const adapter = createPrismaKnowledgeShareAdapter(prisma);
const actor = {
  userId: 'knowledge-share-owner',
  organizationId: 'knowledge-share-org',
  groupAccountIds: [],
};
const outsider = {
  userId: 'knowledge-share-outsider',
  organizationId: 'knowledge-share-org',
  groupAccountIds: [],
};
const chatActor = {
  canonicalUserId: actor.userId,
  userId: actor.userId,
  roles: ['user'],
  projectIds: [],
  groupIds: [],
  groupAccountIds: [],
};
const outsiderChatActor = {
  ...chatActor,
  canonicalUserId: outsider.userId,
  userId: outsider.userId,
};
const viewerUserId = 'knowledge-share-viewer-group-user';
const auditActor = {
  requestId: 'knowledge-share-integration',
  source: 'api',
  principalUserId: actor.userId,
  actorUserId: actor.userId,
  authScopes: ['knowledge:write', 'chat:write'],
};
const roomId = randomUUID();
const selectedCanary = 'SELECTED_ANNOTATION_SYNTHETIC';
const unselectedCanaries = [
  'PRIVATE_LABEL_CANARY',
  'UNSELECTED_ANNOTATION_CANARY',
  'UNSELECTED_SYSTEM_TURN_CANARY',
  'UNSELECTED_TOOL_TURN_CANARY',
  'UNSELECTED_SYNTHESIS_CANARY',
  'PRIVATE_SNAPSHOT_FULL_CANARY',
  'PRIVATE_URL_QUERY_CANARY',
];

function expectOk(result, context) {
  assert.equal(
    result.ok,
    true,
    `${context}: ${JSON.stringify(result.ok ? result.value : result.error)}`,
  );
  return result.value;
}

function expectFailure(result, code, context) {
  assert.equal(result.ok, false, context);
  assert.equal(result.error.code, code, context);
  return result.error;
}

function requestKeyHash(character) {
  return character.repeat(64);
}

function requestPayloadHash(character) {
  return character.repeat(64);
}

function opaqueHash(label) {
  return createHash('sha256').update(label, 'utf8').digest('hex');
}

async function createPendingFromPreview({
  preview,
  selection,
  shareId = randomUUID(),
  keyHash,
  payloadHash,
  adapterOverride = adapter,
}) {
  return adapterOverride.createPending({
    actor,
    chatActor,
    auditActor,
    itemId: preview.sourceItemId,
    destinationRoomId: preview.destinationRoomId,
    selection,
    expectedBindingHash: preview.bindingHash,
    requestKeyHash: keyHash,
    requestPayloadHash: payloadHash,
    shareId,
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
        id: outsider.userId,
        userName: outsider.userId,
        active: true,
        organization: outsider.organizationId,
      },
      {
        id: viewerUserId,
        userName: viewerUserId,
        active: true,
        organization: actor.organizationId,
      },
    ],
  });
  const viewerGroup = await prisma.groupAccount.create({
    data: {
      id: randomUUID(),
      displayName: 'Synthetic Knowledge share viewers',
      active: true,
    },
  });
  await prisma.userGroup.create({
    data: { userId: viewerUserId, groupId: viewerGroup.id },
  });
  await prisma.chatRoom.create({
    data: {
      id: roomId,
      type: 'private_group',
      name: 'Synthetic Knowledge share room',
      isOfficial: true,
      viewerGroupIds: [viewerGroup.id],
      allowExternalUsers: false,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    },
  });
  await prisma.chatRoomMember.createMany({
    data: [
      { roomId, userId: actor.userId },
      { roomId, userId: outsider.userId },
    ],
  });
  const item = await prisma.knowledgeItem.create({
    data: {
      id: randomUUID(),
      ownerUserId: actor.userId,
      scope: 'personal',
      sourceType: 'web',
      title: 'Selected synthetic title',
      canonicalUrl: `https://source-user:source-password@example.test/article?private=${unselectedCanaries[6]}#fragment-secret`,
      shortNote: 'PRIVATE_ITEM_NOTE_CANARY',
      createdBy: actor.userId,
      updatedBy: actor.userId,
    },
  });
  const sourceArtifact = await prisma.storageArtifact.create({
    data: {
      id: randomUUID(),
      context: 'knowledge-snapshot',
      provider: 'local',
      providerKey: `synthetic/${randomUUID()}`,
      status: 'ready',
      originalName: 'synthetic.txt',
      contentType: 'text/plain',
      sizeBytes: 8192n,
      sha256: '1'.repeat(64),
      ownerType: 'knowledge-item',
      ownerId: item.id,
      createdBy: actor.userId,
    },
  });
  const sourceSnapshot = await prisma.knowledgeSnapshot.create({
    data: {
      id: randomUUID(),
      knowledgeItemId: item.id,
      artifactId: sourceArtifact.id,
      version: 1,
      status: 'ready',
      captureMethod: 'text',
      originalName: 'synthetic.txt',
      contentType: 'text/plain',
      sizeBytes: 8192n,
      extractedText: `Selected excerpt ${'x'.repeat(5000)} ${unselectedCanaries[5]}`,
      sha256: '1'.repeat(64),
      requestKeyHash: '2'.repeat(64),
      requestPayloadHash: '3'.repeat(64),
      capturedBy: actor.userId,
      readyAt: new Date(),
    },
  });

  const selectedLabel = await prisma.knowledgeLabel.create({
    data: {
      id: randomUUID(),
      scope: 'personal',
      ownerUserId: actor.userId,
      displayName: 'Selected label',
      slug: `selected-${randomUUID()}`,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    },
  });
  const privateLabel = await prisma.knowledgeLabel.create({
    data: {
      id: randomUUID(),
      scope: 'personal',
      ownerUserId: actor.userId,
      displayName: unselectedCanaries[0],
      slug: `private-${randomUUID()}`,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    },
  });
  const selectedAssignment = await prisma.knowledgeItemLabel.create({
    data: {
      id: randomUUID(),
      knowledgeItemId: item.id,
      labelId: selectedLabel.id,
      assignmentSource: 'manual',
      assignedBy: actor.userId,
    },
  });
  await prisma.knowledgeItemLabel.create({
    data: {
      id: randomUUID(),
      knowledgeItemId: item.id,
      labelId: privateLabel.id,
      assignmentSource: 'manual',
      assignedBy: actor.userId,
    },
  });

  const selectedAnnotation = await prisma.knowledgeAnnotation.create({
    data: {
      id: randomUUID(),
      knowledgeItemId: item.id,
      ownerUserId: actor.userId,
      authorUserId: actor.userId,
      scope: 'personal',
      organizationId: null,
      kind: 'note',
      origin: 'user',
      createdBy: actor.userId,
      updatedBy: actor.userId,
      revisions: {
        create: {
          id: randomUUID(),
          revision: 1,
          kind: 'note',
          origin: 'user',
          content: selectedCanary,
          createdBy: actor.userId,
        },
      },
    },
  });
  await prisma.knowledgeAnnotation.create({
    data: {
      id: randomUUID(),
      knowledgeItemId: item.id,
      ownerUserId: actor.userId,
      authorUserId: actor.userId,
      scope: 'personal',
      organizationId: null,
      kind: 'question',
      origin: 'user',
      createdBy: actor.userId,
      updatedBy: actor.userId,
      revisions: {
        create: {
          id: randomUUID(),
          revision: 1,
          kind: 'question',
          origin: 'user',
          content: unselectedCanaries[1],
          createdBy: actor.userId,
        },
      },
    },
  });

  const conversation = await prisma.knowledgeConversation.create({
    data: {
      id: randomUUID(),
      ownerUserId: actor.userId,
      title: 'Synthetic conversation',
      sourceType: 'manual',
      contentHash: '4'.repeat(64),
      createdBy: actor.userId,
      updatedBy: actor.userId,
      items: {
        create: {
          id: randomUUID(),
          knowledgeItemId: item.id,
          relationType: 'primary',
          ordinal: 0,
          createdBy: actor.userId,
        },
      },
      turns: {
        create: [
          {
            id: randomUUID(),
            sequence: 1,
            role: 'assistant',
            origin: 'ai',
            content: 'SELECTED_AI_TURN_SYNTHETIC',
            contentHash: '5'.repeat(64),
            createdBy: actor.userId,
          },
          {
            id: randomUUID(),
            sequence: 2,
            role: 'system',
            origin: 'system',
            content: unselectedCanaries[2],
            contentHash: '6'.repeat(64),
            createdBy: actor.userId,
          },
          {
            id: randomUUID(),
            sequence: 3,
            role: 'tool',
            origin: 'tool',
            name: 'search',
            content: unselectedCanaries[3],
            contentHash: '7'.repeat(64),
            createdBy: actor.userId,
          },
        ],
      },
    },
    include: { turns: { orderBy: { sequence: 'asc' } } },
  });

  const selectedSynthesis = await prisma.knowledgeSynthesis.create({
    data: {
      id: randomUUID(),
      ownerUserId: actor.userId,
      scope: 'personal',
      title: 'Selected synthesis',
      createdBy: actor.userId,
      updatedBy: actor.userId,
      versions: {
        create: {
          id: randomUUID(),
          version: 1,
          content: 'SELECTED_SYNTHESIS_CONTENT',
          unresolvedQuestions: ['Selected unresolved question'],
          confidenceBasisPoints: 7500,
          createdBy: actor.userId,
          sources: {
            create: {
              relationType: 'primary',
              ordinal: 0,
              sourceKnowledgeItemId: item.id,
              createdBy: actor.userId,
            },
          },
        },
      },
    },
  });
  await prisma.knowledgeSynthesis.create({
    data: {
      id: randomUUID(),
      ownerUserId: actor.userId,
      scope: 'personal',
      title: unselectedCanaries[4],
      createdBy: actor.userId,
      updatedBy: actor.userId,
      versions: {
        create: {
          id: randomUUID(),
          version: 1,
          content: unselectedCanaries[4],
          unresolvedQuestions: [],
          createdBy: actor.userId,
          sources: {
            create: {
              relationType: 'primary',
              ordinal: 0,
              sourceKnowledgeItemId: item.id,
              createdBy: actor.userId,
            },
          },
        },
      },
    },
  });
  const emptyQuestionSynthesis = await prisma.knowledgeSynthesis.create({
    data: {
      id: randomUUID(),
      ownerUserId: actor.userId,
      scope: 'personal',
      title: 'Synthetic empty-question synthesis',
      createdBy: actor.userId,
      updatedBy: actor.userId,
      versions: {
        create: {
          id: randomUUID(),
          version: 1,
          content: 'Synthetic conclusion',
          unresolvedQuestions: [''],
          createdBy: actor.userId,
          sources: {
            create: {
              relationType: 'primary',
              ordinal: 0,
              sourceKnowledgeItemId: item.id,
              createdBy: actor.userId,
            },
          },
        },
      },
    },
  });

  const selection = {
    includeTitle: true,
    includeSourceType: true,
    includeCanonicalUrl: true,
    snapshot: {
      snapshotId: sourceSnapshot.id,
      includeProvenance: true,
      includeExcerpt: true,
    },
    labelAssignmentIds: [selectedAssignment.id],
    annotations: [{ annotationId: selectedAnnotation.id, revision: 1 }],
    conversationTurnIds: [conversation.turns[0].id],
    syntheses: [{ synthesisId: selectedSynthesis.id, version: 1 }],
    sharerNote: 'Selected sharer note',
  };

  const preview = expectOk(
    await adapter.preview({
      actor,
      chatActor,
      auditActor,
      shareId: randomUUID(),
      itemId: item.id,
      destinationRoomId: roomId,
      selection,
    }),
    'selective preview',
  );
  expectFailure(
    await adapter.preview({
      actor,
      chatActor,
      auditActor,
      shareId: randomUUID(),
      itemId: item.id,
      destinationRoomId: roomId,
      selection: {
        includeTitle: false,
        includeSourceType: false,
        includeCanonicalUrl: false,
        snapshot: null,
        labelAssignmentIds: [],
        annotations: [],
        conversationTurnIds: [],
        syntheses: [{ synthesisId: emptyQuestionSynthesis.id, version: 1 }],
        sharerNote: null,
      },
    }),
    'not_found',
    'empty unresolved synthesis question is rejected before persistence',
  );
  assert.equal(preview.snapshot.canonicalUrl, 'https://example.test/article');
  assert.equal(preview.snapshot.labels.length, 1);
  assert.equal(preview.snapshot.annotations.length, 1);
  assert.equal(preview.snapshot.turns.length, 1);
  assert.equal(preview.snapshot.syntheses.length, 1);
  for (const canary of unselectedCanaries) {
    assert.equal(JSON.stringify(preview.snapshot).includes(canary), false);
  }

  for (const canonicalUrl of [
    'https://drive.google.com/file/d/PRIVATE_PROVIDER_IDENTIFIER/view',
    'https://drive.google.com./file/d/PRIVATE_PROVIDER_IDENTIFIER/view',
    'https://drive.google.com%2e/file/d/PRIVATE_PROVIDER_IDENTIFIER/view',
    'https://drive。google。com/file/d/PRIVATE_PROVIDER_IDENTIFIER/view',
    'https://docs.google.com./document/d/PRIVATE_PROVIDER_IDENTIFIER/edit',
    'https://storage.googleapis.com./private/private-object',
    'https://private.storage.googleapis.com./private-object',
  ]) {
    const providerUrlItem = await prisma.knowledgeItem.create({
      data: {
        id: randomUUID(),
        ownerUserId: actor.userId,
        scope: 'personal',
        sourceType: 'web',
        canonicalUrl,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      },
    });
    expectFailure(
      await adapter.preview({
        actor,
        chatActor,
        auditActor,
        shareId: randomUUID(),
        itemId: providerUrlItem.id,
        destinationRoomId: roomId,
        selection: {
          includeTitle: false,
          includeSourceType: false,
          includeCanonicalUrl: true,
          snapshot: null,
          labelAssignmentIds: [],
          annotations: [],
          conversationTurnIds: [],
          syntheses: [],
          sharerNote: null,
        },
      }),
      'invalid_request',
      'provider URL identifiers are never shared',
    );
  }

  const pending = expectOk(
    await createPendingFromPreview({
      preview,
      selection,
      keyHash: requestKeyHash('a'),
      payloadHash: requestPayloadHash('b'),
    }),
    'create pending share',
  );
  assert.equal(pending.status, 'pending');
  assert.equal(pending.created, true);

  const persisted = await prisma.knowledgeShare.findUniqueOrThrow({
    where: { id: pending.shareId },
    include: {
      snapshot: true,
      labels: true,
      annotations: true,
      turns: true,
      syntheses: true,
    },
  });
  assert.equal(persisted.labels.length, 1);
  assert.equal(persisted.annotations.length, 1);
  assert.equal(persisted.turns.length, 1);
  assert.equal(persisted.syntheses.length, 1);
  for (const canary of unselectedCanaries) {
    assert.equal(JSON.stringify(persisted).includes(canary), false);
  }

  const replay = expectOk(
    await createPendingFromPreview({
      preview,
      selection,
      shareId: randomUUID(),
      keyHash: requestKeyHash('a'),
      payloadHash: requestPayloadHash('b'),
    }),
    'same key and payload replay',
  );
  assert.equal(replay.shareId, pending.shareId);
  assert.equal(replay.created, false);
  expectFailure(
    await createPendingFromPreview({
      preview,
      selection,
      shareId: randomUUID(),
      keyHash: requestKeyHash('a'),
      payloadHash: requestPayloadHash('c'),
    }),
    'idempotency_conflict',
    'same key with different payload',
  );
  expectFailure(
    await createPendingFromPreview({
      preview,
      selection,
      shareId: pending.shareId,
      keyHash: requestKeyHash('5'),
      payloadHash: requestPayloadHash('b'),
    }),
    'idempotency_conflict',
    'same preview token share ID with a different request key',
  );

  const concurrentPreview = expectOk(
    await adapter.resolveForCommit({
      actor,
      chatActor,
      itemId: item.id,
      destinationRoomId: roomId,
      selection,
    }),
    'concurrent replay preview boundary',
  );
  const concurrentKey = requestKeyHash('d');
  const concurrentPayload = requestPayloadHash('e');
  const concurrent = await Promise.all([
    createPendingFromPreview({
      preview: concurrentPreview,
      selection,
      shareId: randomUUID(),
      keyHash: concurrentKey,
      payloadHash: concurrentPayload,
    }),
    createPendingFromPreview({
      preview: concurrentPreview,
      selection,
      shareId: randomUUID(),
      keyHash: concurrentKey,
      payloadHash: concurrentPayload,
    }),
  ]);
  assert.equal(
    concurrent.every((entry) => entry.ok),
    true,
  );
  assert.equal(new Set(concurrent.map((entry) => entry.value.shareId)).size, 1);
  assert.deepEqual(concurrent.map((entry) => entry.value.created).sort(), [
    false,
    true,
  ]);

  const posted = expectOk(
    await adapter.postPending({
      actor,
      chatActor,
      auditActor,
      shareId: pending.shareId,
      expectedBindingHash: preview.bindingHash,
    }),
    'atomic Chat root post',
  );
  assert.equal(posted.status, 'posted');
  assert.equal(posted.chatMessageId, pending.shareId);
  const message = await prisma.chatMessage.findUniqueOrThrow({
    where: { id: posted.chatMessageId },
  });
  assert.equal(message.messageType, 'text');
  assert.equal(message.body, 'Knowledge was shared.');
  assert.equal(message.parentMessageId, null);
  assert.equal(message.threadRootId, null);
  assert.equal(JSON.stringify(message).includes(selectedCanary), false);
  for (const canary of unselectedCanaries) {
    assert.equal(JSON.stringify(message).includes(canary), false);
  }
  const cardService = createKnowledgeShareUseCases({
    store: adapter,
    chatIntegration: adapter,
    tokenCodec: createKnowledgeShareTokenCodec({
      env: {
        NODE_ENV: 'test',
        KNOWLEDGE_CURSOR_SIGNING_SECRET:
          'knowledge-share-card-integration-secret-00001',
      },
      randomId: randomUUID,
    }),
  });
  const ownerCard = expectOk(
    await cardService.roomCard({
      actor,
      chatActor,
      messageId: posted.chatMessageId,
    }),
    'source owner Chat card read',
  );
  assert.equal(ownerCard.status, 'posted');
  assert.equal(ownerCard.canOpenSource, true);
  assert.equal(ownerCard.card.annotations[0].content, selectedCanary);
  assert.equal(ownerCard.card.canonicalUrl, 'https://example.test/article');
  const roomOnlyCard = expectOk(
    await cardService.roomCard({
      actor: outsider,
      chatActor: outsiderChatActor,
      messageId: posted.chatMessageId,
    }),
    'room-only viewer Chat card read',
  );
  assert.equal(roomOnlyCard.status, 'posted');
  assert.equal(roomOnlyCard.canOpenSource, false);
  assert.equal(roomOnlyCard.card.annotations[0].content, selectedCanary);
  const publicCardPayload = JSON.stringify(roomOnlyCard);
  for (const canary of unselectedCanaries) {
    assert.equal(publicCardPayload.includes(canary), false);
  }
  for (const internalValue of [
    item.id,
    sourceSnapshot.id,
    selectedAnnotation.id,
    conversation.turns[0].id,
    selectedSynthesis.id,
    sourceArtifact.providerKey,
  ]) {
    assert.equal(publicCardPayload.includes(internalValue), false);
  }
  for (const data of [
    { body: 'PRIVATE_CARD_CONTENT' },
    { userId: outsider.userId },
    {
      deletedAt: new Date(),
      deletedReason: 'user_retract',
    },
  ]) {
    await assert.rejects(
      () =>
        prisma.chatMessage.update({
          where: { id: posted.chatMessageId },
          data,
        }),
      /knowledge share chat root|immutable|P2004|P2010|P2039/i,
    );
  }
  await assert.rejects(
    () => prisma.chatMessage.delete({ where: { id: posted.chatMessageId } }),
    /knowledge share chat root|immutable|P2003|P2004|P2010|P2039/i,
  );
  const lifecycle = createChatMessageLifecycleService(prisma);
  assert.equal(
    await lifecycle.deleteMessage({
      messageId: posted.chatMessageId,
      actor: {
        userId: actor.userId,
        roles: ['user'],
        projectIds: [],
        groupIds: [],
        groupAccountIds: [],
      },
      reason: 'user_retract',
    }),
    null,
  );
  assert.equal(
    await lifecycle.deleteMessage({
      messageId: posted.chatMessageId,
      actor: {
        userId: outsider.userId,
        roles: ['admin'],
        projectIds: [],
        groupIds: [],
        groupAccountIds: [],
      },
      reason: 'admin_moderation',
    }),
    null,
  );
  assert.equal(
    (
      await prisma.chatMessage.findUniqueOrThrow({
        where: { id: posted.chatMessageId },
      })
    ).deletedAt,
    null,
  );
  await Promise.all([
    adapter.notifyPosted({
      actor,
      chatActor,
      auditActor,
      shareId: posted.shareId,
    }),
    adapter.notifyPosted({
      actor,
      chatActor,
      auditActor,
      shareId: posted.shareId,
    }),
  ]);
  const shareNotification = await prisma.appNotification.findFirst({
    where: { messageId: posted.chatMessageId, userId: outsider.userId },
  });
  assert.ok(shareNotification);
  assert.match(shareNotification.dedupeKey, /^[a-f0-9]{64}$/);
  const viewerGroupNotification = await prisma.appNotification.findFirst({
    where: { messageId: posted.chatMessageId, userId: viewerUserId },
  });
  assert.ok(viewerGroupNotification);
  assert.match(viewerGroupNotification.dedupeKey, /^[a-f0-9]{64}$/);
  assert.equal(
    JSON.stringify(shareNotification.payload).includes('Knowledge was shared.'),
    true,
  );
  for (const canary of [selectedCanary, ...unselectedCanaries]) {
    assert.equal(JSON.stringify(shareNotification).includes(canary), false);
  }
  const notificationCount = await prisma.appNotification.count({
    where: { messageId: posted.chatMessageId, kind: 'chat_message' },
  });
  await adapter.notifyPosted({
    actor,
    chatActor,
    auditActor,
    shareId: posted.shareId,
  });
  assert.equal(
    await prisma.appNotification.count({
      where: { messageId: posted.chatMessageId, kind: 'chat_message' },
    }),
    notificationCount,
  );
  assert.equal(notificationCount, 2);

  const replayItem = await prisma.knowledgeItem.create({
    data: {
      id: randomUUID(),
      ownerUserId: actor.userId,
      scope: 'personal',
      sourceType: 'manual',
      title: 'Idempotent replay synthetic title',
      createdBy: actor.userId,
      updatedBy: actor.userId,
    },
  });
  let replayNow = new Date('2026-08-10T01:00:00.000Z');
  const replayService = createKnowledgeShareUseCases({
    store: adapter,
    chatIntegration: adapter,
    tokenCodec: createKnowledgeShareTokenCodec({
      env: {
        NODE_ENV: 'test',
        KNOWLEDGE_CURSOR_SIGNING_SECRET:
          'knowledge-share-integration-secret-0000000001',
      },
      now: () => replayNow,
      randomId: randomUUID,
    }),
  });
  const replaySelection = {
    includeTitle: true,
    includeSourceType: false,
    includeCanonicalUrl: false,
    snapshot: null,
    labelAssignmentIds: [],
    annotations: [],
    conversationTurnIds: [],
    syntheses: [],
    sharerNote: null,
  };
  const useCasePreview = expectOk(
    await replayService.preview({
      actor,
      chatActor,
      auditActor,
      itemId: replayItem.id,
      body: { destinationRoomId: roomId, selection: replaySelection },
    }),
    'use-case idempotency preview',
  );
  const replayCommitBody = {
    destinationRoomId: roomId,
    selection: replaySelection,
    previewToken: useCasePreview.previewToken,
    requestKey: 'opaque-replay-key-synthetic',
    confirmed: true,
  };
  const firstUseCaseCommit = expectOk(
    await replayService.commit({
      actor,
      chatActor,
      auditActor,
      itemId: replayItem.id,
      body: replayCommitBody,
    }),
    'use-case first commit',
  );
  assert.equal(firstUseCaseCommit.status, 'posted');
  await prisma.knowledgeItem.update({
    where: { id: replayItem.id },
    data: {
      deletedAt: new Date('2026-08-10T01:01:00.000Z'),
      deletedReason: 'owner_request',
      version: { increment: 1 },
      updatedBy: actor.userId,
    },
  });
  replayNow = new Date('2026-08-10T01:11:00.000Z');
  const recoveredUseCaseCommit = expectOk(
    await replayService.commit({
      actor,
      chatActor,
      auditActor,
      itemId: replayItem.id,
      body: replayCommitBody,
    }),
    'expired-token and unavailable-source idempotent recovery',
  );
  assert.equal(recoveredUseCaseCommit.shareId, firstUseCaseCommit.shareId);
  assert.equal(recoveredUseCaseCommit.status, 'posted');
  assert.equal(recoveredUseCaseCommit.created, false);
  assert.equal(recoveredUseCaseCommit.reused, true);
  assert.equal(
    await prisma.chatMessage.count({
      where: { id: firstUseCaseCommit.chatMessageId },
    }),
    1,
  );

  const pendingReconcilePreview = expectOk(
    await adapter.resolveForCommit({
      actor,
      chatActor,
      itemId: item.id,
      destinationRoomId: roomId,
      selection,
    }),
    'pending reconcile preview boundary',
  );
  const pendingReconcile = expectOk(
    await createPendingFromPreview({
      preview: pendingReconcilePreview,
      selection,
      keyHash: requestKeyHash('f'),
      payloadHash: requestPayloadHash('0'),
    }),
    'pending reconcile share',
  );
  const messageCountBeforeReconcile = await prisma.chatMessage.count();
  const reconciledPending = expectOk(
    await adapter.reconcile({
      actor,
      chatActor,
      auditActor,
      shareId: pendingReconcile.shareId,
    }),
    'read-only pending reconcile',
  );
  assert.equal(reconciledPending.status, 'pending');
  assert.equal(await prisma.chatMessage.count(), messageCountBeforeReconcile);

  const reconcileRacePreview = expectOk(
    await adapter.resolveForCommit({
      actor,
      chatActor,
      itemId: item.id,
      destinationRoomId: roomId,
      selection,
    }),
    'reconcile race preview boundary',
  );
  const reconcileRaceShare = expectOk(
    await createPendingFromPreview({
      preview: reconcileRacePreview,
      selection,
      keyHash: opaqueHash('knowledge-share-reconcile-race-key'),
      payloadHash: opaqueHash('knowledge-share-reconcile-race-payload'),
    }),
    'reconcile race pending share',
  );
  await prisma.chatMessage.create({
    data: {
      id: reconcileRaceShare.shareId,
      roomId,
      messageType: 'text',
      parentMessageId: null,
      threadRootId: null,
      userId: actor.userId,
      body: 'Knowledge was shared.',
      createdBy: actor.userId,
      updatedBy: actor.userId,
    },
  });

  const raceUpdate = async ({ sql, values, context }) => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql, values);
      const outcomePromise = adapter
        .reconcile({
          actor,
          chatActor,
          auditActor,
          shareId: reconcileRaceShare.shareId,
        })
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      const observer = new Client({
        connectionString: process.env.DATABASE_URL,
      });
      await observer.connect();
      let reconcileIsBlocked = false;
      try {
        const waitStartedAt = Date.now();
        while (Date.now() - waitStartedAt < 5_000) {
          const blockingResult = await observer.query(
            `SELECT EXISTS (
               SELECT 1
                 FROM pg_stat_activity AS activity
                WHERE activity.datname = current_database()
                  AND activity.wait_event_type = 'Lock'
                  AND pg_blocking_pids(activity.pid) @> ARRAY[$1::integer]
             ) AS "reconcileIsBlocked"`,
            [client.processID],
          );
          reconcileIsBlocked =
            blockingResult.rows[0]?.reconcileIsBlocked === true;
          if (reconcileIsBlocked) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      } finally {
        await observer.end();
      }
      assert.equal(
        reconcileIsBlocked,
        true,
        `${context}: reconcile must reach the conflicting row lock`,
      );
      await client.query('COMMIT');
      const outcome = await outcomePromise;
      assert.equal('error' in outcome, false, context);
      assert.equal(outcome.value.ok, true, context);
      assert.equal(outcome.value.value.status, 'pending', context);
      assert.equal(
        (
          await prisma.knowledgeShare.findUniqueOrThrow({
            where: { id: reconcileRaceShare.shareId },
          })
        ).status,
        'pending',
        context,
      );
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  };

  await raceUpdate({
    sql: `UPDATE "ChatMessage"
             SET "body" = $1, "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = $2`,
    values: ['MUTATED_PENDING_SHARE_BODY', reconcileRaceShare.shareId],
    context: 'reconcile and body update cannot produce a posted invalid root',
  });
  await prisma.chatMessage.update({
    where: { id: reconcileRaceShare.shareId },
    data: { body: 'Knowledge was shared.', updatedBy: actor.userId },
  });
  await raceUpdate({
    sql: `UPDATE "ChatMessage"
             SET "deletedAt" = CURRENT_TIMESTAMP,
                 "deletedReason" = 'user_retract',
                 "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = $1`,
    values: [reconcileRaceShare.shareId],
    context:
      'reconcile and logical delete cannot produce a posted deleted root',
  });
  await prisma.chatMessage.update({
    where: { id: reconcileRaceShare.shareId },
    data: {
      deletedAt: null,
      deletedReason: null,
      updatedBy: actor.userId,
    },
  });
  assert.equal(
    expectOk(
      await adapter.reconcile({
        actor,
        chatActor,
        auditActor,
        shareId: reconcileRaceShare.shareId,
      }),
      'valid root remains reconcilable after guarded races',
    ).status,
    'posted',
  );

  const project = await prisma.project.create({
    data: {
      id: randomUUID(),
      code: `KS-${randomUUID()}`,
      name: 'Synthetic project-claim compatibility project',
      createdBy: actor.userId,
      updatedBy: actor.userId,
    },
  });
  const projectRoom = await prisma.chatRoom.create({
    data: {
      id: randomUUID(),
      type: 'project',
      name: 'Synthetic project share room',
      isOfficial: true,
      projectId: project.id,
      allowExternalUsers: false,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    },
  });
  const projectClaimChatActor = {
    ...chatActor,
    projectIds: [project.id],
  };
  const membershipService = createKnowledgeShareUseCases({
    store: adapter,
    chatIntegration: adapter,
    tokenCodec: createKnowledgeShareTokenCodec({
      env: {
        NODE_ENV: 'test',
        KNOWLEDGE_CURSOR_SIGNING_SECRET:
          'knowledge-share-project-claim-secret-0000001',
      },
      randomId: randomUUID,
    }),
  });
  const projectSelection = {
    includeTitle: true,
    includeSourceType: false,
    includeCanonicalUrl: false,
    snapshot: null,
    labelAssignmentIds: [],
    annotations: [],
    conversationTurnIds: [],
    syntheses: [],
    sharerNote: null,
  };
  const projectPreview = expectOk(
    await membershipService.preview({
      actor,
      chatActor: projectClaimChatActor,
      auditActor,
      itemId: item.id,
      body: {
        destinationRoomId: projectRoom.id,
        selection: projectSelection,
      },
    }),
    'current project-claim preview',
  );
  const sourceOpenPreview = expectOk(
    await membershipService.preview({
      actor,
      chatActor: projectClaimChatActor,
      auditActor,
      itemId: item.id,
      body: {
        destinationRoomId: projectRoom.id,
        selection: projectSelection,
      },
    }),
    'current project-claim source-open preview',
  );
  const sourceOpenShare = expectOk(
    await membershipService.commit({
      actor,
      chatActor: projectClaimChatActor,
      auditActor,
      itemId: item.id,
      body: {
        destinationRoomId: projectRoom.id,
        selection: projectSelection,
        previewToken: sourceOpenPreview.previewToken,
        requestKey: 'project-source-open-request',
        confirmed: true,
      },
    }),
    'current project-claim source-open commit',
  );
  assert.equal(sourceOpenShare.status, 'posted');
  assert.equal(
    expectOk(
      await adapter.openSource({
        actor,
        chatActor: projectClaimChatActor,
        shareId: sourceOpenShare.shareId,
      }),
      'current project-claim source-open',
    ).knowledgeItemId,
    item.id,
  );
  assert.equal(
    expectOk(
      await adapter.openSource({
        actor,
        chatActor: projectClaimChatActor,
        shareId: sourceOpenShare.shareId,
      }),
      'project claim remains the canonical Chat room policy without a ProjectMember row',
    ).knowledgeItemId,
    item.id,
  );
  const requestedBefore = await prisma.auditLog.count({
    where: { action: 'knowledge_share_requested' },
  });
  const sharesBefore = await prisma.knowledgeShare.count({
    where: { destinationRoomId: projectRoom.id },
  });
  const projectMessageCountBefore = await prisma.chatMessage.count({
    where: { roomId: projectRoom.id },
  });
  const projectCommit = expectOk(
    await membershipService.commit({
      actor,
      chatActor: projectClaimChatActor,
      auditActor,
      itemId: item.id,
      body: {
        destinationRoomId: projectRoom.id,
        selection: projectSelection,
        previewToken: projectPreview.previewToken,
        requestKey: 'project-claim-request',
        confirmed: true,
      },
    }),
    'project claim commit without ProjectMember row',
  );
  assert.equal(projectCommit.status, 'posted');
  assert.equal(
    await prisma.knowledgeShare.count({
      where: { destinationRoomId: projectRoom.id },
    }),
    sharesBefore + 1,
  );
  assert.equal(
    await prisma.auditLog.count({
      where: { action: 'knowledge_share_requested' },
    }),
    requestedBefore + 1,
  );
  assert.equal(
    await prisma.chatMessage.count({ where: { roomId: projectRoom.id } }),
    projectMessageCountBefore + 1,
  );
  await prisma.project.update({
    where: { id: project.id },
    data: {
      deletedAt: new Date(),
      deletedReason: 'synthetic_access_revocation',
      updatedBy: actor.userId,
    },
  });
  expectFailure(
    await adapter.openSource({
      actor,
      chatActor: projectClaimChatActor,
      shareId: sourceOpenShare.shareId,
    }),
    'not_found',
    'a logically deleted project cannot retain source-open access',
  );
  const deletedProjectPreview = await membershipService.preview({
    actor,
    chatActor: projectClaimChatActor,
    auditActor,
    itemId: item.id,
    body: {
      destinationRoomId: projectRoom.id,
      selection: projectSelection,
    },
  });
  assert.equal(
    deletedProjectPreview.ok,
    false,
    'a logically deleted project cannot accept a new share',
  );
  assert.equal(deletedProjectPreview.code, 'not_found');
  assert.equal(deletedProjectPreview.statusCode, 404);

  const failurePreview = expectOk(
    await adapter.resolveForCommit({
      actor,
      chatActor,
      itemId: item.id,
      destinationRoomId: roomId,
      selection,
    }),
    'known failure preview boundary',
  );
  const failurePending = expectOk(
    await createPendingFromPreview({
      preview: failurePreview,
      selection,
      keyHash: requestKeyHash('8'),
      payloadHash: requestPayloadHash('9'),
    }),
    'known failure pending share',
  );
  await prisma.chatRoom.update({
    where: { id: roomId },
    data: { allowExternalUsers: true, updatedBy: actor.userId },
  });
  const externalizedCard = await cardService.roomCard({
    actor: outsider,
    chatActor: outsiderChatActor,
    messageId: posted.chatMessageId,
  });
  assert.equal(externalizedCard.ok, false);
  assert.equal(externalizedCard.code, 'not_found');
  assert.equal(externalizedCard.statusCode, 404);
  expectFailure(
    await adapter.openSource({
      actor,
      chatActor,
      shareId: posted.shareId,
    }),
    'not_found',
    'externalized room cannot reveal source identity',
  );
  expectFailure(
    await adapter.postPending({
      actor,
      chatActor,
      auditActor,
      shareId: failurePending.shareId,
      expectedBindingHash: failurePreview.bindingHash,
    }),
    'share_post_failed',
    'external audience introduced after preview',
  );
  const failedShare = await prisma.knowledgeShare.findUniqueOrThrow({
    where: { id: failurePending.shareId },
  });
  assert.equal(failedShare.status, 'failed');
  assert.equal(failedShare.failureCode, 'post_rejected');
  await prisma.chatRoom.update({
    where: { id: roomId },
    data: { allowExternalUsers: false, updatedBy: actor.userId },
  });

  const stalePreview = expectOk(
    await adapter.resolveForCommit({
      actor,
      chatActor,
      itemId: item.id,
      destinationRoomId: roomId,
      selection,
    }),
    'annotation stale preview boundary',
  );
  await prisma.$transaction(async (transaction) => {
    await transaction.knowledgeAnnotationRevision.create({
      data: {
        id: randomUUID(),
        annotationId: selectedAnnotation.id,
        revision: 2,
        kind: 'note',
        origin: 'user',
        content: 'Revised selected annotation',
        createdBy: actor.userId,
      },
    });
    await transaction.knowledgeAnnotation.update({
      where: { id: selectedAnnotation.id },
      data: {
        currentRevision: 2,
        updatedBy: actor.userId,
      },
    });
  });
  expectFailure(
    await createPendingFromPreview({
      preview: stalePreview,
      selection,
      keyHash: requestKeyHash('a'),
      payloadHash: requestPayloadHash('f'),
    }),
    'idempotency_conflict',
    'existing idempotency key remains authoritative before stale source lookup',
  );
  expectFailure(
    await createPendingFromPreview({
      preview: stalePreview,
      selection,
      keyHash: requestKeyHash('1'),
      payloadHash: requestPayloadHash('2'),
    }),
    'not_found',
    'annotation revision changed after preview',
  );

  const currentSelection = {
    ...selection,
    annotations: [{ annotationId: selectedAnnotation.id, revision: 2 }],
  };
  const rollbackPreview = expectOk(
    await adapter.resolveForCommit({
      actor,
      chatActor,
      itemId: item.id,
      destinationRoomId: roomId,
      selection: currentSelection,
    }),
    'audit rollback preview boundary',
  );
  const rollbackShareId = randomUUID();
  const failingAdapter = createPrismaKnowledgeShareAdapter({
    $transaction(operation, options) {
      return prisma.$transaction(async (transaction) => {
        const wrapped = new Proxy(transaction, {
          get(target, property, receiver) {
            if (property === 'auditLog') {
              return {
                ...target.auditLog,
                async create(input) {
                  if (input.data.action === 'knowledge_share_requested') {
                    throw new Error('synthetic mandatory audit failure');
                  }
                  return target.auditLog.create(input);
                },
              };
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        return operation(wrapped);
      }, options);
    },
  });
  await assert.rejects(
    () =>
      createPendingFromPreview({
        preview: rollbackPreview,
        selection: currentSelection,
        shareId: rollbackShareId,
        keyHash: requestKeyHash('3'),
        payloadHash: requestPayloadHash('4'),
        adapterOverride: failingAdapter,
      }),
    /synthetic mandatory audit failure/,
  );
  assert.equal(
    await prisma.knowledgeShare.count({ where: { id: rollbackShareId } }),
    0,
  );

  const firstLabelSnapshot =
    await prisma.knowledgeShareLabelSnapshot.findFirstOrThrow({
      where: { shareId: posted.shareId },
    });
  await assert.rejects(
    () =>
      prisma.knowledgeShareLabelSnapshot.update({
        where: { id: firstLabelSnapshot.id },
        data: { displayName: 'Mutation must fail' },
      }),
    /immutable|P2010|P2004|P2025/i,
  );
  await assert.rejects(
    () =>
      prisma.knowledgeShareLabelSnapshot.delete({
        where: { id: firstLabelSnapshot.id },
      }),
    /immutable|P2010|P2004|P2025/i,
  );
  await assert.rejects(
    () =>
      prisma.knowledgeShare.update({
        where: { id: pendingReconcile.shareId },
        data: {
          status: 'posted',
          version: { increment: 1 },
          updatedBy: actor.userId,
        },
      }),
    /check|P2004|P2010/i,
  );

  for (const invalidMessage of [
    { body: 'PRIVATE_CARD_CONTENT', userId: actor.userId, deletedAt: null },
    { body: 'Knowledge was shared.', userId: outsider.userId, deletedAt: null },
    {
      body: 'Knowledge was shared.',
      userId: actor.userId,
      deletedAt: new Date(),
    },
  ]) {
    const messageId = randomUUID();
    await prisma.chatMessage.create({
      data: {
        id: messageId,
        roomId,
        userId: invalidMessage.userId,
        body: invalidMessage.body,
        deletedAt: invalidMessage.deletedAt,
        deletedReason: invalidMessage.deletedAt ? 'user_retract' : null,
      },
    });
    await assert.rejects(
      () =>
        prisma.knowledgeShare.update({
          where: { id: pendingReconcile.shareId },
          data: {
            status: 'posted',
            chatMessageId: messageId,
            postedAt: new Date(),
            version: { increment: 1 },
            updatedBy: actor.userId,
          },
        }),
      /text root|chat_root_check|check|P2004|P2010|P2039/i,
    );
  }

  const delegatedSharerId = 'knowledge-share-delegated-sharer';
  await prisma.userAccount.create({
    data: {
      id: delegatedSharerId,
      userName: delegatedSharerId,
      active: true,
      organization: actor.organizationId,
    },
  });
  const ownerRevocableShare = await prisma.knowledgeShare.create({
    data: {
      id: randomUUID(),
      sourceKnowledgeItemId: item.id,
      sourceOwnerUserId: actor.userId,
      sharerUserId: delegatedSharerId,
      chatPosterUserId: delegatedSharerId,
      destinationRoomId: roomId,
      requestKeyHash: requestKeyHash('6'),
      requestPayloadHash: requestPayloadHash('6'),
      selectionHash: requestKeyHash('7'),
      contentHash: requestKeyHash('8'),
      sourceItemVersion: item.version,
      sourceItemUpdatedAt: item.updatedAt,
      selectedSourceType: item.sourceType,
      createdBy: delegatedSharerId,
      updatedBy: delegatedSharerId,
    },
  });
  const ownerRevoked = expectOk(
    await adapter.revoke({
      actor,
      auditActor,
      shareId: ownerRevocableShare.id,
    }),
    'source owner revoke for delegated sharer',
  );
  assert.equal(ownerRevoked.status, 'revoked');

  expectFailure(
    await adapter.findStatus({
      actor: outsider,
      chatActor: outsiderChatActor,
      shareId: posted.shareId,
    }),
    'not_found',
    'share status is sharer-only',
  );
  expectFailure(
    await adapter.openSource({
      actor: outsider,
      chatActor: outsiderChatActor,
      shareId: posted.shareId,
    }),
    'not_found',
    'room-only viewer cannot open the source personal item',
  );

  await prisma.knowledgeItem.update({
    where: { id: item.id },
    data: {
      deletedAt: new Date(),
      deletedReason: 'owner_request',
      version: { increment: 1 },
      updatedBy: actor.userId,
    },
  });
  const retained = await prisma.knowledgeShare.findUniqueOrThrow({
    where: { id: posted.shareId },
    include: { annotations: true, turns: true, syntheses: true },
  });
  assert.equal(retained.status, 'posted');
  assert.equal(retained.annotations[0].content, selectedCanary);
  const deletedSourceCard = expectOk(
    await cardService.roomCard({
      actor,
      chatActor,
      messageId: posted.chatMessageId,
    }),
    'deleted source retains immutable room card',
  );
  assert.equal(deletedSourceCard.status, 'posted');
  assert.equal(deletedSourceCard.canOpenSource, false);
  assert.equal(deletedSourceCard.card.annotations[0].content, selectedCanary);
  expectFailure(
    await adapter.openSource({
      actor,
      chatActor,
      shareId: posted.shareId,
    }),
    'not_found',
    'deleted source cannot be opened through the share',
  );

  const revoked = expectOk(
    await adapter.revoke({ actor, auditActor, shareId: posted.shareId }),
    'explicit revoke',
  );
  assert.equal(revoked.status, 'revoked');
  const revokedCard = expectOk(
    await cardService.roomCard({
      actor,
      chatActor,
      messageId: posted.chatMessageId,
    }),
    'revoked room card placeholder',
  );
  assert.deepEqual(revokedCard, {
    shareId: posted.shareId,
    status: 'revoked',
    version: revoked.version,
    schemaVersion: 1,
    card: null,
    canOpenSource: false,
  });
  assert.equal(
    await prisma.chatMessage.count({ where: { id: posted.chatMessageId } }),
    1,
  );
  assert.equal(
    await prisma.knowledgeShareAnnotationSnapshot.count({
      where: { shareId: posted.shareId },
    }),
    1,
  );

  const audits = await prisma.auditLog.findMany({
    where: { action: { startsWith: 'knowledge_share_' } },
    select: { action: true, targetTable: true, metadata: true },
  });
  assert.ok(audits.length > 0);
  assert.equal(
    audits.every((entry) => entry.targetTable === 'knowledge_shares'),
    true,
  );
  const serializedAuditMetadata = JSON.stringify(
    audits.map((entry) => entry.metadata),
  );
  for (const forbidden of [
    selectedCanary,
    ...unselectedCanaries,
    item.id,
    roomId,
    requestKeyHash('a'),
  ]) {
    assert.equal(serializedAuditMetadata.includes(forbidden), false);
  }

  console.log(
    JSON.stringify({
      result: 'PASS',
      selectiveSnapshot: 'verified',
      urlRedaction: 'verified',
      providerUrlRejection: 'verified',
      providerUrlTrailingDotRejection: 'verified',
      exactRevision: 'fail-closed',
      concurrentReplay: 'converged',
      expiredReplayRecovery: 'reused',
      idempotencyConflict: 'no-mutation',
      previewShareIdRebind: 'conflict',
      atomicGenericChatRoot: 'verified',
      genericRootConstraint: 'verified',
      genericRootReverseGuard: 'verified',
      reconcileRootMutationRace: 'fail-closed',
      currentProjectClaimPolicy: 'preserved',
      activeProjectBoundary: 'revalidated',
      deletedProjectAccess: 'rejected-for-nonprivileged',
      genericNotification: 'verified',
      concurrentNotification: 'deduplicated',
      officialViewerNotification: 'verified',
      readOnlyReconcile: 'verified',
      deterministicFailure: 'failed',
      mandatoryAuditRollback: 'verified',
      immutableHistory: 'verified',
      roomOnlySourceOpen: 'denied',
      sourceDeletionSnapshotRetention: 'verified',
      revokeHistoryRetention: 'verified',
      sourceOwnerRevoke: 'verified',
      auditRedaction: 'verified',
    }),
  );
} finally {
  await prisma.$disconnect();
}
