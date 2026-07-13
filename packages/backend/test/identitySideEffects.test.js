import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deactivateScimPersonalGaRoomForUser,
  ensureScimPersonalGaRoomForUser,
  recordDelegatedScopeDeniedAgentRun,
  resolveScimChatUserId,
  syncScimPersonalGaRoomMembership,
} from '../dist/application/identity/sideEffects.js';

const auditContext = {
  userId: 'scim-provisioner',
  actorRole: 'system',
  requestId: 'req-identity-side-effects',
  source: 'scim',
};

function scimUser(overrides = {}) {
  return {
    id: 'ua-1',
    externalId: 'employee-1',
    userName: 'employee.user',
    displayName: 'Employee User',
    active: true,
    ...overrides,
  };
}

function throwingPort(name) {
  return async () => {
    throw new Error(`${name} should not be called`);
  };
}

test('identity side effects: delegated scope denial is delegated to agent-run port and adapter failures propagate', async () => {
  const calls = [];
  const adapterError = new Error('agent-run-adapter-timeout');

  await assert.rejects(
    () =>
      recordDelegatedScopeDeniedAgentRun(
        {
          requestId: 'req-1',
          method: 'POST',
          path: '/me?debug=1',
          principalUserId: 'principal-user',
          actorUserId: 'agent-bot',
          scopes: ['read-only'],
        },
        {
          persistScopeDeniedAgentRun: async (input) => {
            calls.push(input);
            throw adapterError;
          },
        },
      ),
    /agent-run-adapter-timeout/,
  );

  assert.deepEqual(calls, [
    {
      requestId: 'req-1',
      method: 'POST',
      path: '/me?debug=1',
      principalUserId: 'principal-user',
      actorUserId: 'agent-bot',
      scopes: ['read-only'],
    },
  ]);
});

test('identity side effects: SCIM chat identifier prefers trimmed externalId and falls back to userName', () => {
  assert.equal(
    resolveScimChatUserId({ externalId: ' employee-1 ', userName: 'fallback' }),
    'employee-1',
  );
  assert.equal(
    resolveScimChatUserId({ externalId: '   ', userName: ' employee.user ' }),
    'employee.user',
  );
  assert.equal(resolveScimChatUserId({ externalId: '   ', userName: ' ' }), '');
});

test('identity side effects: unchanged active SCIM user does not call chat/audit adapters', async () => {
  await syncScimPersonalGaRoomMembership(
    {
      auditContext,
      before: scimUser(),
      after: scimUser(),
    },
    {
      ensurePersonalGaRoom: throwingPort('ensurePersonalGaRoom'),
      deactivatePersonalGaRoomMember: throwingPort(
        'deactivatePersonalGaRoomMember',
      ),
      logAudit: throwingPort('logAudit'),
    },
  );
});

test('identity side effects: SCIM identifier change ensures new personal room, deactivates old member, and limits audit metadata PII', async () => {
  const ensureCalls = [];
  const deactivateCalls = [];
  const auditCalls = [];
  const tx = { txName: 'scim-tx' };

  await syncScimPersonalGaRoomMembership(
    {
      auditContext,
      before: scimUser({ externalId: 'employee-1' }),
      after: scimUser({ externalId: 'employee-2' }),
      client: tx,
    },
    {
      ensurePersonalGaRoom: async (input) => {
        ensureCalls.push(input);
        return { roomId: 'pga_room_2' };
      },
      deactivatePersonalGaRoomMember: async (input) => {
        deactivateCalls.push(input);
        return { roomId: 'pga_room_1', updatedCount: 1 };
      },
      logAudit: async (entry) => {
        auditCalls.push(entry);
      },
    },
  );

  assert.equal(ensureCalls.length, 1);
  assert.equal(ensureCalls[0]?.userAccountId, 'ua-1');
  assert.equal(ensureCalls[0]?.userId, 'employee-2');
  assert.equal(ensureCalls[0]?.userName, 'employee.user');
  assert.equal(ensureCalls[0]?.displayName, 'Employee User');
  assert.equal(ensureCalls[0]?.createdBy, 'employee-2');
  assert.equal(ensureCalls[0]?.client, tx);

  assert.deepEqual(deactivateCalls, [
    {
      userAccountId: 'ua-1',
      userId: 'employee-1',
      updatedBy: 'employee-2',
      reason: 'scim_user_identifier_changed',
      client: tx,
    },
  ]);

  assert.deepEqual(
    auditCalls.map((entry) => entry.action),
    [
      'personal_ga_room_member_reactivated',
      'personal_ga_room_member_deactivated',
    ],
  );
  assert.deepEqual(auditCalls[0]?.metadata, {
    userAccountId: 'ua-1',
    userId: 'employee-2',
    roomId: 'pga_room_2',
    reason: 'scim_user_identifier_changed',
  });
  assert.deepEqual(auditCalls[1]?.metadata, {
    userAccountId: 'ua-1',
    userId: 'employee-1',
    roomId: 'pga_room_1',
    reason: 'scim_user_identifier_changed',
    replacedByUserId: 'employee-2',
  });
  const auditMetadataJson = JSON.stringify(
    auditCalls.map((entry) => entry.metadata),
  );
  assert.equal(auditMetadataJson.includes('Employee User'), false);
  assert.equal(auditMetadataJson.includes('employee.user'), false);
});

test('identity side effects: SCIM reactivation uses chat adapter failure as fail-closed route behavior input', async () => {
  await assert.rejects(
    () =>
      syncScimPersonalGaRoomMembership(
        {
          auditContext,
          before: scimUser({ active: false }),
          after: scimUser({ active: true }),
        },
        {
          ensurePersonalGaRoom: async () => {
            throw new Error('chat-adapter-timeout');
          },
          logAudit: throwingPort('logAudit'),
        },
      ),
    /chat-adapter-timeout/,
  );
});

test('identity side effects: SCIM delete deactivation keeps legacy audit metadata shape without reason', async () => {
  const deactivateCalls = [];
  const auditCalls = [];

  const result = await deactivateScimPersonalGaRoomForUser(
    {
      auditContext,
      user: scimUser(),
      reason: 'scim_user_deactivated',
    },
    {
      deactivatePersonalGaRoomMember: async (input) => {
        deactivateCalls.push(input);
        return { roomId: 'pga_room_1', updatedCount: 1 };
      },
      logAudit: async (entry) => {
        auditCalls.push(entry);
      },
    },
  );

  assert.deepEqual(result, {
    roomId: 'pga_room_1',
    updatedCount: 1,
    userId: 'employee-1',
  });
  assert.deepEqual(deactivateCalls, [
    {
      userAccountId: 'ua-1',
      userId: 'employee-1',
      updatedBy: 'employee-1',
      reason: 'scim_user_deactivated',
      client: undefined,
    },
  ]);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0]?.action, 'personal_ga_room_member_deactivated');
  assert.equal(auditCalls[0]?.targetId, 'pga_room_1:employee-1');
  assert.deepEqual(auditCalls[0]?.metadata, {
    userAccountId: 'ua-1',
    userId: 'employee-1',
    roomId: 'pga_room_1',
  });
});

test('identity side effects: SCIM ensure room is no-op without a chat identifier', async () => {
  const result = await ensureScimPersonalGaRoomForUser(
    {
      user: scimUser({ externalId: '   ', userName: '   ' }),
      actor: 'system',
    },
    {
      ensurePersonalGaRoom: throwingPort('ensurePersonalGaRoom'),
    },
  );

  assert.deepEqual(result, { roomId: null, userId: null });
});
