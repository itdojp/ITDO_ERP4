import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(TEST_DIR, '..');
const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function runCacheInvalidationScenario(scenario) {
  const script = String.raw`
    import { SignJWT, exportSPKI, generateKeyPair } from 'jose';

    process.env.DATABASE_URL = process.env.DATABASE_URL || '${MIN_DATABASE_URL}';
    process.env.AUTH_MODE = 'jwt';
    process.env.JWT_ISSUER = 'test-issuer';
    process.env.JWT_AUDIENCE = 'test-audience';
    process.env.AUTH_DB_USER_CONTEXT_CACHE_TTL_SECONDS = '300';
    process.env.AUTH_GROUP_TO_ROLE_MAP = 'Admins=admin';
    process.env.SCIM_BEARER_TOKEN = 'scim-test-token';
    process.env.ACTION_POLICY_ENFORCEMENT_PRESET = 'phase2_core';
    process.env.ACTION_POLICY_REQUIRED_ACTIONS = '';
    process.env.APPROVAL_EVIDENCE_REQUIRED_ACTIONS = '';

    const scenario = process.env.TEST_SCENARIO || 'userDeactivate';
    const now = new Date('2026-06-24T00:00:00.000Z');
    let account = {
      id: 'ua-1',
      externalId: 'principal-user',
      userName: 'legacy-user',
      displayName: 'Legacy User',
      givenName: 'Legacy',
      familyName: 'User',
      active: true,
      deletedAt: null,
      organization: 'org-1',
      emails: null,
      phoneNumbers: null,
      department: null,
      managerUserId: null,
      createdAt: now,
      updatedAt: now,
      memberships: [
        { group: { id: 'group-admin', displayName: 'Admins', active: true } },
      ],
    };
    let group = {
      id: 'group-admin',
      externalId: 'group-admin-ext',
      displayName: 'Admins',
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    let createdGroup = null;
    let notifyAuditStarted;
    let releaseDelayedAudit;
    const auditActions = [];
    const auditStarted = new Promise((resolve) => {
      notifyAuditStarted = resolve;
    });
    const delayedAuditRelease = new Promise((resolve) => {
      releaseDelayedAudit = resolve;
    });

    const { privateKey, publicKey } = await generateKeyPair('RS256');
    process.env.JWT_PUBLIC_KEY = await exportSPKI(publicKey);

    const { prisma } = await import('./dist/services/db.js');
    prisma.userIdentity.findFirst = async () => ({
      id: 'identity-1',
      status: 'active',
      effectiveUntil: null,
      userAccountId: account.id,
      userAccount: account,
    });
    prisma.userIdentity.findUnique = async () => null;
    prisma.userAccount.findUnique = async (args) => {
      if (args?.where?.id === account.id) return account;
      if (args?.where?.externalId === account.externalId) return account;
      if (args?.where?.userName === account.userName) return account;
      return null;
    };
    prisma.userAccount.findFirst = async () => null;
    prisma.userAccount.findMany = async (args) => {
      const ids = args?.where?.id?.in;
      if (Array.isArray(ids) && ids.includes(account.id)) {
        return [{ id: account.id }];
      }
      return [];
    };
    prisma.userAccount.update = async ({ data }) => {
      account = {
        ...account,
        ...data,
        active: typeof data.active === 'boolean' ? data.active : account.active,
        deletedAt: data.deletedAt === undefined ? account.deletedAt : data.deletedAt,
        updatedAt: new Date('2026-06-24T00:01:00.000Z'),
      };
      return account;
    };
    prisma.groupAccount.findUnique = async (args) => {
      if (args?.where?.id !== group.id) return null;
      if (args?.include?.memberships) {
        return {
          ...group,
          memberships: account.memberships.map((membership) => ({
            groupId: group.id,
            userId: account.id,
            user: { id: account.id, displayName: account.displayName },
            group: membership.group,
          })),
        };
      }
      return group;
    };
    prisma.groupAccount.findFirst = async () => null;
    prisma.groupAccount.count = async () => 1;
    prisma.groupAccount.findMany = async () => [
      {
        ...group,
        memberships: account.memberships.map((membership) => ({
          groupId: group.id,
          userId: account.id,
          user: { id: account.id, displayName: account.displayName },
          group: membership.group,
        })),
      },
    ];
    prisma.groupAccount.create = async ({ data }) => {
      createdGroup = {
        id: 'group-created',
        externalId: data.externalId ?? null,
        displayName: data.displayName,
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      return createdGroup;
    };
    prisma.groupAccount.update = async ({ data }) => {
      group = {
        ...group,
        ...data,
        displayName:
          typeof data.displayName === 'string' ? data.displayName : group.displayName,
        active: typeof data.active === 'boolean' ? data.active : group.active,
        updatedAt: new Date('2026-06-24T00:01:00.000Z'),
      };
      account = {
        ...account,
        memberships: account.memberships.map((membership) => ({
          ...membership,
          group:
            membership.group.id === group.id
              ? {
                  ...membership.group,
                  displayName: group.displayName,
                  active: group.active,
                }
              : membership.group,
        })),
      };
      return group;
    };
    prisma.userGroup.deleteMany = async () => {
      const count = account.memberships.length;
      account = { ...account, memberships: [] };
      return { count };
    };
    prisma.userGroup.createMany = async ({ data }) => {
      if (
        scenario === 'groupCreateWriteFailure' ||
        scenario === 'groupPutWriteFailure' ||
        scenario === 'groupPatchWriteFailure'
      ) {
        throw new Error('simulated group membership write failure');
      }
      const rows = Array.isArray(data) ? data : [];
      account = {
        ...account,
        memberships: rows.map(() => ({
          group: { id: group.id, displayName: group.displayName, active: group.active },
        })),
      };
      return { count: rows.length };
    };
    prisma.projectMember.findMany = async () => [];
    prisma.chatRoomMember.updateMany = async () => {
      if (scenario === 'userDeleteSideEffectFailure') {
        throw new Error('simulated personal GA membership failure');
      }
      return { count: 0 };
    };
    prisma.auditLog.create = async ({ data }) => {
      auditActions.push(data?.action);
      if (
        scenario === 'groupDeleteAuditDelay' &&
        data?.action === 'scim_group_disable'
      ) {
        notifyAuditStarted();
        await delayedAuditRelease;
      }
      return { id: 'audit-1' };
    };
    prisma.$transaction = async (arg) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      if (
        scenario !== 'userDeleteSideEffectFailure' &&
        scenario !== 'groupCreateWriteFailure' &&
        scenario !== 'groupPutWriteFailure' &&
        scenario !== 'groupPatchWriteFailure'
      ) {
        return arg(prisma);
      }
      const accountSnapshot = account;
      const groupSnapshot = group;
      const createdGroupSnapshot = createdGroup;
      try {
        return await arg(prisma);
      } catch (error) {
        account = accountSnapshot;
        group = groupSnapshot;
        createdGroup = createdGroupSnapshot;
        throw error;
      }
    };

    const token = await new SignJWT({
      sub: 'principal-user',
      roles: ['user'],
      jti: 'tok-cache-invalidation',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(process.env.JWT_ISSUER)
      .setAudience(process.env.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);

    const { buildServer } = await import('./dist/server.js');
    const server = await buildServer({ logger: false });
    try {
      const first = await server.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: 'Bearer ' + token },
      });
      const firstBody = JSON.parse(first.body || '{}');

      let scim;
      let concurrent;
      if (
        scenario === 'userDelete' ||
        scenario === 'userDeleteSideEffectFailure'
      ) {
        scim = await server.inject({
          method: 'DELETE',
          url: '/scim/v2/Users/ua-1',
          headers: { authorization: 'Bearer scim-test-token' },
        });
      } else if (scenario === 'groupDeleteAuditDelay') {
        const pendingScim = server.inject({
          method: 'DELETE',
          url: '/scim/v2/Groups/group-admin',
          headers: { authorization: 'Bearer scim-test-token' },
        });
        await auditStarted;
        concurrent = await server.inject({
          method: 'GET',
          url: '/me',
          headers: { authorization: 'Bearer ' + token },
        });
        releaseDelayedAudit();
        scim = await pendingScim;
      } else if (scenario === 'groupMembership') {
        scim = await server.inject({
          method: 'PUT',
          url: '/scim/v2/Groups/group-admin',
          headers: { authorization: 'Bearer scim-test-token' },
          payload: {
            displayName: 'Admins',
            externalId: 'group-admin-ext',
            members: [],
          },
        });
      } else if (scenario === 'groupPatchPartialFailure') {
        scim = await server.inject({
          method: 'PATCH',
          url: '/scim/v2/Groups/group-admin',
          headers: { authorization: 'Bearer scim-test-token' },
          payload: {
            Operations: [
              {
                op: 'remove',
                path: 'members',
                value: { members: [{ value: 'ua-1' }] },
              },
              {
                op: 'add',
                path: 'members',
                value: { members: [{ value: 'missing-user' }] },
              },
            ],
          },
        });
      } else if (scenario === 'groupCreateWriteFailure') {
        scim = await server.inject({
          method: 'POST',
          url: '/scim/v2/Groups',
          headers: { authorization: 'Bearer scim-test-token' },
          payload: {
            displayName: 'Created Admins',
            externalId: 'group-created-ext',
            members: [{ value: 'ua-1' }],
          },
        });
      } else if (scenario === 'groupPutWriteFailure') {
        scim = await server.inject({
          method: 'PUT',
          url: '/scim/v2/Groups/group-admin',
          headers: { authorization: 'Bearer scim-test-token' },
          payload: {
            displayName: 'Renamed Admins',
            externalId: 'group-admin-ext',
            members: [{ value: 'ua-1' }],
          },
        });
      } else if (scenario === 'groupPatchWriteFailure') {
        scim = await server.inject({
          method: 'PATCH',
          url: '/scim/v2/Groups/group-admin',
          headers: { authorization: 'Bearer scim-test-token' },
          payload: {
            Operations: [
              { op: 'replace', path: 'displayName', value: 'Renamed Admins' },
              {
                op: 'remove',
                path: 'members',
                value: { members: [{ value: 'ua-1' }] },
              },
              {
                op: 'add',
                path: 'members',
                value: { members: [{ value: 'ua-1' }] },
              },
            ],
          },
        });
      } else {
        scim = await server.inject({
          method: 'PATCH',
          url: '/scim/v2/Users/ua-1',
          headers: { authorization: 'Bearer scim-test-token' },
          payload: {
            Operations: [{ op: 'replace', value: { active: false } }],
          },
        });
      }

      const second = await server.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: 'Bearer ' + token },
      });
      process.stdout.write(JSON.stringify({
        firstStatus: first.statusCode,
        firstRoles: firstBody.user?.roles,
        scimStatus: scim.statusCode,
        accountActive: account.active,
        groupDisplayName: group.displayName,
        createdGroupId: createdGroup?.id,
        auditActions,
        concurrentStatus: concurrent?.statusCode,
        concurrentBody: concurrent
          ? JSON.parse(concurrent.body || '{}')
          : undefined,
        secondStatus: second.statusCode,
        secondBody: JSON.parse(second.body || '{}'),
      }));
    } finally {
      releaseDelayedAudit();
      await server.close();
    }
  `;

  return spawnSync(process.execPath, ['-e', script], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      DATABASE_URL: MIN_DATABASE_URL,
      TEST_SCENARIO: scenario,
    },
    encoding: 'utf8',
  });
}

