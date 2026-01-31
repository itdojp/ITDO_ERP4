import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveChatAckRequiredRecipientUserIds } from '../dist/services/chatAckRecipients.js';

test('resolveChatAckRequiredRecipientUserIds: merges direct+group+role targets with stable ordering', async () => {
  const original = process.env.AUTH_GROUP_TO_ROLE_MAP;
  delete process.env.AUTH_GROUP_TO_ROLE_MAP;
  try {
    const client = {
      groupAccount: {
        findMany: async ({ where }) => {
          const selectors = [
            ...(where?.OR?.[0]?.id?.in || []),
            ...(where?.OR?.[1]?.displayName?.in || []),
          ];
          const rows = [];
          if (selectors.includes('g1')) {
            rows.push({ id: 'g1-id', displayName: 'g1' });
          }
          if (selectors.includes('admin')) {
            rows.push({ id: 'admin-id', displayName: 'admin' });
          }
          return rows;
        },
      },
      userGroup: {
        findMany: async ({ where }) => {
          const groupIds = where?.groupId?.in || [];
          const rows = [];
          if (groupIds.includes('g1-id')) {
            rows.push(
              { groupId: 'g1-id', user: { userName: 'u3' } },
              { groupId: 'g1-id', user: { userName: 'u2' } },
            );
          }
          if (groupIds.includes('admin-id')) {
            rows.push({ groupId: 'admin-id', user: { userName: 'u4' } });
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
    groupAccount: {
      findMany: async ({ where }) => {
        const selectors = [
          ...(where?.OR?.[0]?.id?.in || []),
          ...(where?.OR?.[1]?.displayName?.in || []),
        ];
        const rows = [];
        if (selectors.includes('g1')) {
          rows.push({ id: 'g1-id', displayName: 'g1' });
        }
        if (selectors.includes('g2')) {
          rows.push({ id: 'g2-id', displayName: 'g2' });
        }
        return rows;
      },
    },
    userGroup: {
      findMany: async ({ where }) => {
        const groupIds = where?.groupId?.in || [];
        const rows = [];
        if (groupIds.includes('g1-id')) {
          rows.push({ groupId: 'g1-id', user: { userName: 'u2' } });
        }
        if (groupIds.includes('g2-id')) {
          rows.push({ groupId: 'g2-id', user: { userName: 'u1' } });
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
