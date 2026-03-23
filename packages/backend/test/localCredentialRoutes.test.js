import assert from 'node:assert/strict';
import test from 'node:test';
import argon2 from 'argon2';
import { Prisma } from '@prisma/client';

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

test('GET /auth/local-credentials requires system_admin role', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs({}, async () => {
    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method: 'GET',
        url: '/auth/local-credentials',
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

test('GET /auth/local-credentials lists local credentials with filters', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedFindMany = null;
  await withPrismaStubs(
    {
      'userIdentity.findMany': async (args) => {
        capturedFindMany = args;
        return [
          {
            id: 'identity-001',
            userAccountId: 'user-001',
            providerType: 'local_password',
            providerSubject: 'local-subject-001',
            issuer: 'erp4_local',
            status: 'active',
            lastAuthenticatedAt: new Date('2026-03-23T01:00:00.000Z'),
            linkedAt: new Date('2026-03-23T00:00:00.000Z'),
            createdAt: new Date('2026-03-23T00:00:00.000Z'),
            updatedAt: new Date('2026-03-23T00:00:00.000Z'),
            userAccount: {
              id: 'user-001',
              userName: 'local-user',
              displayName: 'Local User',
              active: true,
              deletedAt: null,
            },
            localCredential: {
              id: 'cred-001',
              loginId: 'local-user@example.com',
              passwordAlgo: 'argon2id',
              mfaRequired: true,
              mfaSecretRef: 'totp://secret',
              failedAttempts: 0,
              lockedUntil: null,
              passwordChangedAt: new Date('2026-03-23T00:00:00.000Z'),
              createdAt: new Date('2026-03-23T00:00:00.000Z'),
              updatedAt: new Date('2026-03-23T00:30:00.000Z'),
            },
          },
        ];
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/auth/local-credentials?userAccountId=user-001&status=active&limit=10&offset=5',
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
        assert.equal(body.items[0].loginId, 'local-user@example.com');
        assert.equal(body.items[0].mfaSecretConfigured, true);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedFindMany?.where?.userAccountId, 'user-001');
  assert.equal(capturedFindMany?.where?.status, 'active');
  assert.equal(capturedFindMany?.take, 10);
  assert.equal(capturedFindMany?.skip, 5);
});

test('POST /auth/local-credentials creates local credential and writes audit log', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedCreate = null;
  let capturedAudit = null;
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
          id: 'identity-001',
          userAccountId: 'user-001',
          providerType: 'local_password',
          providerSubject: 'local-subject-001',
          issuer: 'erp4_local',
          status: 'active',
          lastAuthenticatedAt: null,
          linkedAt: new Date('2026-03-23T00:00:00.000Z'),
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
            id: 'cred-001',
            loginId: args.data.localCredential.create.loginId,
            passwordAlgo: 'argon2id',
            mfaRequired: args.data.localCredential.create.mfaRequired,
            mfaSecretRef: null,
            failedAttempts: 0,
            lockedUntil: null,
            passwordChangedAt:
              args.data.localCredential.create.passwordChangedAt,
            createdAt: new Date('2026-03-23T00:00:00.000Z'),
            updatedAt: new Date('2026-03-23T00:00:00.000Z'),
          },
        };
      },
      'auditLog.create': async (args) => {
        capturedAudit = args;
        return { id: 'audit-001' };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/auth/local-credentials',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
          },
          payload: {
            userAccountId: 'user-001',
            loginId: 'Local.User@example.com ',
            password: 'LocalPassword123',
            mfaRequired: true,
            ticketId: 'AUTH-001',
            reasonCode: 'admin_issue',
            reasonText: 'exception user onboarding',
          },
        });
        assert.equal(res.statusCode, 201, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.loginId, 'local.user@example.com');
        assert.equal(body.status, 'active');
        assert.equal(body.mfaRequired, true);
      } finally {
        await server.close();
      }
    },
  );

  const hash = capturedCreate?.data?.localCredential?.create?.passwordHash;
  assert.equal(capturedCreate?.data?.issuer, 'erp4_local');
  assert.equal(capturedCreate?.data?.providerType, 'local_password');
  assert.equal(
    capturedCreate?.data?.localCredential?.create?.loginId,
    'local.user@example.com',
  );
  assert.equal(typeof hash, 'string');
  assert.equal(await argon2.verify(hash, 'LocalPassword123'), true);
  assert.equal(capturedAudit?.data?.action, 'local_credential_created');
  assert.equal(capturedAudit?.data?.metadata?.ticketId, 'AUTH-001');
});

