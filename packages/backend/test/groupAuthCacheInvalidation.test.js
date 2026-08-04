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

function runIdentityCacheExpiryScenario() {
  const script = String.raw`
    import { SignJWT, exportSPKI, generateKeyPair } from 'jose';

    process.env.DATABASE_URL = process.env.DATABASE_URL || '${MIN_DATABASE_URL}';
    process.env.AUTH_MODE = 'jwt';
    process.env.JWT_ISSUER = 'test-issuer';
    process.env.JWT_AUDIENCE = 'test-audience';
    process.env.AUTH_DB_USER_CONTEXT_CACHE_TTL_SECONDS = '300';
    process.env.ACTION_POLICY_ENFORCEMENT_PRESET = 'phase2_core';
    process.env.ACTION_POLICY_REQUIRED_ACTIONS = '';
    process.env.APPROVAL_EVIDENCE_REQUIRED_ACTIONS = '';

    let currentTime = Date.now();
    const identityExpiresAt = currentTime + 1_000;
    Date.now = () => currentTime;

    const { privateKey, publicKey } = await generateKeyPair('RS256');
    process.env.JWT_PUBLIC_KEY = await exportSPKI(publicKey);
    const token = await new SignJWT({ sub: 'principal-user', roles: ['user'] })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(process.env.JWT_ISSUER)
      .setAudience(process.env.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);

    let identityLookups = 0;
    const { prisma } = await import('./dist/services/db.js');
    prisma.userIdentity.findFirst = async () => {
      identityLookups += 1;
      return {
        id: 'identity-expiring',
        status: 'active',
        effectiveUntil: new Date(identityExpiresAt),
        userAccountId: 'ua-expiring',
        userAccount: {
          id: 'ua-expiring',
          externalId: 'principal-user',
          userName: 'legacy-user',
          active: true,
          deletedAt: null,
          organization: 'org-1',
          memberships: [],
        },
      };
    };
    prisma.userAccount.findUnique = async () => null;
    prisma.projectMember.findMany = async () => [];
    prisma.knowledgeItem.findMany = async () => [];

    const { buildServer } = await import('./dist/server.js');
    const server = await buildServer({ logger: false });
    const headers = { authorization: 'Bearer ' + token };
    try {
      const beforeExpiry = await server.inject({
        method: 'GET',
        url: '/knowledge/items',
        headers,
      });
      currentTime = identityExpiresAt - 1;
      const cachedBeforeExpiry = await server.inject({
        method: 'GET',
        url: '/knowledge/items',
        headers,
      });
      currentTime = identityExpiresAt + 1;
      const afterExpiry = await server.inject({
        method: 'GET',
        url: '/knowledge/items',
        headers,
      });
      process.stdout.write(JSON.stringify({
        beforeStatus: beforeExpiry.statusCode,
        cachedBeforeStatus: cachedBeforeExpiry.statusCode,
        afterStatus: afterExpiry.statusCode,
        afterBody: JSON.parse(afterExpiry.body || '{}'),
        identityLookups,
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
    },
    encoding: 'utf8',
  });
}

function runSessionIdentityCacheIsolationScenario() {
  const script = String.raw`
    process.env.DATABASE_URL = process.env.DATABASE_URL || '${MIN_DATABASE_URL}';
    process.env.AUTH_MODE = 'jwt_bff';
    process.env.AUTH_DB_USER_CONTEXT_CACHE_TTL_SECONDS = '300';
    process.env.JWT_ISSUER = 'https://accounts.google.com';
    process.env.JWT_AUDIENCE = 'client-id.apps.googleusercontent.com';
    process.env.JWT_PUBLIC_KEY =
      '-----BEGIN PUBLIC KEY-----\\nTEST-ONLY\\n-----END PUBLIC KEY-----';
    process.env.GOOGLE_OIDC_CLIENT_ID = 'client-id.apps.googleusercontent.com';
    process.env.GOOGLE_OIDC_CLIENT_SECRET = 'test-only-client-secret';
    process.env.GOOGLE_OIDC_REDIRECT_URI = 'http://localhost:3001/auth/google/callback';
    process.env.AUTH_FRONTEND_ORIGIN = 'http://localhost:4173';
    process.env.AUTH_SESSION_COOKIE_SECURE = 'false';
    process.env.ACTION_POLICY_ENFORCEMENT_PRESET = 'phase2_core';
    process.env.ACTION_POLICY_REQUIRED_ACTIONS = '';
    process.env.APPROVAL_EVIDENCE_REQUIRED_ACTIONS = '';

    let currentTime = Date.now();
    Date.now = () => currentTime;
    const expiringIdentityAt = currentTime + 1_000;
    const { createHash } = await import('node:crypto');
    const sessionFixtures = [
      {
        token: 'positive-active-token',
        id: 'positive-active-session',
        providerSubject: 'shared-positive-subject',
        userIdentityId: 'positive-active-identity',
        userAccountId: 'positive-active-account',
      },
      {
        token: 'positive-disabled-token',
        id: 'positive-disabled-session',
        providerSubject: 'shared-positive-subject',
        userIdentityId: 'positive-disabled-identity',
        userAccountId: 'positive-disabled-account',
      },
      {
        token: 'negative-disabled-token',
        id: 'negative-disabled-session',
        providerSubject: 'shared-negative-subject',
        userIdentityId: 'negative-disabled-identity',
        userAccountId: 'negative-disabled-account',
      },
      {
        token: 'negative-active-token',
        id: 'negative-active-session',
        providerSubject: 'shared-negative-subject',
        userIdentityId: 'negative-active-identity',
        userAccountId: 'negative-active-account',
      },
      {
        token: 'expiring-active-token',
        id: 'expiring-active-session',
        providerSubject: 'expiring-subject',
        userIdentityId: 'expiring-active-identity',
        userAccountId: 'expiring-active-account',
      },
    ].map((fixture) => ({
      ...fixture,
      providerType: 'google_oidc',
      issuer: 'https://accounts.google.com',
      expiresAt: new Date(Date.now() + 60_000),
      idleExpiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    }));
    const tokenHash = (token) =>
      createHash('sha256').update(token).digest('hex');
    const sessionsByHash = new Map(
      sessionFixtures.map((fixture) => [tokenHash(fixture.token), fixture]),
    );
    const sessionsById = new Map(
      sessionFixtures.map((fixture) => [fixture.id, fixture]),
    );
    const identityLookups = new Map();
    const identityStatuses = new Map(
      sessionFixtures.map((fixture) => [
        fixture.userIdentityId,
        fixture.userIdentityId.endsWith('active-identity')
          ? 'active'
          : 'disabled',
      ]),
    );

    const { prisma } = await import('./dist/services/db.js');
    prisma.authSession.findUnique = async ({ where }) =>
      sessionsByHash.get(where.sessionTokenHash) ?? null;
    prisma.authSession.update = async ({ where, data }) => ({
      ...sessionsById.get(where.id),
      ...data,
    });
    prisma.userIdentity.findUnique = async ({ where }) => {
      identityLookups.set(
        where.id,
        (identityLookups.get(where.id) ?? 0) + 1,
      );
      const active = identityStatuses.get(where.id) === 'active';
      const accountId = where.id.replace('-identity', '-account');
      return {
        id: where.id,
        status: active ? 'active' : 'disabled',
        effectiveUntil:
          where.id === 'expiring-active-identity'
            ? new Date(expiringIdentityAt)
            : null,
        userAccountId: accountId,
        userAccount: active
          ? {
              id: accountId,
              externalId: null,
              userName: accountId,
              active: true,
              deletedAt: null,
              organization: 'org-1',
              memberships: [],
            }
          : null,
      };
    };
    prisma.projectMember.findMany = async () => [];
    prisma.knowledgeItem.findMany = async () => [];

    const { buildServer } = await import('./dist/server.js');
    const server = await buildServer({ logger: false });
    const request = (token) => server.inject({
      method: 'GET',
      url: '/knowledge/items',
      headers: { cookie: 'erp4_session=' + token },
    });
    try {
      const positiveActive = await request('positive-active-token');
      const positiveDisabled = await request('positive-disabled-token');
      const negativeDisabled = await request('negative-disabled-token');
      const negativeActive = await request('negative-active-token');
      identityStatuses.set('positive-active-identity', 'disabled');
      const { invalidateUserDbContextCache } = await import(
        './dist/plugins/auth.js'
      );
      invalidateUserDbContextCache({
        userId: 'shared-positive-subject',
        auth: {
          principalUserId: 'shared-positive-subject',
          actorUserId: 'shared-positive-subject',
          scopes: [],
          delegated: false,
          providerType: 'google_oidc',
          issuer: 'https://accounts.google.com',
        },
      });
      const invalidatedPositive = await request('positive-active-token');
      const expiringBefore = await request('expiring-active-token');
      currentTime = expiringIdentityAt - 1;
      const expiringCached = await request('expiring-active-token');
      currentTime = expiringIdentityAt + 1;
      const expiringAfter = await request('expiring-active-token');
      process.stdout.write(JSON.stringify({
        statuses: {
          positiveActive: positiveActive.statusCode,
          positiveDisabled: positiveDisabled.statusCode,
          negativeDisabled: negativeDisabled.statusCode,
          negativeActive: negativeActive.statusCode,
          invalidatedPositive: invalidatedPositive.statusCode,
          expiringBefore: expiringBefore.statusCode,
          expiringCached: expiringCached.statusCode,
          expiringAfter: expiringAfter.statusCode,
        },
        reasons: {
          positiveDisabled:
            JSON.parse(positiveDisabled.body || '{}').error?.details?.reason,
          negativeDisabled:
            JSON.parse(negativeDisabled.body || '{}').error?.details?.reason,
          expiringAfter:
            JSON.parse(expiringAfter.body || '{}').error?.details?.reason,
        },
        identityLookups: Object.fromEntries(identityLookups),
      }));
    } finally {
      await server.close();
    }
  `;

  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      DATABASE_URL: MIN_DATABASE_URL,
    },
    encoding: 'utf8',
  });
}

function runInFlightCacheInvalidationScenario(scenario) {
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

    const scenario = process.env.TEST_SCENARIO;
    const principal = scenario + '-principal';
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    process.env.JWT_PUBLIC_KEY = await exportSPKI(publicKey);
    const token = await new SignJWT({ sub: principal, roles: ['user'] })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(process.env.JWT_ISSUER)
      .setAudience(process.env.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);

    let identityStatus = 'active';
    let membershipActive = true;
    let identityLookups = 0;
    let notifyLookupStarted;
    let releaseFirstLookup;
    const lookupStarted = new Promise((resolve) => {
      notifyLookupStarted = resolve;
    });
    const firstLookupRelease = new Promise((resolve) => {
      releaseFirstLookup = resolve;
    });
    const accountSnapshot = (includeMembership) => ({
      id: scenario + '-account',
      externalId: principal,
      userName: scenario + '-legacy-user',
      active: true,
      deletedAt: null,
      organization: 'org-1',
      memberships: includeMembership
        ? [{ group: { id: 'group-admin', displayName: 'Admins', active: true } }]
        : [],
    });

    const { prisma } = await import('./dist/services/db.js');
    prisma.userIdentity.findFirst = async () => {
      identityLookups += 1;
      const snapshot = {
        id: scenario + '-identity',
        status: identityStatus,
        effectiveUntil: null,
        userAccountId: scenario + '-account',
        userAccount: accountSnapshot(membershipActive),
      };
      if (identityLookups === 1) {
        notifyLookupStarted();
        await firstLookupRelease;
      }
      return snapshot;
    };
    prisma.userAccount.findUnique = async () => null;
    prisma.projectMember.findMany = async () => [];
    prisma.knowledgeItem.findMany = async () => [];

    const { buildServer } = await import('./dist/server.js');
    const {
      clearUserDbContextCache,
      invalidateUserDbContextCache,
    } = await import('./dist/plugins/auth.js');
    const server = await buildServer({ logger: false });
    const request = () => server.inject({
      method: 'GET',
      url: scenario === 'subject' ? '/knowledge/items' : '/me',
      headers: { authorization: 'Bearer ' + token },
    });
    try {
      const firstPending = request();
      await lookupStarted;
      if (scenario === 'subject') {
        identityStatus = 'disabled';
        invalidateUserDbContextCache({
          userId: principal,
          auth: {
            principalUserId: principal,
            actorUserId: principal,
            scopes: [],
            delegated: false,
            providerType: 'google_oidc',
            issuer: process.env.JWT_ISSUER,
          },
        });
      } else {
        membershipActive = false;
        clearUserDbContextCache();
      }
      releaseFirstLookup();
      const first = await firstPending;
      const second = await request();
      const firstBody = JSON.parse(first.body || '{}');
      const secondBody = JSON.parse(second.body || '{}');
      process.stdout.write(JSON.stringify({
        firstStatus: first.statusCode,
        secondStatus: second.statusCode,
        secondReason: secondBody.error?.details?.reason,
        firstAdmin: firstBody.user?.roles?.includes('admin') ?? false,
        secondAdmin: secondBody.user?.roles?.includes('admin') ?? false,
        secondGroups: secondBody.user?.groupAccountIds ?? [],
        identityLookups,
      }));
    } finally {
      releaseFirstLookup();
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

test('identity effectiveUntil bounds the positive DB context cache TTL', () => {
  const result = runIdentityCacheExpiryScenario();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.beforeStatus, 200);
  assert.equal(payload.cachedBeforeStatus, 200);
  assert.equal(payload.afterStatus, 401);
  assert.equal(payload.afterBody.error?.details?.reason, 'user_inactive');
  assert.equal(payload.identityLookups, 2);
});

test('session DB context cache is isolated by canonical identity and account', () => {
  const result = runSessionIdentityCacheIsolationScenario();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.deepEqual(payload.statuses, {
    positiveActive: 200,
    positiveDisabled: 401,
    negativeDisabled: 401,
    negativeActive: 200,
    invalidatedPositive: 401,
    expiringBefore: 200,
    expiringCached: 200,
    expiringAfter: 401,
  });
  assert.deepEqual(payload.reasons, {
    positiveDisabled: 'user_inactive',
    negativeDisabled: 'user_inactive',
    expiringAfter: 'user_inactive',
  });
  assert.deepEqual(payload.identityLookups, {
    'positive-active-identity': 2,
    'positive-disabled-identity': 1,
    'negative-disabled-identity': 1,
    'negative-active-identity': 1,
    'expiring-active-identity': 2,
  });
});

test('subject invalidation prevents an in-flight stale identity from re-entering the cache', () => {
  const result = runInFlightCacheInvalidationScenario('subject');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.firstStatus, 200);
  assert.equal(payload.secondStatus, 401);
  assert.equal(payload.secondReason, 'user_inactive');
  assert.equal(payload.identityLookups, 2);
});

test('global clear prevents in-flight stale group context from re-entering the cache', () => {
  const result = runInFlightCacheInvalidationScenario('global');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.firstStatus, 200);
  assert.equal(payload.secondStatus, 200);
  assert.equal(payload.firstAdmin, true);
  assert.equal(payload.secondAdmin, false);
  assert.deepEqual(payload.secondGroups, []);
  assert.equal(payload.identityLookups, 2);
});
