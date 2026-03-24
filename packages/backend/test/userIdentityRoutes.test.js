import assert from 'node:assert/strict';
import test from 'node:test';
import argon2 from 'argon2';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';
const IDENTITY_CSRF_HEADERS = {
  cookie: 'erp4_csrf=csrf-token-001',
  'x-csrf-token': 'csrf-token-001',
};
let injectIpCounter = 0;
process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;

const { buildServer } = await import('../dist/server.js');
const { prisma } = await import('../dist/services/db.js');

function futureIso(daysAhead) {
  return new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
}

function nextRemoteAddress() {
  injectIpCounter += 1;
  return `198.51.100.${injectIpCounter}`;
}

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
  if (!Object.prototype.hasOwnProperty.call(stubs, '$transaction')) {
    const originalTransaction = prisma.$transaction;
    prisma.$transaction = async (arg, ...rest) => {
      if (typeof arg === 'function') {
        return arg(prisma, ...rest);
      }
      return originalTransaction.call(prisma, arg, ...rest);
    };
    restores.push(() => {
      prisma.$transaction = originalTransaction;
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
        remoteAddress: nextRemoteAddress(),
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
  const rollbackWindowUntil = futureIso(7);

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
            rollbackWindowUntil: new Date(rollbackWindowUntil),
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
          remoteAddress: nextRemoteAddress(),
          method: 'GET',
          url: '/auth/user-identities?userAccountId=user-001&providerType=google_oidc&status=active&limit=10&offset=5',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
            ...IDENTITY_CSRF_HEADERS,
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.limit, 10);
        assert.equal(body.offset, 5);
        assert.equal(body.items.length, 1);
        assert.equal(body.items[0].providerType, 'google_oidc');
        assert.equal(body.items[0].rollbackWindowUntil, rollbackWindowUntil);
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
  const effectiveUntil = futureIso(8);
  const rollbackWindowUntil = futureIso(2);

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
          remoteAddress: nextRemoteAddress(),
          method: 'POST',
          url: '/auth/user-identities/google-link',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
            ...IDENTITY_CSRF_HEADERS,
          },
          payload: {
            userAccountId: 'user-001',
            issuer: 'https://accounts.google.com',
            providerSubject: 'google-sub-001',
            emailSnapshot: 'user@example.com',
            effectiveUntil,
            rollbackWindowUntil,
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

test('POST /auth/user-identities/google-link rejects blank audit fields after trimming', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let lookupCalled = false;
  let createCalled = false;
  await withPrismaStubs(
    {
      'userAccount.findUnique': async () => {
        lookupCalled = true;
        return null;
      },
      'userIdentity.create': async () => {
        createCalled = true;
        throw new Error('should not create identity');
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          remoteAddress: nextRemoteAddress(),
          method: 'POST',
          url: '/auth/user-identities/google-link',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
            ...IDENTITY_CSRF_HEADERS,
          },
          payload: {
            userAccountId: 'user-001',
            issuer: 'https://accounts.google.com',
            providerSubject: 'google-sub-001',
            ticketId: '   ',
            reasonCode: '   ',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error.code, 'invalid_local_credential_payload');
        assert.deepEqual(body.error.details?.invalidFields, [
          'ticketId',
          'reasonCode',
        ]);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(lookupCalled, false);
  assert.equal(createCalled, false);
});

test('POST /auth/user-identities/google-link rejects a second Google identity regardless of issuer', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'userAccount.findUnique': async () => ({
        id: 'user-001',
        active: true,
        deletedAt: null,
        identities: [{ id: 'identity-google-legacy' }],
      }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          remoteAddress: nextRemoteAddress(),
          method: 'POST',
          url: '/auth/user-identities/google-link',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
            ...IDENTITY_CSRF_HEADERS,
          },
          payload: {
            userAccountId: 'user-001',
            issuer: 'https://issuer.example.com',
            providerSubject: 'google-sub-002',
            ticketId: 'AUTH-MIG-001A',
            reasonCode: 'google_link',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error.code, 'google_identity_exists_for_account');
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /auth/user-identities/google-link rejects past rollback window', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let lookedUpUser = false;
  await withPrismaStubs(
    {
      'userAccount.findUnique': async () => {
        lookedUpUser = true;
        return null;
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          remoteAddress: nextRemoteAddress(),
          method: 'POST',
          url: '/auth/user-identities/google-link',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
            ...IDENTITY_CSRF_HEADERS,
          },
          payload: {
            userAccountId: 'user-001',
            issuer: 'https://accounts.google.com',
            providerSubject: 'google-sub-001',
            rollbackWindowUntil: '2000-01-01T00:00:00.000Z',
            ticketId: 'AUTH-MIG-001B',
            reasonCode: 'google_link',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error.code, 'invalid_local_credential_payload');
        assert.deepEqual(body.error.details?.invalidFields, [
          'rollbackWindowUntil',
        ]);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(lookedUpUser, false);
});

test('POST /auth/user-identities/local-link creates local identity with bootstrap password rotation', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  const rollbackWindowUntil = futureIso(2);

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
          remoteAddress: nextRemoteAddress(),
          method: 'POST',
          url: '/auth/user-identities/local-link',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
            ...IDENTITY_CSRF_HEADERS,
          },
          payload: {
            userAccountId: 'user-001',
            loginId: 'Local.User@example.com ',
            password: 'LocalPassword123',
            rollbackWindowUntil,
            ticketId: 'AUTH-MIG-002',
            reasonCode: 'local_link',
          },
        });
        assert.equal(res.statusCode, 201, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.providerType, 'local_password');
        assert.equal(body.localCredential.loginId, 'local.user@example.com');
        assert.equal(body.localCredential.mfaRequired, false);
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
    false,
  );
  assert.equal(
    capturedCreate?.data?.localCredential?.create?.mustRotatePassword,
    true,
  );
  assert.equal(await argon2.verify(passwordHash, 'LocalPassword123'), true);
});

