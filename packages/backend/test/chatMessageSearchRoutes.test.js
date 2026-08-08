import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const baseHeaders = {
  'x-user-id': 'user-1',
  'x-roles': 'user',
};

function searchMessage(overrides = {}) {
  const createdAt = new Date('2026-08-09T01:02:03.000Z');
  return {
    id: 'message-1',
    roomId: 'room-1',
    messageType: 'text',
    parentMessageId: null,
    threadRootId: null,
    userId: 'author-1',
    body: 'search result body',
    tags: ['important'],
    reactions: { hidden: true },
    mentions: ['should-not-leak'],
    createdAt,
    updatedAt: createdAt,
    room: {
      id: 'room-1',
      type: 'private_group',
      name: 'Official viewers',
      isOfficial: true,
      projectId: null,
      groupId: null,
      allowExternalUsers: false,
      allowExternalIntegrations: false,
      viewerGroupIds: ['should-not-leak'],
      project: null,
    },
    ...overrides,
  };
}

async function withSearchServer(options, run) {
  const originalTransaction = prisma.$transaction;
  const originalAuditCreate = prisma.auditLog.create;
  const state = {
    auditLogs: [],
    events: [],
    aclQueries: [],
    messageQueries: [],
    queryClients: [],
    transactionOptions: null,
    transactionClient: null,
  };
  const tx = {
    async $queryRaw(input) {
      state.events.push('acl');
      state.queryClients.push(tx);
      state.aclQueries.push(input);
      return (options.accessibleRoomIds ?? []).map((id) => ({ id }));
    },
    chatMessage: {
      async findMany(input) {
        state.events.push('messages');
        state.queryClients.push(tx);
        state.messageQueries.push(input);
        return options.messages ?? [];
      },
    },
  };
  state.transactionClient = tx;

  prisma.$transaction = async (operation, transactionOptions) => {
    state.events.push('transaction');
    state.transactionOptions = transactionOptions;
    assert.equal(typeof operation, 'function');
    return operation(tx);
  };
  prisma.auditLog.create = async ({ data }) => {
    state.auditLogs.push(data);
    return { id: 'audit-1' };
  };

  let server;
  try {
    server = await buildServer({ logger: false });
    await run(server, state);
  } finally {
    if (server) await server.close();
    prisma.$transaction = originalTransaction;
    prisma.auditLog.create = originalAuditCreate;
  }
}

test('exec with no projects applies ACL before querying and excludes unassigned project messages', async () => {
  await withSearchServer(
    {
      accessibleRoomIds: [],
      messages: [
        searchMessage({
          id: 'must-not-be-returned',
          roomId: 'unassigned-project-room',
        }),
      ],
    },
    async (server, state) => {
      const response = await server.inject({
        method: 'GET',
        url: '/chat-messages/search?q=project',
        headers: {
          'x-user-id': 'executive-1',
          'x-roles': 'exec',
          'x-project-ids': '',
        },
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), {
        items: [],
        nextBefore: null,
        nextBeforeId: null,
      });
      assert.deepEqual(state.events, ['transaction', 'acl']);
      assert.equal(state.messageQueries.length, 0);
      assert.match(state.aclQueries[0].text, /room\."deletedAt" IS NULL/);
    },
  );
});