test('SCIM user lifecycle changes clear cached auth context before TTL expiry', () => {
  const result = runCacheInvalidationScenario('userDeactivate');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.firstStatus, 200);
  assert.equal(payload.firstRoles.includes('admin'), true);
  assert.equal(payload.scimStatus, 200);
  assert.equal(payload.secondStatus, 401);
  assert.equal(payload.secondBody.error?.details?.reason, 'user_inactive');
});

test('SCIM user DELETE clears cached auth context after transactional deactivation', () => {
  const result = runCacheInvalidationScenario('userDelete');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.firstStatus, 200);
  assert.equal(payload.firstRoles.includes('admin'), true);
  assert.equal(payload.scimStatus, 204);
  assert.equal(payload.accountActive, false);
  assert.equal(payload.secondStatus, 401);
  assert.equal(payload.secondBody.error?.details?.reason, 'user_inactive');
});

test('SCIM group membership changes clear cached role-bearing auth context before TTL expiry', () => {
  const result = runCacheInvalidationScenario('groupMembership');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.firstStatus, 200);
  assert.equal(payload.firstRoles.includes('admin'), true);
  assert.equal(payload.scimStatus, 200);
  assert.equal(payload.secondStatus, 200);
  assert.equal(payload.secondBody.user?.roles.includes('admin'), false);
});

