import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAccessibleChatSearchRoomIds } from '../dist/services/chatSearchAccess.js';

test('search room resolution delegates the complete ACL predicate to one DB query', async () => {
  const calls = [];
  const client = {
    async $queryRaw(query) {
      calls.push(query);
      return [{ id: 'company' }, { id: 'private-member' }];
    },
  };
  const result = await resolveAccessibleChatSearchRoomIds({
    userId: ' user-1 ',
    roles: ['user'],
    projectIds: ['project-visible'],
    groupIds: ['group-a'],
    groupAccountIds: ['group-account-a'],
    client,
  });

  assert.deepEqual(result, ['company', 'private-member']);
  assert.equal(calls.length, 1);
  const query = calls[0];
  assert.match(query.text, /FROM "ChatRoom" AS room/);
  assert.match(query.text, /room\."deletedAt" IS NULL/);
  assert.match(query.text, /FROM "ChatRoomMember" AS member/);
  assert.match(query.text, /member\."deletedAt" IS NULL/);
  assert.match(query.text, /room\."viewerGroupIds"/);
  assert.match(query.text, /room\."allowExternalUsers"/);
  assert.match(query.text, /room\."projectId"/);
  assert.doesNotMatch(query.text, /LIMIT/);
  assert.equal(query.values.includes('user-1'), true);
  assert.equal(
    query.values.some(
      (value) =>
        Array.isArray(value) &&
        value.includes('group-a') &&
        value.includes('group-account-a'),
    ),
    true,
  );
  assert.equal(
    query.values.some(
      (value) => Array.isArray(value) && value.includes('project-visible'),
    ),
    true,
  );
});

test('search room resolution passes the elevated role flag without granting malformed projects', async () => {
  const calls = [];
  const client = {
    async $queryRaw(query) {
      calls.push(query);
      return [];
    },
  };
  const result = await resolveAccessibleChatSearchRoomIds({
    userId: 'executive-1',
    roles: ['admin'],
    projectIds: [],
    groupIds: [],
    groupAccountIds: [],
    client,
  });
  assert.deepEqual(result, []);
  assert.equal(calls[0].values.includes(true), true);
  assert.match(calls[0].text, /IS NOT NULL/);
});

test('search room resolution rejects an empty canonical actor without querying', async () => {
  let calls = 0;
  const result = await resolveAccessibleChatSearchRoomIds({
    userId: ' ',
    roles: ['admin'],
    projectIds: [],
    groupIds: [],
    groupAccountIds: [],
    client: {
      async $queryRaw() {
        calls += 1;
        return [];
      },
    },
  });
  assert.deepEqual(result, []);
  assert.equal(calls, 0);
});
