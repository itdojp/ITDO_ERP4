import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveChatAckRequiredRecipientUserIds } from '../dist/services/chatAckRecipients.js';

test('resolveChatAckRequiredRecipientUserIds: merges direct+group+role targets with stable ordering', async () => {
  const original = process.env.AUTH_GROUP_TO_ROLE_MAP;
  delete process.env.AUTH_GROUP_TO_ROLE_MAP;
  try {
    const client = {
      userGroup: {
        findMany: async ({ where }) => {
          const groupIds = where?.group?.displayName?.in || [];
          const rows = [];
          if (groupIds.includes('g1')) {
            rows.push(
              { group: { displayName: 'g1' }, user: { userName: 'u3' } },
              { group: { displayName: 'g1' }, user: { userName: 'u2' } },
            );
          }
          if (groupIds.includes('admin')) {
            rows.push({ group: { displayName: 'admin' }, user: { userName: 'u4' } });
          }
          return rows;
        },
      },
    };

    const res = await resolveChatAckRequiredRecipientUserIds({
      requiredUserIds: ['u1', 'u1'],
      requiredGroupIds: ['g1'],
      requiredRoles: ['admin'],
      client,
    });
    assert.deepEqual(res, ['u1', 'u2', 'u3', 'u4']);
  } finally {
    if (original === undefined) {
      delete process.env.AUTH_GROUP_TO_ROLE_MAP;
    } else {
      process.env.AUTH_GROUP_TO_ROLE_MAP = original;
    }
  }
});

test('resolveChatAckRequiredRecipientUserIds: preserves group order', async () => {
  const client = {
    userGroup: {
      findMany: async ({ where }) => {
        const groupIds = where?.group?.displayName?.in || [];
        const rows = [];
        if (groupIds.includes('g1')) {
          rows.push({ group: { displayName: 'g1' }, user: { userName: 'u2' } });
        }
        if (groupIds.includes('g2')) {
          rows.push({ group: { displayName: 'g2' }, user: { userName: 'u1' } });
        }
        return rows;
      },
    },
  };

  const res = await resolveChatAckRequiredRecipientUserIds({
    requiredUserIds: [],
    requiredGroupIds: ['g2', 'g1'],
    requiredRoles: [],
    client,
  });
  assert.deepEqual(res, ['u1', 'u2']);
});

