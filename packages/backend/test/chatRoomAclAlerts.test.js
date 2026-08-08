import assert from 'node:assert/strict';
import test from 'node:test';

import { runChatRoomAclMismatchAlerts } from '../dist/services/chatRoomAclAlerts.js';

function clientForRoom(room) {
  const created = [];
  return {
    created,
    client: {
      chatRoom: { findMany: async () => [room] },
      chatRoomMember: {
        findMany: async () => [{ userId: 'owner-user' }],
      },
      appNotification: {
        findMany: async () => [],
        createMany: async ({ data }) => {
          created.push(...data);
          return { count: data.length };
        },
      },
    },
  };
}

const notificationPort = {
  filterRecipients: async ({ userIds }) => ({ allowed: userIds, muted: [] }),
};

test('ACL mismatch alert stores the canonical legacy project-room alias', async () => {
  const { client, created } = clientForRoom({
    id: 'legacy-project-room',
    type: 'project',
    name: 'Synthetic room',
    projectId: null,
    viewerGroupIds: ['viewer-group'],
    posterGroupIds: ['viewer-group', 'poster-only-group'],
  });
  const result = await runChatRoomAclMismatchAlerts({
    client,
    notificationPort,
  });
  assert.equal(result.created, 1);
  assert.equal(created[0].projectId, 'legacy-project-room');
  assert.equal(created[0].messageId, 'legacy-project-room');
});

test('ACL mismatch alert does not invent a project reference for non-project rooms', async () => {
  const { client, created } = clientForRoom({
    id: 'company-room',
    type: 'company',
    name: 'Synthetic company room',
    projectId: null,
    viewerGroupIds: ['viewer-group'],
    posterGroupIds: ['viewer-group', 'poster-only-group'],
  });
  await runChatRoomAclMismatchAlerts({ client, notificationPort });
  assert.equal(created.length, 1);
  assert.equal(created[0].projectId, undefined);
});
