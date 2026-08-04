import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(TEST_DIR, '..');
const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function runManualGroupMutationScenario(scenario) {
  const script = String.raw`
    import { SignJWT, exportSPKI, generateKeyPair } from 'jose';

    process.env.DATABASE_URL = process.env.DATABASE_URL || '${MIN_DATABASE_URL}';
    process.env.AUTH_MODE = 'jwt';
    process.env.JWT_ISSUER = 'test-issuer';
    process.env.JWT_AUDIENCE = 'test-audience';
    process.env.AUTH_DB_USER_CONTEXT_CACHE_TTL_SECONDS = '300';
    process.env.AUTH_GROUP_TO_ROLE_MAP = 'Admins=admin';
    process.env.ACTION_POLICY_ENFORCEMENT_PRESET = 'phase2_core';
    process.env.ACTION_POLICY_REQUIRED_ACTIONS = '';
    process.env.APPROVAL_EVIDENCE_REQUIRED_ACTIONS = '';

    const scenario = process.env.TEST_SCENARIO || 'membership';
    const now = new Date('2026-08-04T00:00:00.000Z');
    let membershipActive = true;
    let group = {
      id: 'group-admin',
      externalId: null,
      scimMeta: null,
      displayName: 'Admins',
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    const accountSnapshot = () => ({
      id: 'ua-1',
      externalId: 'principal-user',
      userName: 'legacy-user',
      displayName: 'Legacy User',
      active: true,
      deletedAt: null,
      organization: 'org-1',
      memberships: membershipActive
        ? [{ group: { id: group.id, displayName: group.displayName, active: group.active } }]
        : [],
    });

    const { privateKey, publicKey } = await generateKeyPair('RS256');
    process.env.JWT_PUBLIC_KEY = await exportSPKI(publicKey);
    const sign = (subject, roles) => new SignJWT({ sub: subject, roles })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(process.env.JWT_ISSUER)
      .setAudience(process.env.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);
    const userToken = await sign('principal-user', ['user']);
    const adminToken = await sign('admin-principal', ['admin']);

    const { prisma } = await import('./dist/services/db.js');
    prisma.userIdentity.findFirst = async (args) => {
      if (args?.where?.providerSubject !== 'principal-user') return null;
      return {
        id: 'identity-1',
        status: 'active',
        effectiveUntil: null,
        userAccountId: 'ua-1',
        userAccount: accountSnapshot(),
      };
    };
    prisma.userIdentity.findUnique = async () => null;
    prisma.userAccount.findUnique = async () => null;
    prisma.userAccount.findFirst = async () => null;
    prisma.userAccount.findMany = async (args) => {
      const clauses = Array.isArray(args?.where?.OR) ? args.where.OR : [];
      const requested = clauses.flatMap((clause) => [
        ...(clause?.id?.in ?? []),
        ...(clause?.userName?.in ?? []),
      ]);
      return requested.includes('ua-1') || requested.includes('legacy-user')
        ? [{ id: 'ua-1', userName: 'legacy-user' }]
        : [];
    };
    prisma.groupAccount.findUnique = async (args) =>
      args?.where?.id === group.id ? group : null;
    prisma.groupAccount.findFirst = async () => null;
    prisma.groupAccount.update = async ({ data }) => {
      group = {
        ...group,
        ...data,
        updatedAt: new Date('2026-08-04T00:01:00.000Z'),
      };
      return group;
    };
    prisma.userGroup.deleteMany = async () => {
      const count = membershipActive ? 1 : 0;
      membershipActive = false;
      return { count };
    };
    prisma.projectMember.findMany = async () => [];
    prisma.auditLog.create = async () => ({ id: 'audit-1' });

    let listWhere;
    let countWhere;
    let detailWhere;
    prisma.knowledgeItem.findMany = async (args) => {
      listWhere = args?.where;
      return [];
    };
    prisma.knowledgeItem.count = async (args) => {
      countWhere = args?.where;
      return 0;
    };
    prisma.knowledgeItem.findFirst = async (args) => {
      detailWhere = args?.where;
      return null;
    };

    const { buildServer } = await import('./dist/server.js');
    const server = await buildServer({ logger: false });
    try {
      const first = await server.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: 'Bearer ' + userToken },
      });

      const mutation = scenario === 'membership'
        ? await server.inject({
            method: 'DELETE',
            url: '/groups/group-admin/members',
            headers: { authorization: 'Bearer ' + adminToken },
            payload: { userIds: ['ua-1'] },
          })
        : await server.inject({
            method: 'PATCH',
            url: '/groups/group-admin',
            headers: { authorization: 'Bearer ' + adminToken },
            payload: scenario === 'rename'
              ? { displayName: 'General' }
              : { active: false },
          });

      const second = await server.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: 'Bearer ' + userToken },
      });
      const secondBody = JSON.parse(second.body || '{}');

      let knowledge;
      if (scenario === 'membership') {
        const headers = { authorization: 'Bearer ' + userToken };
        const list = await server.inject({ method: 'GET', url: '/knowledge/items', headers });
        const count = await server.inject({ method: 'GET', url: '/knowledge/items/count', headers });
        const detail = await server.inject({ method: 'GET', url: '/knowledge/items/item-1', headers });
        const create = await server.inject({
          method: 'POST',
          url: '/knowledge/items',
          headers,
          payload: {
            scope: 'organization',
            organizationGroupIds: ['group-admin'],
            sourceType: 'manual',
          },
        });
        knowledge = {
          listStatus: list.statusCode,
          countStatus: count.statusCode,
          detailStatus: detail.statusCode,
          createStatus: create.statusCode,
          staleGroupInPredicates: [listWhere, countWhere, detailWhere]
            .some((where) => JSON.stringify(where).includes('group-admin')),
        };
      }

      process.stdout.write(JSON.stringify({
        firstStatus: first.statusCode,
        firstBody: JSON.parse(first.body || '{}'),
        mutationStatus: mutation.statusCode,
        secondStatus: second.statusCode,
        secondBody,
        knowledge,
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

test('manual membership removal invalidates cached authorization before TTL expiry', () => {
  const result = runManualGroupMutationScenario('membership');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.firstStatus, 200);
  assert.equal(payload.firstBody.user?.roles.includes('admin'), true);
  assert.deepEqual(payload.firstBody.user?.groupAccountIds, ['group-admin']);
  assert.equal(payload.mutationStatus, 200);
  assert.equal(payload.secondStatus, 200);
  assert.equal(payload.secondBody.user?.roles.includes('admin'), false);
  assert.deepEqual(payload.secondBody.user?.groupAccountIds, []);
  assert.deepEqual(payload.knowledge, {
    listStatus: 200,
    countStatus: 200,
    detailStatus: 404,
    createStatus: 400,
    staleGroupInPredicates: false,
  });
});

for (const scenario of ['rename', 'deactivate']) {
  test(`manual group ${scenario} invalidates cached group-derived role before TTL expiry`, () => {
    const result = runManualGroupMutationScenario(scenario);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout || '{}');
    assert.equal(payload.firstStatus, 200);
    assert.equal(payload.firstBody.user?.roles.includes('admin'), true);
    assert.equal(payload.mutationStatus, 200);
    assert.equal(payload.secondStatus, 200);
    assert.equal(payload.secondBody.user?.roles.includes('admin'), false);
    assert.deepEqual(
      payload.secondBody.user?.groupAccountIds,
      scenario === 'rename' ? ['group-admin'] : [],
    );
  });
}
