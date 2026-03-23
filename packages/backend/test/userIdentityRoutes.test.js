import assert from 'node:assert/strict';
import test from 'node:test';
import argon2 from 'argon2';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const [model, method] = path.split('.');
    const target = prisma[model];
    if (!target || typeof target[method] !== 'function') {
      throw new Error(`invalid stub target: ${path}`);
    }
    const original = target[method];
    target[method] = stub;
    restores.push(() => {
      target[method] = original;
    });
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const restore of restores.reverse()) restore();
    });
}

test('GET /auth/user-identities requires system_admin role', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs({}, async () => {
    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method: 'GET',
        url: '/auth/user-identities',
        headers: {
          'x-user-id': 'admin-user',
          'x-roles': 'admin',
        },
      });
      assert.equal(res.statusCode, 403, res.body);
      const body = JSON.parse(res.body);
      assert.equal(body.error.code, 'forbidden');
    } finally {
      await server.close();
    }
  });
});

test('GET /auth/user-identities lists identities with filters', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedFindMany = null;
  await withPrismaStubs(
    {
      'userIdentity.findMany': async (args) => {
        capturedFindMany = args;
        return [
          {
            id: 'identity-google-001',
            userAccountId: 'user-001',
            providerType: 'google_oidc',
            providerSubject: 'google-sub-001',
            issuer: 'https://accounts.google.com',
            emailSnapshot: 'user@example.com',
            status: 'active',
            lastAuthenticatedAt: new Date('2026-03-23T01:00:00.000Z'),
            linkedAt: new Date('2026-03-23T00:00:00.000Z'),
            effectiveUntil: null,
            rollbackWindowUntil: new Date('2026-03-30T00:00:00.000Z'),
            note: 'migration window',
            createdAt: new Date('2026-03-23T00:00:00.000Z'),
            updatedAt: new Date('2026-03-23T00:00:00.000Z'),
            userAccount: {
              id: 'user-001',
              userName: 'legacy-user',
              displayName: 'Legacy User',
              active: true,
              deletedAt: null,
            },
            localCredential: null,
          },
        ];
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/auth/user-identities?userAccountId=user-001&providerType=google_oidc&status=active&limit=10&offset=5',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.limit, 10);
        assert.equal(body.offset, 5);
        assert.equal(body.items.length, 1);
        assert.equal(body.items[0].providerType, 'google_oidc');
        assert.equal(
          body.items[0].rollbackWindowUntil,
          '2026-03-30T00:00:00.000Z',
        );
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedFindMany?.where?.userAccountId, 'user-001');
  assert.equal(capturedFindMany?.where?.providerType, 'google_oidc');
  assert.equal(capturedFindMany?.where?.status, 'active');
  assert.equal(capturedFindMany?.take, 10);
  assert.equal(capturedFindMany?.skip, 5);
});

test('POST /auth/user-identities/google-link creates Google identity and writes audit log', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedCreate = null;
  let capturedAudit = null;
  await withPrismaStubs(
    {
      'userAccount.findUnique': async () => ({
        id: 'user-001',
        active: true,
        deletedAt: null,
        identities: [],
      }),
      'userIdentity.create': async (args) => {
        capturedCreate = args;
        return {
          id: 'identity-google-001',
          userAccountId: 'user-001',
          providerType: 'google_oidc',
          providerSubject: args.data.providerSubject,
          issuer: args.data.issuer,
          emailSnapshot: args.data.emailSnapshot,
          status: 'active',
          lastAuthenticatedAt: null,
          linkedAt: new Date('2026-03-23T00:00:00.000Z'),
          effectiveUntil: args.data.effectiveUntil,
          rollbackWindowUntil: args.data.rollbackWindowUntil,
          note: args.data.note,
          createdAt: new Date('2026-03-23T00:00:00.000Z'),
          updatedAt: new Date('2026-03-23T00:00:00.000Z'),
          userAccount: {
            id: 'user-001',
            userName: 'legacy-user',
            displayName: 'Legacy User',
            active: true,
            deletedAt: null,
          },
          localCredential: null,
        };
      },
      'auditLog.create': async (args) => {
        capturedAudit = args;
        return { id: 'audit-identity-001' };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/auth/user-identities/google-link',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
          },
          payload: {
            userAccountId: 'user-001',
            issuer: 'https://accounts.google.com',
            providerSubject: 'google-sub-001',
            emailSnapshot: 'user@example.com',
            effectiveUntil: '2026-03-31T00:00:00.000Z',
            rollbackWindowUntil: '2026-03-25T00:00:00.000Z',
            note: 'approved migration',
            ticketId: 'AUTH-MIG-001',
            reasonCode: 'google_link',
          },
        });
        assert.equal(res.statusCode, 201, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.providerType, 'google_oidc');
        assert.equal(body.providerSubject, 'google-sub-001');
        assert.equal(body.note, 'approved migration');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedCreate?.data?.providerType, 'google_oidc');
  assert.equal(capturedCreate?.data?.issuer, 'https://accounts.google.com');
  assert.equal(capturedAudit?.data?.action, 'user_identity_google_linked');
  assert.equal(capturedAudit?.data?.metadata?.ticketId, 'AUTH-MIG-001');
});