test('SCIM group revoke clears cached roles before awaiting the outer audit', () => {
  const result = runCacheInvalidationScenario('groupDeleteAuditDelay');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.firstStatus, 200);
  assert.equal(payload.firstRoles.includes('admin'), true);
  assert.equal(payload.scimStatus, 204);
  assert.equal(payload.concurrentStatus, 200);
  assert.equal(payload.concurrentBody.user?.roles.includes('admin'), false);
  assert.deepEqual(payload.concurrentBody.user?.groupAccountIds, []);
  assert.equal(payload.secondStatus, 200);
  assert.equal(payload.secondBody.user?.roles.includes('admin'), false);
});

test('SCIM group PATCH validates all members before applying any membership change', () => {
  const result = runCacheInvalidationScenario('groupPatchPartialFailure');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.firstStatus, 200);
  assert.equal(payload.firstRoles.includes('admin'), true);
  assert.equal(payload.scimStatus, 400);
  assert.equal(payload.secondStatus, 200);
  assert.equal(payload.secondBody.user?.roles.includes('admin'), true);
  assert.deepEqual(payload.secondBody.user?.groupAccountIds, ['group-admin']);
  assert.equal(payload.auditActions.includes('scim_group_patch'), false);
});

test('SCIM group creation rolls back the group when its membership write fails', () => {
  const result = runCacheInvalidationScenario('groupCreateWriteFailure');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.firstStatus, 200);
  assert.equal(payload.firstRoles.includes('admin'), true);
  assert.equal(payload.scimStatus, 500);
  assert.equal(payload.createdGroupId, undefined);
  assert.equal(payload.secondStatus, 200);
  assert.equal(payload.secondBody.user?.roles.includes('admin'), true);
  assert.deepEqual(payload.secondBody.user?.groupAccountIds, ['group-admin']);
  assert.equal(payload.auditActions.includes('scim_group_create'), false);
});