test('POST /auth/user-identities/local-link rejects blank audit fields after trimming', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let lookupCalled = false;
  let createCalled = false;
  await withPrismaStubs(
    {
      'userAccount.findUnique': async () => {
        lookupCalled = true;
        return null;
      },
      'userIdentity.create': async () => {
        createCalled = true;
        throw new Error('should not create local identity');
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          remoteAddress: nextRemoteAddress(),
          method: 'POST',
          url: '/auth/user-identities/local-link',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
            ...IDENTITY_CSRF_HEADERS,
          },
          payload: {
            userAccountId: 'user-001',
            loginId: 'local.user@example.com',
            password: 'LocalPassword123',
            ticketId: '   ',
            reasonCode: '   ',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error.code, 'invalid_local_credential_payload');
        assert.deepEqual(body.error.details?.invalidFields, [
          'ticketId',
          'reasonCode',
        ]);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(lookupCalled, false);
  assert.equal(createCalled, false);
});

test('POST /auth/user-identities/local-link rejects past rollback window', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let lookedUpUser = false;
  await withPrismaStubs(
    {
      'userAccount.findUnique': async () => {
        lookedUpUser = true;
        return null;
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          remoteAddress: nextRemoteAddress(),
          method: 'POST',
          url: '/auth/user-identities/local-link',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
            ...IDENTITY_CSRF_HEADERS,
          },
          payload: {
            userAccountId: 'user-001',
            loginId: 'local.user@example.com',
            password: 'LocalPassword123',
            rollbackWindowUntil: '2000-01-01T00:00:00.000Z',
            ticketId: 'AUTH-MIG-002A',
            reasonCode: 'local_link',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error.code, 'invalid_local_credential_payload');
        assert.deepEqual(body.error.details?.invalidFields, [
          'rollbackWindowUntil',
        ]);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(lookedUpUser, false);
});

test('PATCH /auth/user-identities/:identityId updates status and windows', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  const effectiveUntil = futureIso(1);
  const rollbackWindowUntil = futureIso(2);

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
          remoteAddress: nextRemoteAddress(),
          method: 'PATCH',
          url: '/auth/user-identities/identity-google-001',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
            ...IDENTITY_CSRF_HEADERS,
          },
          payload: {
            status: 'disabled',
            effectiveUntil,
            rollbackWindowUntil,
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

test('PATCH /auth/user-identities/:identityId returns current representation on no-op updates', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let updateCalled = false;
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
      'userIdentity.update': async () => {
        updateCalled = true;
        throw new Error('userIdentity.update should not be called');
      },
      'auditLog.create': async () => ({ id: 'audit-noop-001' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          remoteAddress: nextRemoteAddress(),
          method: 'PATCH',
          url: '/auth/user-identities/identity-google-001',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
            ...IDENTITY_CSRF_HEADERS,
          },
          payload: {
            status: 'active',
            ticketId: 'AUTH-MIG-003A',
            reasonCode: 'noop_check',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.status, 'active');
        assert.equal(body.identityId, 'identity-google-001');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(updateCalled, false);
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
          remoteAddress: nextRemoteAddress(),
          method: 'PATCH',
          url: '/auth/user-identities/identity-google-001',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
            ...IDENTITY_CSRF_HEADERS,
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

test('PATCH /auth/user-identities/:identityId rejects past rollback window', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let lookedUpIdentity = false;
  await withPrismaStubs(
    {
      'userIdentity.findUnique': async () => {
        lookedUpIdentity = true;
        return null;
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          remoteAddress: nextRemoteAddress(),
          method: 'PATCH',
          url: '/auth/user-identities/identity-google-001',
          headers: {
            'x-user-id': 'sys-admin',
            'x-roles': 'system_admin',
            ...IDENTITY_CSRF_HEADERS,
          },
          payload: {
            status: 'disabled',
            rollbackWindowUntil: '2000-01-01T00:00:00.000Z',
            ticketId: 'AUTH-MIG-004A',
            reasonCode: 'google_disable',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error.code, 'invalid_local_credential_payload');
        assert.deepEqual(body.error.details?.invalidFields, [
          'rollbackWindowUntil',
        ]);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(lookedUpIdentity, false);
});
