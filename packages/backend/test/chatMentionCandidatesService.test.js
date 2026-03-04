import assert from 'node:assert/strict';
import test from 'node:test';

import { buildChatMentionCandidates } from '../dist/services/chatMentionCandidates.js';

test('project room candidates skip room members when allowExternalUsers is false', async () => {
  let chatRoomMemberCalled = false;
  const client = {
    chatRoomMember: {
      findMany: async () => {
        chatRoomMemberCalled = true;
        return [{ userId: 'external-member' }];
      },
    },
    projectMember: {
      findMany: async () => [{ userId: 'project-member' }],
    },
    userAccount: {
      findMany: async () => [
        {
          userName: 'project-member',
          externalId: 'project-member',
          displayName: 'Project Member',
        },
        {
          userName: 'requester',
          externalId: 'requester',
          displayName: 'Requester',
        },
      ],
    },
  };

  const result = await buildChatMentionCandidates({
    room: { id: 'proj-1', type: 'project', allowExternalUsers: false },
    requesterUserId: 'requester',
    groupIds: [],
    groupAccountIds: [],
    client,
  });

  assert.equal(chatRoomMemberCalled, false);
  assert.deepEqual(
    result.users.map((entry) => entry.userId),
    ['project-member', 'requester'],
  );
});

test('project room candidates include room members when allowExternalUsers is true', async () => {
  let chatRoomMemberCalled = false;
  const client = {
    chatRoomMember: {
      findMany: async () => {
        chatRoomMemberCalled = true;
        return [{ userId: 'external-member' }];
      },
    },
    projectMember: {
      findMany: async () => [{ userId: 'project-member' }],
    },
    userAccount: {
      findMany: async () => [
        {
          userName: 'project-member',
          externalId: 'project-member',
          displayName: 'Project Member',
        },
        {
          userName: 'requester',
          externalId: 'requester',
          displayName: 'Requester',
        },
        {
          userName: 'external-member',
          externalId: 'external-member',
          displayName: 'External Member',
        },
      ],
    },
  };

  const result = await buildChatMentionCandidates({
    room: { id: 'proj-1', type: 'project', allowExternalUsers: true },
    requesterUserId: 'requester',
    groupIds: [],
    groupAccountIds: [],
    client,
  });

  assert.equal(chatRoomMemberCalled, true);
  assert.deepEqual(
    result.users.map((entry) => entry.userId),
    ['external-member', 'project-member', 'requester'],
  );
});