test('SCIM group PUT rolls back metadata and memberships when a membership write fails', () => {
  const result = runCacheInvalidationScenario('groupPutWriteFailure');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.firstStatus, 200);
  assert.equal(payload.firstRoles.includes('admin'), true);
  assert.equal(payload.scimStatus, 500);
  assert.equal(payload.groupDisplayName, 'Admins');
  assert.equal(payload.secondStatus, 200);
  assert.equal(payload.secondBody.user?.roles.includes('admin'), true);
  assert.deepEqual(payload.secondBody.user?.groupAccountIds, ['group-admin']);
  assert.equal(payload.auditActions.includes('scim_group_update'), false);
});

test('SCIM group PATCH rolls back metadata and all membership operations when a write fails', () => {
  const result = runCacheInvalidationScenario('groupPatchWriteFailure');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.firstStatus, 200);
  assert.equal(payload.firstRoles.includes('admin'), true);
  assert.equal(payload.scimStatus, 500);
  assert.equal(payload.groupDisplayName, 'Admins');
  assert.equal(payload.secondStatus, 200);
  assert.equal(payload.secondBody.user?.roles.includes('admin'), true);
  assert.deepEqual(payload.secondBody.user?.groupAccountIds, ['group-admin']);
  assert.equal(payload.auditActions.includes('scim_group_patch'), false);
});

test('SCIM user DELETE rolls back account deactivation when the personal GA side effect fails', () => {
  const result = runCacheInvalidationScenario('userDeleteSideEffectFailure');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.firstStatus, 200);
  assert.equal(payload.firstRoles.includes('admin'), true);
  assert.equal(payload.scimStatus, 500);
  assert.equal(payload.accountActive, true);
  assert.equal(payload.secondStatus, 200);
  assert.equal(payload.secondBody.user?.roles.includes('admin'), true);
});