test('POST /auth/user-identities/local-link creates local identity with bootstrap password rotation', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedCreate = null;
  await withPrismaStubs(
    {
      'userAccount.findUnique': async () => ({
        id: 'user-001',
        userName: 'legacy-user',
        displayName: 'Legacy User',
        active: true,
        deletedAt: null,
        identities: [],
      }),
      'localCredential.findUnique': async () => null,
      'userIdentity.create': async (args) => {
        capturedCreate = args;
        return {
          id: 'identity-local-001',
          userAccountId: 'user-001',
          providerType: 'local_password',
          providerSubject: 'local-subject-001',
          issuer: 'erp4_local',
          emailSnapshot: null,
          status: 'active',
          lastAuthenticatedAt: null,
          linkedAt: new Date('2026-03-23T00:00:00.000Z'),
          effectiveUntil: args.data.effectiveUntil,
          rollbackWindowUntil: args.data.rollbackWindowUntil,
          note: args.data.note,
          createdAt: new Date('2026-03-23T00:00:00.000Z'),
          updatedAt: new Date('2026-03-23T00:00:00.000Z'),
          userAccount: {
            id: 'user-001',
            userName: 'legacy-user',
            displayName: 'Legacy User',
            active: true,
            deletedAt: null,
          },
          localCredential: {
            loginId: args.data.localCredential.create.loginId,
            passwordAlgo: 'argon2id',
            mfaRequired: args.data.localCredential.create.mfaRequired,
            mfaSecretRef: null,
            mustRotatePassword:
              args.data.localCredential.create.mustRotatePassword,
            failedAttempts: 0,
            lockedUntil: null,
            passwordChangedAt:
              args.data.localCredential.create.passwordChangedAt,
          },
        };
      },
      'auditLog.create': async () => ({ id: 'audit-identity-002' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/auth/user-identities/local-link',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
          },
          payload: {
            userAccountId: 'user-001',
            loginId: 'Local.User@example.com ',
            password: 'LocalPassword123',
            rollbackWindowUntil: '2026-03-25T00:00:00.000Z',
            ticketId: 'AUTH-MIG-002',
            reasonCode: 'local_link',
          },
        });
        assert.equal(res.statusCode, 201, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.providerType, 'local_password');
        assert.equal(body.localCredential.loginId, 'local.user@example.com');
        assert.equal(body.localCredential.mfaRequired, true);
        assert.equal(body.localCredential.mustRotatePassword, true);
      } finally {
        await server.close();
      }
    },
  );

  const passwordHash =
    capturedCreate?.data?.localCredential?.create?.passwordHash;
  assert.equal(capturedCreate?.data?.providerType, 'local_password');
  assert.equal(
    capturedCreate?.data?.localCredential?.create?.mfaRequired,
    true,
  );
  assert.equal(
    capturedCreate?.data?.localCredential?.create?.mustRotatePassword,
    true,
  );
  assert.equal(await argon2.verify(passwordHash, 'LocalPassword123'), true);
});

