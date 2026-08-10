import assert from 'node:assert/strict';
import test from 'node:test';

import { prismaChatThreadRepository } from '../dist/adapters/chat/prismaChatThreadAdapter.js';
import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const now = new Date('2026-08-08T00:00:00.000Z');

function message(overrides = {}) {
  return {
    id: 'root-1',
    roomId: 'room-1',
    messageType: 'text',
    parentMessageId: null,
    threadRootId: null,
    userId: 'user-1',
    body: 'Synthetic body',
    tags: null,
    reactions: null,
    mentions: null,
    mentionsAll: false,
    ackRequest: null,
    attachments: [],
    createdAt: now,
    createdBy: 'user-1',
    updatedAt: now,
    updatedBy: 'user-1',
    deletedAt: null,
    deletedReason: null,
    ...overrides,
  };
}

function withStubs(snapshotRepository, run) {
  const originalListRootTimeline = prismaChatThreadRepository.listRootTimeline;
  const originalListKnowledgeShareSummaries =
    prismaChatThreadRepository.listKnowledgeShareSummaries;
  const originalSnapshot = prismaChatThreadRepository.withReadSnapshot;
  const originalPrepareReply = prismaChatThreadRepository.prepareReply;
  const originalCreateReply = prismaChatThreadRepository.createReply;
  const originalAuditCreate = prisma.auditLog.create;
  const originalChatRoomFindUnique = prisma.chatRoom.findUnique;
  const auditEntries = [];
  prismaChatThreadRepository.listRootTimeline = async (input) => {
    snapshotRepository.timelineInputs?.push(input);
    return Object.hasOwn(snapshotRepository, 'timelineResult')
      ? snapshotRepository.timelineResult
      : [];
  };
  prismaChatThreadRepository.listKnowledgeShareSummaries = async (input) => {
    snapshotRepository.summaryInputs?.push(input);
    return Object.hasOwn(snapshotRepository, 'summaryResult')
      ? snapshotRepository.summaryResult
      : [];
  };
  prismaChatThreadRepository.withReadSnapshot = async (operation) =>
    operation(snapshotRepository);
  prismaChatThreadRepository.prepareReply = async () =>
    snapshotRepository.replyTarget ?? null;
  prismaChatThreadRepository.createReply = async () =>
    snapshotRepository.replyCreation ?? null;
  prisma.auditLog.create = async ({ data }) => {
    auditEntries.push(data);
    return { id: 'audit-1' };
  };
  if (snapshotRepository.accessRooms) {
    prisma.chatRoom.findUnique = async ({ where }) =>
      snapshotRepository.accessRooms[where.id] ?? null;
  }
  return Promise.resolve()
    .then(() => run(auditEntries))
    .finally(() => {
      prismaChatThreadRepository.listRootTimeline = originalListRootTimeline;
      prismaChatThreadRepository.listKnowledgeShareSummaries =
        originalListKnowledgeShareSummaries;
      prismaChatThreadRepository.withReadSnapshot = originalSnapshot;
      prismaChatThreadRepository.prepareReply = originalPrepareReply;
      prismaChatThreadRepository.createReply = originalCreateReply;
      prisma.auditLog.create = originalAuditCreate;
      prisma.chatRoom.findUnique = originalChatRoomFindUnique;
    });
}

function readableRepository(overrides = {}) {
  const root = message();
  const reply = message({
    id: 'reply-1',
    parentMessageId: root.id,
    threadRootId: root.id,
    body: 'Synthetic reply',
    createdAt: new Date('2026-08-08T00:01:00.000Z'),
  });
  return {
    resolveMessage: async () => ({
      id: root.id,
      roomId: root.roomId,
      parentMessageId: null,
      threadRootId: null,
    }),
    canReadRoom: async () => true,
    readThread: async () => ({
      root,
      replies: [reply],
      replyCount: 1,
      lastReplyAt: reply.createdAt,
      hasMore: false,
    }),
    ...overrides,
  };
}