test('POST /auth/local-credentials rejects duplicate local credential', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'userAccount.findUnique': async () => ({
        id: 'user-001',
        userName: 'legacy-user',
        displayName: 'Legacy User',
        active: true,
        deletedAt: null,
        identities: [
          {
            id: 'identity-001',
            status: 'active',
            localCredential: { id: 'cred-001' },
          },
        ],
      }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/auth/local-credentials',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
          },
          payload: {
            userAccountId: 'user-001',
            loginId: 'local-user@example.com',
            password: 'LocalPassword123',
            ticketId: 'AUTH-002',
            reasonCode: 'admin_issue',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error.code, 'local_credential_exists');
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /auth/local-credentials maps atomic user credential conflicts to local_credential_exists', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

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
      'userIdentity.create': async () => {
        throw new Prisma.PrismaClientKnownRequestError('unique conflict', {
          code: 'P2002',
          clientVersion: 'test',
          meta: {
            target: ['userAccountId', 'providerType', 'issuer'],
          },
        });
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/auth/local-credentials',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
          },
          payload: {
            userAccountId: 'user-001',
            loginId: 'local-user@example.com',
            password: 'LocalPassword123',
            ticketId: 'AUTH-002A',
            reasonCode: 'admin_issue',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error.code, 'local_credential_exists');
      } finally {
        await server.close();
      }
    },
  );
});

test('PATCH /auth/local-credentials/:identityId updates password, lock state and status', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedUpdate = null;
  let capturedAudit = null;
  await withPrismaStubs(
    {
      'userIdentity.findUnique': async () => ({
        id: 'identity-001',
        userAccountId: 'user-001',
        providerType: 'local_password',
        providerSubject: 'local-subject-001',
        issuer: 'erp4_local',
        status: 'active',
        lastAuthenticatedAt: null,
        linkedAt: new Date('2026-03-23T00:00:00.000Z'),
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
          id: 'cred-001',
          loginId: 'local-user@example.com',
          passwordAlgo: 'argon2id',
          mfaRequired: true,
          mfaSecretRef: null,
          failedAttempts: 4,
          lockedUntil: new Date('2026-03-24T00:00:00.000Z'),
          passwordChangedAt: new Date('2026-03-23T00:00:00.000Z'),
          createdAt: new Date('2026-03-23T00:00:00.000Z'),
          updatedAt: new Date('2026-03-23T00:00:00.000Z'),
        },
      }),
      'userIdentity.update': async (args) => {
        capturedUpdate = args;
        return {
          id: 'identity-001',
          userAccountId: 'user-001',
          providerType: 'local_password',
          providerSubject: 'local-subject-001',
          issuer: 'erp4_local',
          status: args.data.status ?? 'active',
          lastAuthenticatedAt: null,
          linkedAt: new Date('2026-03-23T00:00:00.000Z'),
          createdAt: new Date('2026-03-23T00:00:00.000Z'),
          updatedAt: new Date('2026-03-23T01:00:00.000Z'),
          userAccount: {
            id: 'user-001',
            userName: 'legacy-user',
            displayName: 'Legacy User',
            active: true,
            deletedAt: null,
          },
          localCredential: {
            id: 'cred-001',
            loginId: args.data.localCredential.update.loginId,
            passwordAlgo: 'argon2id',
            mfaRequired: args.data.localCredential.update.mfaRequired,
            mfaSecretRef: null,
            failedAttempts: args.data.localCredential.update.failedAttempts,
            lockedUntil: args.data.localCredential.update.lockedUntil,
            passwordChangedAt:
              args.data.localCredential.update.passwordChangedAt,
            createdAt: new Date('2026-03-23T00:00:00.000Z'),
            updatedAt: new Date('2026-03-23T01:00:00.000Z'),
          },
        };
      },
      'auditLog.create': async (args) => {
        capturedAudit = args;
        return { id: 'audit-002' };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'PATCH',
          url: '/auth/local-credentials/identity-001',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
          },
          payload: {
            loginId: 'reset-user@example.com',
            password: 'ResetPassword123',
            mfaRequired: false,
            lockedUntil: null,
            status: 'disabled',
            ticketId: 'AUTH-003',
            reasonCode: 'admin_disable',
            reasonText: 'migration to google',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.loginId, 'reset-user@example.com');
        assert.equal(body.status, 'disabled');
        assert.equal(body.mfaRequired, false);
        assert.equal(body.lockedUntil, null);
      } finally {
        await server.close();
      }
    },
  );

  const updatedCredential = capturedUpdate?.data?.localCredential?.update;
  assert.equal(capturedUpdate?.data?.status, 'disabled');
  assert.equal(updatedCredential?.loginId, 'reset-user@example.com');
  assert.equal(updatedCredential?.failedAttempts, 0);
  assert.equal(updatedCredential?.lockedUntil, null);
  assert.equal(
    await argon2.verify(updatedCredential?.passwordHash, 'ResetPassword123'),
    true,
  );
  assert.deepEqual(
    [...(capturedAudit?.data?.metadata?.changedFields ?? [])].sort(),
    ['lockedUntil', 'loginId', 'mfaRequired', 'password', 'status'].sort(),
  );
});

