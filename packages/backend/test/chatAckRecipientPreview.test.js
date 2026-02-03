import assert from 'node:assert/strict';
import test from 'node:test';

import { previewChatAckRecipients } from '../dist/services/chatAckRecipients.js';

function buildRoom(overrides = {}) {
  return {
    id: 'room1',
    type: 'company',
    groupId: null,
    deletedAt: null,
    allowExternalUsers: false,
    ...overrides,
  };
}

function createGroupAccountStub(groups = []) {
  const selectorMap = new Map();
  for (const group of groups) {
    const id = typeof group.id === 'string' ? group.id.trim() : '';
    const displayName =
      typeof group.displayName === 'string' ? group.displayName.trim() : '';
    if (id) selectorMap.set(id, group);
    if (displayName) selectorMap.set(displayName, group);
  }
  return {
    findMany: async ({ where }) => {
      const selectors = [
        ...(where?.OR?.[0]?.id?.in || []),
        ...(where?.OR?.[1]?.displayName?.in || []),
      ];
      const rows = [];
      for (const selector of selectors) {
        const group = selectorMap.get(selector);
        if (group) rows.push(group);
      }
      return rows;
    },
  };
}

test('previewChatAckRecipients: expands group/role and enforces limits', async () => {
  const original = process.env.AUTH_GROUP_TO_ROLE_MAP;
  process.env.AUTH_GROUP_TO_ROLE_MAP = 'role-group-id=customrole';
  try {
    const room = buildRoom({ id: 'company', type: 'company' });
    const directUserIds = Array.from({ length: 49 }, (_, idx) => `u${idx + 1}`);
    const client = {
      groupAccount: createGroupAccountStub([
        { id: 'g1-id', displayName: 'g1' },
        { id: 'role-group-id', displayName: 'role-group-id' },
      ]),
      userGroup: {
        findMany: async ({ where }) => {
          const groupIds = where?.groupId?.in || [];
          const rows = [];
          if (groupIds.includes('g1-id')) {
            rows.push({ groupId: 'g1-id', user: { userName: 'u50' } });
          }
          if (groupIds.includes('role-group-id')) {
            rows.push({ groupId: 'role-group-id', user: { userName: 'u51' } });
          }
          return rows;
        },
      },
      userAccount: {
        findMany: async ({ where }) =>
          (where?.userName?.in || []).map((userName) => ({ userName })),
      },
      chatRoomMember: { findMany: async () => [] },
      projectMember: { findMany: async () => [] },
    };

    const res = await previewChatAckRecipients({
      room,
      requiredUserIds: directUserIds,
      requiredGroupIds: ['g1'],
      requiredRoles: ['customrole'],
      client,
    });

    assert.equal(res.resolvedCount, 51);
    assert.equal(res.exceedsLimit, true);
    assert.equal(res.resolvedUserIds.length, 50);
    assert.ok(res.resolvedUserIds.includes('u50'));
    assert.ok(!res.resolvedUserIds.includes('u51'));
  } finally {
    if (original === undefined) {
      delete process.env.AUTH_GROUP_TO_ROLE_MAP;
    } else {
      process.env.AUTH_GROUP_TO_ROLE_MAP = original;
    }
  }
});

test('previewChatAckRecipients: returns reason and slices invalid list', async () => {
  const room = buildRoom({ id: 'p1', type: 'project' });
  const requiredUserIds = Array.from({ length: 25 }, (_, idx) => `u${idx + 1}`);
  const client = {
    userAccount: {
      findMany: async ({ where }) =>
        (where?.userName?.in || []).map((userName) => ({ userName })),
    },
    chatRoomMember: { findMany: async () => [] },
    groupAccount: createGroupAccountStub([]),
    userGroup: { findMany: async () => [] },
    projectMember: { findMany: async () => [{ userId: 'u1' }] },
  };

  const res = await previewChatAckRecipients({
    room,
    requiredUserIds,
    client,
  });

  assert.equal(res.reason, 'required_users_forbidden');
  assert.equal(res.invalidUserIds.length, 20);
  assert.equal(res.invalidUserIds[0], 'u2');
  assert.equal(res.invalidUserIds[19], 'u21');
});