async function withServer(repository, run) {
  const previousAuthMode = process.env.AUTH_MODE;
  process.env.AUTH_MODE = 'header';
  try {
    await withStubs(repository, async (auditEntries) => {
      const server = await buildServer({ logger: false });
      try {
        await run(server, auditEntries);
      } finally {
        await server.close();
      }
    });
  } finally {
    if (previousAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = previousAuthMode;
  }
}

const headers = {
  'x-user-id': 'user-1',
  'x-roles': 'user',
  'x-project-ids': 'project-1',
};

test('GET thread returns explicit root, reply, aggregate, and pagination fields', async () => {
  await withServer(readableRepository(), async (server, auditEntries) => {
    const response = await server.inject({
      method: 'GET',
      url: '/chat-messages/root-1/thread?limit=25',
      headers,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.root.id, 'root-1');
    assert.equal(body.root.replyCount, 1);
    assert.equal(body.replies[0].parentMessageId, 'root-1');
    assert.equal(body.replies[0].threadRootId, 'root-1');
    assert.equal(body.replyCount, 1);
    assert.equal(body.lastReplyAt, '2026-08-08T00:01:00.000Z');
    assert.equal(body.nextCursor, null);
    assert.equal(Object.hasOwn(body, '_count'), false);
    assert.equal(auditEntries.length, 1);
    assert.equal(auditEntries[0].metadata.replyCount, 1);
    assert.equal(auditEntries[0].metadata.returnedReplyCount, 1);
    assert.equal(Object.hasOwn(auditEntries[0].metadata, 'roomId'), false);
    assert.equal(JSON.stringify(auditEntries).includes('room-1'), false);
    assert.equal(JSON.stringify(auditEntries).includes('Synthetic'), false);
  });
});

test('GET thread keeps the old response shape when an internal share relation exists', async () => {
  const repository = readableRepository();
  const originalReadThread = repository.readThread;
  repository.readThread = async (input) => {
    const snapshot = await originalReadThread(input);
    snapshot.root.knowledgeShare = {
      shareId: 'share-posted',
      status: 'posted',
      version: 2,
      schemaVersion: 1,
      selectedContent: 'must not leak',
      sourceKnowledgeItemId: 'source-sensitive',
      provider: 'provider-sensitive',
    };
    return snapshot;
  };
  await withServer(repository, async (server) => {
    const response = await server.inject({
      method: 'GET',
      url: '/chat-messages/root-1/thread',
      headers,
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(Object.hasOwn(body.root, 'knowledgeShare'), false);
    assert.equal(Object.hasOwn(body.replies[0], 'knowledgeShare'), false);
    assert.equal(response.body.includes('source-sensitive'), false);
    assert.equal(response.body.includes('provider-sensitive'), false);
    assert.equal(response.body.includes('must not leak'), false);
  });
});

test('dedicated room summary route exposes compact share metadata without changing the old timeline response', async () => {
  const timelineInputs = [];
  const summaryInputs = [];
  const shareRoot = { ...message(), replyCount: 0, lastReplyAt: null };
  const room = {
    id: 'room-1',
    type: 'company',
    projectId: null,
    isOfficial: true,
    groupId: null,
    viewerGroupIds: null,
    posterGroupIds: null,
    deletedAt: null,
    allowExternalUsers: false,
  };
  await withServer(
    readableRepository({
      timelineInputs,
      timelineResult: [shareRoot],
      summaryInputs,
      summaryResult: [
        {
          messageId: 'root-1',
          shareId: 'share-posted',
          status: 'posted',
          version: 2,
          schemaVersion: 1,
          selectedContent: 'must not leak',
          sourceKnowledgeItemId: 'source-sensitive',
        },
      ],
      accessRooms: { 'room-1': room },
    }),
    async (server) => {
      const oldTimeline = await server.inject({
        method: 'GET',
        url: '/chat-rooms/room-1/messages',
        headers,
      });
      assert.equal(oldTimeline.statusCode, 200, oldTimeline.body);
      assert.equal(
        Object.hasOwn(oldTimeline.json().items[0], 'knowledgeShare'),
        false,
      );

      const summary = await server.inject({
        method: 'GET',
        url: '/chat-rooms/room-1/knowledge-share-messages?messageIds=root-1,root-2,root-1',
        headers,
      });
      assert.equal(summary.statusCode, 200, summary.body);
      assert.deepEqual(summary.json(), {
        items: [
          {
            messageId: 'root-1',
            shareId: 'share-posted',
            status: 'posted',
            version: 2,
            schemaVersion: 1,
          },
        ],
      });
      assert.equal(summary.body.includes('source-sensitive'), false);
      assert.equal(summary.body.includes('must not leak'), false);
    },
  );
  assert.equal(timelineInputs.length, 1);
  assert.deepEqual(summaryInputs[0].messageIds, ['root-1', 'root-2']);
  assert.equal(summaryInputs[0].roomId, 'room-1');
});

test('knowledge-share summary route rejects missing, empty, oversized, and over-count message ID sets', async () => {
  const room = {
    id: 'room-1',
    type: 'company',
    projectId: null,
    isOfficial: true,
    groupId: null,
    viewerGroupIds: null,
    posterGroupIds: null,
    deletedAt: null,
    allowExternalUsers: false,
  };
  const summaryInputs = [];
  await withServer(
    readableRepository({
      summaryInputs,
      accessRooms: { 'room-1': room },
    }),
    async (server) => {
      const cases = [
        '/chat-rooms/room-1/knowledge-share-messages',
        '/chat-rooms/room-1/knowledge-share-messages?messageIds=%20',
        `/chat-rooms/room-1/knowledge-share-messages?messageIds=${'x'.repeat(201)}`,
        `/chat-rooms/room-1/knowledge-share-messages?messageIds=${Array.from({ length: 101 }, (_, index) => `root-${index}`).join(',')}`,
      ];
      for (const url of cases) {
        const response = await server.inject({ method: 'GET', url, headers });
        assert.equal(response.statusCode, 400, response.body);
      }
    },
  );
  assert.deepEqual(summaryInputs, []);
});

test('knowledge-share summary route normalizes same-snapshot access revocation to 404', async () => {
  const room = {
    id: 'room-1',
    type: 'company',
    projectId: null,
    isOfficial: true,
    groupId: null,
    viewerGroupIds: null,
    posterGroupIds: null,
    deletedAt: null,
    allowExternalUsers: false,
  };
  await withServer(
    readableRepository({
      summaryResult: null,
      accessRooms: { 'room-1': room },
    }),
    async (server) => {
      const response = await server.inject({
        method: 'GET',
        url: '/chat-rooms/room-1/knowledge-share-messages?messageIds=root-1',
        headers,
      });
      assert.equal(response.statusCode, 404, response.body);
      assert.deepEqual(response.json(), { error: 'not_found' });
    },
  );
});

test('timeline routes pass the current actor and normalize same-snapshot ACL denial to 404', async () => {
  const cases = [
    {
      url: '/chat-rooms/room-1/messages',
      roomId: 'room-1',
      expectedBody: { error: 'not_found' },
      room: {
        id: 'room-1',
        type: 'company',
        projectId: null,
        isOfficial: true,
        groupId: null,
        viewerGroupIds: null,
        posterGroupIds: null,
        deletedAt: null,
        allowExternalUsers: false,
      },
    },
    {
      url: '/projects/project-1/chat-messages',
      roomId: 'project-1',
      expectedBody: {
        error: {
          code: 'NOT_FOUND',
          message: 'Project chat timeline not found',
        },
      },
      room: {
        id: 'project-1',
        type: 'project',
        projectId: 'project-1',
        isOfficial: true,
        groupId: null,
        viewerGroupIds: null,
        posterGroupIds: null,
        deletedAt: null,
        allowExternalUsers: false,
      },
    },
  ];

  for (const testCase of cases) {
    const timelineInputs = [];
    await withServer(
      readableRepository({
        timelineInputs,
        timelineResult: null,
        accessRooms: { [testCase.roomId]: testCase.room },
      }),
      async (server) => {
        const response = await server.inject({
          method: 'GET',
          url: testCase.url,
          headers,
        });
        assert.equal(response.statusCode, 404, response.body);
        assert.deepEqual(response.json(), testCase.expectedBody);
      },
    );
    assert.equal(timelineInputs.length, 1);
    assert.equal(timelineInputs[0].roomId, testCase.roomId);
    assert.deepEqual(timelineInputs[0].actor, {
      userId: 'user-1',
      roles: ['user'],
      projectIds: ['project-1'],
      groupIds: [],
      groupAccountIds: [],
    });
  }
});

test('room timeline preserves the existing not-found access response under the additive 404 schema', async () => {
  const timelineInputs = [];
  await withServer(
    readableRepository({ timelineInputs, accessRooms: {} }),
    async (server) => {
      const response = await server.inject({
        method: 'GET',
        url: '/chat-rooms/missing/messages',
        headers,
      });
      assert.equal(response.statusCode, 404, response.body);
      assert.deepEqual(response.json(), { error: 'not_found' });
    },
  );
  assert.deepEqual(timelineInputs, []);
});

test('GET thread normalizes missing and unauthorized messages to the same 404', async () => {
  for (const repository of [
    readableRepository({ resolveMessage: async () => null }),
    readableRepository({ canReadRoom: async () => false }),
  ]) {
    await withServer(repository, async (server) => {
      const response = await server.inject({
        method: 'GET',
        url: '/chat-messages/hidden/thread',
        headers,
      });
      assert.equal(response.statusCode, 404, response.body);
      assert.deepEqual(response.json(), {
        error: { code: 'NOT_FOUND', message: 'Chat thread not found' },
      });
    });
  }
});

test('GET thread rejects invalid limit and cursor with sanitized errors', async () => {
  await withServer(readableRepository(), async (server) => {
    const limitResponse = await server.inject({
      method: 'GET',
      url: '/chat-messages/root-1/thread?limit=0',
      headers,
    });
    assert.equal(limitResponse.statusCode, 400, limitResponse.body);
    const overLimitResponse = await server.inject({
      method: 'GET',
      url: '/chat-messages/root-1/thread?limit=201',
      headers,
    });
    assert.equal(overLimitResponse.statusCode, 400, overLimitResponse.body);
    const cursorResponse = await server.inject({
      method: 'GET',
      url: '/chat-messages/root-1/thread?cursor=invalid',
      headers,
    });
    assert.equal(cursorResponse.statusCode, 400, cursorResponse.body);
    assert.equal(cursorResponse.json().error.code, 'INVALID_CURSOR');
    assert.equal(cursorResponse.body.includes('root-1'), false);
  });
});

test('GET thread returns deleted roots and replies as content-free placeholders', async () => {
  const deleted = message({
    body: null,
    deletedAt: now,
    deletedReason: 'author_deleted',
  });
  await withServer(
    readableRepository({
      readThread: async () => ({
        root: deleted,
        replies: [
          message({
            id: 'reply-deleted',
            parentMessageId: deleted.id,
            threadRootId: deleted.id,
            body: null,
            deletedAt: now,
            deletedReason: 'author_deleted',
          }),
        ],
        replyCount: 1,
        lastReplyAt: now,
        hasMore: false,
      }),
    }),
    async (server) => {
      const response = await server.inject({
        method: 'GET',
        url: '/chat-messages/root-1/thread',
        headers,
      });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      assert.equal(body.root.deleted, true);
      assert.equal(body.root.body, null);
      assert.equal(body.replies[0].deleted, true);
      assert.equal(body.replies[0].body, null);
    },
  );
});

test('POST reply returns an allowlisted reply topology and content-free audit metadata', async () => {
  const target = {
    rootMessageId: 'root-1',
    room: {
      id: 'room-1',
      type: 'private_group',
      projectId: null,
      isOfficial: false,
      groupId: null,
      viewerGroupIds: [],
      posterGroupIds: [],
      allowExternalUsers: false,
    },
    postWithoutView: false,
  };
  const replyMessage = message({
    id: 'reply-created',
    parentMessageId: 'root-1',
    threadRootId: 'root-1',
    body: 'Synthetic reply content',
  });
  await withServer(
    readableRepository({
      replyTarget: target,
      replyCreation: { target, message: replyMessage },
    }),
    async (server, auditEntries) => {
      const response = await server.inject({
        method: 'POST',
        url: '/chat-messages/root-1/replies',
        headers,
        payload: { body: 'Synthetic reply content' },
      });
      assert.equal(response.statusCode, 201, response.body);
      const body = response.json();
      assert.equal(body.id, 'reply-created');
      assert.equal(body.parentMessageId, 'root-1');
      assert.equal(body.threadRootId, 'root-1');
      assert.equal(Object.hasOwn(body, 'room'), false);
      const createdAudit = auditEntries.find(
        (entry) => entry.action === 'chat_reply_created',
      );
      assert.ok(createdAudit);
      assert.equal(createdAudit.metadata.mentionUserCount, 0);
      assert.equal(
        JSON.stringify(createdAudit.metadata).includes('room-1'),
        false,
      );
      assert.equal(
        JSON.stringify(createdAudit.metadata).includes('Synthetic reply'),
        false,
      );
    },
  );
});

test('POST reply normalizes missing and concurrently deleted roots to the same 404', async () => {
  for (const repository of [
    readableRepository({ replyTarget: null }),
    readableRepository({
      replyTarget: {
        rootMessageId: 'root-1',
        room: {
          id: 'room-1',
          type: 'private_group',
          projectId: null,
          isOfficial: false,
          groupId: null,
          allowExternalUsers: false,
        },
        postWithoutView: false,
      },
      replyCreation: null,
    }),
  ]) {
    await withServer(repository, async (server) => {
      const response = await server.inject({
        method: 'POST',
        url: '/chat-messages/hidden/replies',
        headers,
        payload: { body: 'Synthetic reply content' },
      });
      assert.equal(response.statusCode, 404, response.body);
      assert.deepEqual(response.json(), {
        error: { code: 'NOT_FOUND', message: 'Chat thread not found' },
      });
    });
  }
});