test('PATCH /auth/user-identities/:identityId updates status and windows', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedUpdate = null;
  let capturedAudit = null;
  await withPrismaStubs(
    {
      'userIdentity.findUnique': async () => ({
        id: 'identity-google-001',
        userAccountId: 'user-001',
        providerType: 'google_oidc',
        providerSubject: 'google-sub-001',
        issuer: 'https://accounts.google.com',
        emailSnapshot: 'user@example.com',
        status: 'active',
        lastAuthenticatedAt: null,
        linkedAt: new Date('2026-03-23T00:00:00.000Z'),
        effectiveUntil: null,
        rollbackWindowUntil: null,
        note: null,
        createdAt: new Date('2026-03-23T00:00:00.000Z'),
        updatedAt: new Date('2026-03-23T00:00:00.000Z'),
        userAccount: {
          id: 'user-001',
          userName: 'legacy-user',
          displayName: 'Legacy User',
          active: true,
          deletedAt: null,
        },
        localCredential: null,
      }),
      'userIdentity.count': async () => 1,
      'userIdentity.update': async (args) => {
        capturedUpdate = args;
        return {
          id: 'identity-google-001',
          userAccountId: 'user-001',
          providerType: 'google_oidc',
          providerSubject: 'google-sub-001',
          issuer: 'https://accounts.google.com',
          emailSnapshot: 'user@example.com',
          status: args.data.status,
          lastAuthenticatedAt: null,
          linkedAt: new Date('2026-03-23T00:00:00.000Z'),
          effectiveUntil: args.data.effectiveUntil,
          rollbackWindowUntil: args.data.rollbackWindowUntil,
          note: args.data.note,
          createdAt: new Date('2026-03-23T00:00:00.000Z'),
          updatedAt: new Date('2026-03-23T01:00:00.000Z'),
          userAccount: {
            id: 'user-001',
            userName: 'legacy-user',
            displayName: 'Legacy User',
            active: true,
            deletedAt: null,
          },
          localCredential: null,
        };
      },
      'auditLog.create': async (args) => {
        capturedAudit = args;
        return { id: 'audit-identity-003' };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'PATCH',
          url: '/auth/user-identities/identity-google-001',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
          },
          payload: {
            status: 'disabled',
            effectiveUntil: '2026-03-24T00:00:00.000Z',
            rollbackWindowUntil: '2026-03-25T00:00:00.000Z',
            note: 'cutover complete',
            ticketId: 'AUTH-MIG-003',
            reasonCode: 'google_disable',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.status, 'disabled');
        assert.equal(body.note, 'cutover complete');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedUpdate?.data?.status, 'disabled');
  assert.equal(capturedAudit?.data?.action, 'user_identity_updated');
  assert.deepEqual(
    [...(capturedAudit?.data?.metadata?.changedFields ?? [])].sort(),
    ['effectiveUntil', 'note', 'rollbackWindowUntil', 'status'].sort(),
  );
});

test('PATCH /auth/user-identities/:identityId rejects disabling the last active identity', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'userIdentity.findUnique': async () => ({
        id: 'identity-google-001',
        userAccountId: 'user-001',
        providerType: 'google_oidc',
        providerSubject: 'google-sub-001',
        issuer: 'https://accounts.google.com',
        emailSnapshot: 'user@example.com',
        status: 'active',
        lastAuthenticatedAt: null,
        linkedAt: new Date('2026-03-23T00:00:00.000Z'),
        effectiveUntil: null,
        rollbackWindowUntil: null,
        note: null,
        createdAt: new Date('2026-03-23T00:00:00.000Z'),
        updatedAt: new Date('2026-03-23T00:00:00.000Z'),
        userAccount: {
          id: 'user-001',
          userName: 'legacy-user',
          displayName: 'Legacy User',
          active: true,
          deletedAt: null,
        },
        localCredential: null,
      }),
      'userIdentity.count': async () => 0,
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'PATCH',
          url: '/auth/user-identities/identity-google-001',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
          },
          payload: {
            status: 'disabled',
            ticketId: 'AUTH-MIG-004',
            reasonCode: 'google_disable',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error.code, 'identity_last_active_conflict');
      } finally {
        await server.close();
      }
    },
  );
});