test('official private group viewer grant permits search without room membership', async () => {
  await withSearchServer(
    {
      accessibleRoomIds: ['official-private'],
      messages: [
        searchMessage({
          roomId: 'official-private',
          room: {
            ...searchMessage().room,
            id: 'official-private',
          },
        }),
      ],
    },
    async (server, state) => {
      const response = await server.inject({
        method: 'GET',
        url: '/chat-messages/search?q=result',
        headers: {
          ...baseHeaders,
          'x-group-account-ids': 'viewer-group',
        },
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().items[0].id, 'message-1');
      assert.deepEqual(state.messageQueries[0].where.roomId, {
        in: ['official-private'],
      });
      assert.match(state.aclQueries[0].text, /room\."viewerGroupIds"/);
      assert.match(state.aclQueries[0].text, /FROM "ChatRoomMember" AS member/);
    },
  );
});

test('ACL resolution and message query share one RepeatableRead transaction client', async () => {
  await withSearchServer(
    {
      accessibleRoomIds: ['room-1'],
      messages: [searchMessage()],
    },
    async (server, state) => {
      const response = await server.inject({
        method: 'GET',
        url: '/chat-messages/search?q=result&limit=20',
        headers: baseHeaders,
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(state.events, ['transaction', 'acl', 'messages']);
      assert.equal(state.aclQueries.length, 1);
      assert.equal(state.messageQueries.length, 1);
      assert.equal(state.transactionOptions.isolationLevel, 'RepeatableRead');
      assert.equal(state.queryClients[0], state.transactionClient);
      assert.equal(state.queryClients[1], state.transactionClient);
    },
  );
});

test('search uses a stable createdAt and id boundary and deterministic ordering', async () => {
  const before = '2026-08-09T01:02:03.000Z';
  await withSearchServer(
    {
      accessibleRoomIds: ['room-1'],
      messages: [searchMessage({ id: 'message-boundary' })],
    },
    async (server, state) => {
      const response = await server.inject({
        method: 'GET',
        url: `/chat-messages/search?q=result&limit=25&before=${encodeURIComponent(before)}&beforeId=message-9`,
        headers: baseHeaders,
      });

      assert.equal(response.statusCode, 200, response.body);
      const query = state.messageQueries[0];
      assert.deepEqual(query.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
      assert.equal(query.take, 25);
      assert.deepEqual(query.where.OR, [
        { createdAt: { lt: new Date(before) } },
        { createdAt: new Date(before), id: { lt: 'message-9' } },
      ]);
    },
  );
});

test('search rejects beforeId without before and an overlong beforeId before transaction start', async () => {
  await withSearchServer({}, async (server, state) => {
    const withoutDate = await server.inject({
      method: 'GET',
      url: '/chat-messages/search?q=result&beforeId=message-9',
      headers: baseHeaders,
    });
    assert.equal(withoutDate.statusCode, 400, withoutDate.body);
    assert.equal(withoutDate.json().error.code, 'INVALID_CURSOR');

    const overlongId = 'x'.repeat(201);
    const overlong = await server.inject({
      method: 'GET',
      url: `/chat-messages/search?q=result&before=2026-08-09T01%3A02%3A03.000Z&beforeId=${overlongId}`,
      headers: baseHeaders,
    });
    assert.equal(overlong.statusCode, 400, overlong.body);
    assert.equal(overlong.json().error.code, 'INVALID_CURSOR');
    assert.deepEqual(state.events, []);
  });
});

test('search response exposes only the topology allowlist and complete cursor shape', async () => {
  await withSearchServer(
    {
      accessibleRoomIds: ['room-1'],
      messages: [searchMessage()],
    },
    async (server, state) => {
      const response = await server.inject({
        method: 'GET',
        url: '/chat-messages/search?q=result',
        headers: baseHeaders,
      });

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), {
        items: [
          {
            id: 'message-1',
            roomId: 'room-1',
            messageType: 'text',
            parentMessageId: null,
            threadRootId: null,
            userId: 'author-1',
            body: 'search result body',
            tags: ['important'],
            createdAt: '2026-08-09T01:02:03.000Z',
            room: {
              id: 'room-1',
              type: 'private_group',
              name: 'Official viewers',
              isOfficial: true,
              projectId: null,
              projectCode: null,
              projectName: null,
              groupId: null,
              allowExternalUsers: false,
              allowExternalIntegrations: false,
            },
          },
        ],
        nextBefore: '2026-08-09T01:02:03.000Z',
        nextBeforeId: 'message-1',
      });
      assert.equal(state.auditLogs.length, 1);
      assert.equal(state.auditLogs[0].metadata.hasQuery, true);
      assert.equal(state.auditLogs[0].metadata.queryLength, 6);
      assert.equal(state.auditLogs[0].metadata.resultCount, 1);
      assert.equal(state.auditLogs[0].metadata.limit, 50);
      assert.equal(Object.hasOwn(state.auditLogs[0].metadata, 'query'), false);
    },
  );
});

async function withDeepLinkServer(options, run) {
  const originalMessageFind = prisma.chatMessage.findUnique;
  const originalRoomFind = prisma.chatRoom.findUnique;
  const originalMemberFind = prisma.chatRoomMember.findFirst;
  const originalAuditCreate = prisma.auditLog.create;
  const auditLogs = [];
  prisma.chatMessage.findUnique = async ({ where }) => {
    if (options.missing) return null;
    const isReply = where.id.startsWith('reply');
    return {
      id: where.id,
      roomId: 'private-room-1',
      messageType: 'text',
      parentMessageId: isReply ? 'root-1' : null,
      threadRootId: isReply ? 'root-1' : null,
      userId: 'author-1',
      body: 'private deep-link body',
      tags: null,
      reactions: null,
      mentions: null,
      mentionsAll: false,
      createdAt: new Date('2026-08-09T01:02:03.000Z'),
      createdBy: 'author-1',
      updatedAt: new Date('2026-08-09T01:02:03.000Z'),
      updatedBy: null,
      deletedAt: options.deleted ? new Date() : null,
      deletedReason: options.deleted ? 'user_retract' : null,
      room: {
        id: 'private-room-1',
        type: 'private_group',
        projectId: null,
        deletedAt: null,
      },
    };
  };
  prisma.chatRoom.findUnique = async () => ({
    id: 'private-room-1',
    type: 'private_group',
    projectId: null,
    isOfficial: false,
    groupId: null,
    viewerGroupIds: null,
    posterGroupIds: null,
    deletedAt: null,
    allowExternalUsers: false,
  });
  prisma.chatRoomMember.findFirst = async () =>
    options.allowed ? { role: 'member' } : null;
  prisma.auditLog.create = async ({ data }) => {
    auditLogs.push(data);
    return { id: 'audit-deep-link' };
  };

  let server;
  try {
    server = await buildServer({ logger: false });
    await run(server, auditLogs);
  } finally {
    if (server) await server.close();
    prisma.chatMessage.findUnique = originalMessageFind;
    prisma.chatRoom.findUnique = originalRoomFind;
    prisma.chatRoomMember.findFirst = originalMemberFind;
    prisma.auditLog.create = originalAuditCreate;
  }
}

test('message deep-link makes missing, deleted, and unauthorized root or reply indistinguishable', async () => {
  const responses = [];
  for (const options of [
    { missing: true, id: 'root-missing' },
    { deleted: true, id: 'root-deleted' },
    { id: 'root-hidden' },
    { id: 'reply-hidden' },
  ]) {
    await withDeepLinkServer(options, async (server) => {
      const response = await server.inject({
        method: 'GET',
        url: `/chat-messages/${options.id}`,
        headers: baseHeaders,
      });
      responses.push({
        statusCode: response.statusCode,
        body: response.json(),
      });
    });
  }
  for (const response of responses) {
    assert.deepEqual(response, {
      statusCode: 404,
      body: {
        error: { code: 'NOT_FOUND', message: 'Chat message not found' },
      },
    });
  }
});

test('authorized deep-link exposes the allowlist but omits private identifiers from audit metadata', async () => {
  await withDeepLinkServer(
    { allowed: true, id: 'reply-visible' },
    async (server, auditLogs) => {
      const response = await server.inject({
        method: 'GET',
        url: '/chat-messages/reply-visible',
        headers: baseHeaders,
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().id, 'reply-visible');
      assert.equal(response.json().threadRootId, 'root-1');
      assert.equal(auditLogs.length, 1);
      assert.equal(auditLogs[0].metadata.messageType, 'text');
      assert.equal(auditLogs[0].metadata.isReply, true);
      assert.equal(Object.hasOwn(auditLogs[0].metadata, 'roomId'), false);
      assert.equal(Object.hasOwn(auditLogs[0].metadata, 'messageId'), false);
      assert.equal(auditLogs[0].targetId, undefined);
      const serialized = JSON.stringify(auditLogs[0]);
      assert.equal(serialized.includes('reply-visible'), false);
      assert.equal(serialized.includes('private-room-1'), false);
    },
  );
});