test('PATCH /auth/local-credentials/:identityId returns current representation on no-op updates', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let updateCalled = false;
  await withPrismaStubs(
    {
      'userIdentity.findUnique': async () => ({
        id: 'identity-001',
        userAccountId: 'user-001',
        providerType: 'local_password',
        providerSubject: 'local-subject-001',
        issuer: 'erp4_local',
        status: 'active',
        lastAuthenticatedAt: null,
        linkedAt: new Date('2026-03-23T00:00:00.000Z'),
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
          id: 'cred-001',
          loginId: 'local-user@example.com',
          passwordAlgo: 'argon2id',
          mfaRequired: true,
          mfaSecretRef: null,
          failedAttempts: 0,
          lockedUntil: null,
          passwordChangedAt: new Date('2026-03-23T00:00:00.000Z'),
          createdAt: new Date('2026-03-23T00:00:00.000Z'),
          updatedAt: new Date('2026-03-23T00:00:00.000Z'),
        },
      }),
      'userIdentity.update': async () => {
        updateCalled = true;
        throw new Error('update should not be called for no-op patch');
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'PATCH',
          url: '/auth/local-credentials/identity-001',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
          },
          payload: {
            mfaRequired: true,
            lockedUntil: null,
            status: 'active',
            ticketId: 'AUTH-004',
            reasonCode: 'noop_check',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.identityId, 'identity-001');
        assert.equal(body.status, 'active');
        assert.equal(body.lockedUntil, null);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(updateCalled, false);
});

test('PATCH /auth/local-credentials/:identityId maps loginId conflicts to local_login_id_exists', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'userIdentity.findUnique': async () => ({
        id: 'identity-001',
        userAccountId: 'user-001',
        providerType: 'local_password',
        providerSubject: 'local-subject-001',
        issuer: 'erp4_local',
        status: 'active',
        lastAuthenticatedAt: null,
        linkedAt: new Date('2026-03-23T00:00:00.000Z'),
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
          id: 'cred-001',
          loginId: 'local-user@example.com',
          passwordAlgo: 'argon2id',
          mfaRequired: true,
          mfaSecretRef: null,
          failedAttempts: 0,
          lockedUntil: null,
          passwordChangedAt: new Date('2026-03-23T00:00:00.000Z'),
          createdAt: new Date('2026-03-23T00:00:00.000Z'),
          updatedAt: new Date('2026-03-23T00:00:00.000Z'),
        },
      }),
      'userIdentity.update': async () => {
        throw new Prisma.PrismaClientKnownRequestError('unique conflict', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['loginId'] },
        });
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'PATCH',
          url: '/auth/local-credentials/identity-001',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
          },
          payload: {
            loginId: 'other-user@example.com',
            ticketId: 'AUTH-005',
            reasonCode: 'rename',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error.code, 'local_login_id_exists');
      } finally {
        await server.close();
      }
    },
  );
});
