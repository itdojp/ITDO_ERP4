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
    prisma.groupAccount.update = async ({ data }) => {
      group = {
        ...group,
        ...data,
        displayName:
          typeof data.displayName === 'string' ? data.displayName : group.displayName,
        active: typeof data.active === 'boolean' ? data.active : group.active,
        updatedAt: new Date('2026-06-24T00:01:00.000Z'),
      };
      return group;
    };
    prisma.userGroup.deleteMany = async () => {
      const count = account.memberships.length;
      account = { ...account, memberships: [] };
      return { count };
    };
    prisma.userGroup.createMany = async ({ data }) => {
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
    prisma.chatRoomMember.updateMany = async () => ({ count: 0 });
    prisma.auditLog.create = async () => ({ id: 'audit-1' });
    prisma.$transaction = async (arg) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma));

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
      if (scenario === 'groupMembership') {
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
        secondStatus: second.statusCode,
        secondBody: JSON.parse(second.body || '{}'),
      }));
    } finally {
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

test('SCIM group PATCH membership changes clear cached role context before a later operation returns 400', () => {
  const result = runCacheInvalidationScenario('groupPatchPartialFailure');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.firstStatus, 200);
  assert.equal(payload.firstRoles.includes('admin'), true);
  assert.equal(payload.scimStatus, 400);
  assert.equal(payload.secondStatus, 200);
  assert.equal(payload.secondBody.user?.roles.includes('admin'), false);
});
