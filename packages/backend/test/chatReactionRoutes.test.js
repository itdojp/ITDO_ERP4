import assert from 'node:assert/strict';
import test from 'node:test';

import { chatReactionService } from '../dist/application/chat/chatReactionService.js';
import { buildServer } from '../dist/server.js';

const headers = {
  'x-user-id': 'user-1',
  'x-roles': 'user',
  'x-project-ids': 'project-1',
};

function reactionMessage(reactions) {
  return {
    id: 'reply-1',
    roomId: 'room-1',
    messageType: 'text',
    parentMessageId: 'root-1',
    threadRootId: 'root-1',
    userId: 'user-1',
    body: 'Synthetic reply',
    tags: null,
    reactions,
    mentions: null,
    mentionsAll: false,
    createdAt: new Date('2026-08-08T00:00:00.000Z'),
    createdBy: 'user-1',
    updatedAt: new Date('2026-08-08T00:00:00.000Z'),
    updatedBy: 'user-1',
    deletedAt: null,
    deletedReason: null,
  };
}

async function withServer(result, run) {
  const previousAuthMode = process.env.AUTH_MODE;
  const originalAdd = chatReactionService.add;
  const originalRemove = chatReactionService.remove;
  const calls = [];
  process.env.AUTH_MODE = 'header';
  chatReactionService.add = async (input) => {
    calls.push(['add', input]);
    return result;
  };
  chatReactionService.remove = async (input) => {
    calls.push(['remove', input]);
    return result;
  };
  const server = await buildServer({ logger: false });
  try {
    await run(server, calls);
  } finally {
    await server.close();
    chatReactionService.add = originalAdd;
    chatReactionService.remove = originalRemove;
    if (previousAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = previousAuthMode;
  }
}

test('reaction add preserves the legacy message response and supports reply IDs', async () => {
  await withServer(
    {
      ok: true,
      value: {
        message: reactionMessage({
          '👍': { count: 1, userIds: ['user-1'] },
        }),
        changed: true,
      },
    },
    async (server, calls) => {
      const response = await server.inject({
        method: 'POST',
        url: '/chat-messages/reply-1/reactions',
        headers,
        payload: { emoji: '👍' },
      });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      assert.equal(body.id, 'reply-1');
      assert.equal(body.parentMessageId, 'root-1');
      assert.equal(body.threadRootId, 'root-1');
      assert.deepEqual(body.reactions, {
        '👍': { count: 1, userIds: ['user-1'] },
      });
      assert.equal(calls[0][0], 'add');
      assert.equal(calls[0][1].messageId, 'reply-1');
    },
  );
});

test('reaction remove is idempotent through the same ACL-normalized contract', async () => {
  await withServer(
    {
      ok: true,
      value: {
        message: reactionMessage({}),
        changed: false,
      },
    },
    async (server, calls) => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/chat-messages/reply-1/reactions',
        headers,
        payload: { emoji: '👍' },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json().reactions, {});
      assert.equal(calls[0][0], 'remove');
    },
  );
});

test('reaction routes normalize inaccessible and invalid inputs', async () => {
  for (const [result, expectedStatus, expectedCode] of [
    [{ ok: false, reason: 'not_found' }, 404, 'NOT_FOUND'],
    [{ ok: false, reason: 'invalid_reaction' }, 400, 'INVALID_EMOJI'],
  ]) {
    await withServer(result, async (server) => {
      const response = await server.inject({
        method: 'POST',
        url: '/chat-messages/hidden/reactions',
        headers,
        payload: { emoji: '👍' },
      });
      assert.equal(response.statusCode, expectedStatus, response.body);
      assert.equal(response.json().error.code, expectedCode);
      assert.equal(
        response.json().error.message,
        expectedCode === 'INVALID_EMOJI'
          ? 'Invalid reaction'
          : 'Message not found',
      );
      assert.equal(response.body.includes('room-1'), false);
    });
  }
});
