import assert from 'node:assert/strict';
import test from 'node:test';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';
let backendModulesCacheBust = `${Date.now()}-bootstrap`;
let backendModulesPromise = null;
let injectIpCounter = 0;

function resetBackendModules() {
  backendModulesCacheBust = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  backendModulesPromise = null;
}

function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetBackendModules();
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      resetBackendModules();
    });
}

async function loadBackendModules() {
  if (!backendModulesPromise) {
    backendModulesPromise = Promise.all([
      import(
        new URL(
          `../dist/server.js?bust=${backendModulesCacheBust}`,
          import.meta.url,
        ).href
      ),
      import('../dist/services/db.js'),
    ]).then(([{ buildServer }, { prisma }]) => ({ buildServer, prisma }));
  }
  return backendModulesPromise;
}

async function withPrismaStubs(stubs, fn) {
  const { prisma } = await loadBackendModules();
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
  try {
    await fn();
  } finally {
    for (const restore of restores.reverse()) restore();
  }
}

function baseBffEnv() {
  return {
    DATABASE_URL: MIN_DATABASE_URL,
    NODE_ENV: 'development',
    AUTH_MODE: 'jwt_bff',
    JWT_ISSUER: 'https://accounts.google.com',
    JWT_AUDIENCE: 'client-id.apps.googleusercontent.com',
    JWT_PUBLIC_KEY:
      '-----BEGIN PUBLIC KEY-----\\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtesttesttesttesttesttest\\n-----END PUBLIC KEY-----',
    GOOGLE_OIDC_CLIENT_ID: 'client-id.apps.googleusercontent.com',
    GOOGLE_OIDC_CLIENT_SECRET: 'client-secret',
    GOOGLE_OIDC_REDIRECT_URI: 'http://localhost:3001/auth/google/callback',
    AUTH_FRONTEND_ORIGIN: 'http://localhost:4173',
    AUTH_SESSION_COOKIE_SECURE: 'false',
    AUTH_GROUP_TO_ROLE_MAP: 'System Admins=system_admin',
    AUTH_DB_USER_CONTEXT_CACHE_TTL_SECONDS: '0',
  };
}

function nextRemoteAddress() {
  injectIpCounter += 1;
  return `198.51.100.${injectIpCounter}`;
}

function buildSessionRecord() {
  return {
    id: 'sess-admin-001',
    sessionTokenHash: 'hashed-token',
    userAccountId: 'user-admin-001',
    userIdentityId: 'identity-admin-001',
    providerType: 'google_oidc',
    issuer: 'https://accounts.google.com',
    providerSubject: 'google-sub-admin-001',
    createdAt: new Date('2026-03-24T00:00:00.000Z'),
    lastSeenAt: new Date('2026-03-24T00:00:00.000Z'),
    revokedAt: null,
    revokedReason: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    idleExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
  };
}

function buildAdminIdentity() {
  return {
    id: 'identity-admin-001',
    status: 'active',
    effectiveUntil: new Date(Date.now() + 60 * 60 * 1000),
    userAccountId: 'user-admin-001',
    userAccount: {
      id: 'user-admin-001',
      active: true,
      deletedAt: null,
      userName: 'admin.user@example.com',
      externalId: null,
      organization: 'org-001',
      memberships: [
        {
          group: {
            id: 'grp-system-admin',
            displayName: 'System Admins',
            active: true,
          },
        },
      ],
    },
  };
}

function buildNonAdminIdentity() {
  return {
    id: 'identity-user-001',
    status: 'active',
    effectiveUntil: new Date(Date.now() + 60 * 60 * 1000),
    userAccountId: 'user-regular-001',
    userAccount: {
      id: 'user-regular-001',
      active: true,
      deletedAt: null,
      userName: 'regular.user@example.com',
      externalId: null,
      organization: 'org-001',
      memberships: [],
    },
  };
}

function buildDisabledIdentity() {
  return {
    ...buildAdminIdentity(),
    id: 'identity-admin-disabled-001',
    status: 'disabled',
  };
}

function buildExpiredIdentity() {
  return {
    ...buildAdminIdentity(),
    id: 'identity-admin-expired-001',
    effectiveUntil: new Date('2026-03-20T00:00:00.000Z'),
  };
}

function buildSessionHeaders(csrfToken = 'csrf-token-001') {
  return {
    cookie: `erp4_session=session-token-001; erp4_csrf=${csrfToken}`,
    'x-csrf-token': csrfToken,
  };
}

test('GET /auth/user-identities lists identities for jwt_bff system_admin session', async () => {
  await withEnv(baseBffEnv(), async () => {
    let capturedFindMany = null;
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => buildSessionRecord(),
        'authSession.update': async ({ data }) => ({
          ...buildSessionRecord(),
          lastSeenAt: data.lastSeenAt,
          idleExpiresAt: data.idleExpiresAt,
        }),
        'userIdentity.findUnique': async () => buildAdminIdentity(),
        'projectMember.findMany': async () => [],
        'userIdentity.findMany': async (args) => {
          capturedFindMany = args;
          return [
            {
              id: 'identity-google-001',
              userAccountId: 'user-target-001',
              providerType: 'google_oidc',
              providerSubject: 'google-sub-001',
              issuer: 'https://accounts.google.com',
              emailSnapshot: 'target@example.com',
              status: 'active',
              lastAuthenticatedAt: null,
              linkedAt: new Date('2026-03-24T00:00:00.000Z'),
              effectiveUntil: null,
              rollbackWindowUntil: null,
              note: 'linked by admin',
              createdAt: new Date('2026-03-24T00:00:00.000Z'),
              updatedAt: new Date('2026-03-24T00:00:00.000Z'),
              userAccount: {
                id: 'user-target-001',
                userName: 'target.user@example.com',
                displayName: 'Target User',
                active: true,
                deletedAt: null,
              },
              localCredential: null,
            },
          ];
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'GET',
            url: '/auth/user-identities?providerType=google_oidc&limit=5&offset=1',
            headers: buildSessionHeaders(),
          });
          assert.equal(res.statusCode, 200, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.limit, 5);
          assert.equal(body.offset, 1);
          assert.equal(body.items.length, 1);
          assert.equal(body.items[0].providerType, 'google_oidc');
          assert.equal(body.items[0].userAccountId, 'user-target-001');
        } finally {
          await server.close();
        }
      },
    );

    assert.equal(capturedFindMany?.where?.providerType, 'google_oidc');
    assert.equal(capturedFindMany?.take, 5);
    assert.equal(capturedFindMany?.skip, 1);
  });
});

test('GET /auth/user-identities returns forbidden for jwt_bff session without system_admin role', async () => {
  await withEnv(baseBffEnv(), async () => {
    let findManyCalled = false;
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => ({
          ...buildSessionRecord(),
          userAccountId: 'user-regular-001',
          userIdentityId: 'identity-user-001',
          providerSubject: 'google-sub-user-001',
        }),
        'authSession.update': async ({ data }) => ({
          ...buildSessionRecord(),
          userAccountId: 'user-regular-001',
          userIdentityId: 'identity-user-001',
          providerSubject: 'google-sub-user-001',
          lastSeenAt: data.lastSeenAt,
          idleExpiresAt: data.idleExpiresAt,
        }),
        'userIdentity.findUnique': async () => buildNonAdminIdentity(),
        'projectMember.findMany': async () => [],
        'userIdentity.findMany': async () => {
          findManyCalled = true;
          return [];
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'GET',
            url: '/auth/user-identities',
            headers: buildSessionHeaders(),
          });
          assert.equal(res.statusCode, 403, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'forbidden');
        } finally {
          await server.close();
        }
      },
    );
    assert.equal(findManyCalled, false);
  });
});

test('GET /auth/local-credentials lists credentials for jwt_bff system_admin session', async () => {
  await withEnv(baseBffEnv(), async () => {
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => buildSessionRecord(),
        'authSession.update': async ({ data }) => ({
          ...buildSessionRecord(),
          lastSeenAt: data.lastSeenAt,
          idleExpiresAt: data.idleExpiresAt,
        }),
        'userIdentity.findUnique': async () => buildAdminIdentity(),
        'projectMember.findMany': async () => [],
        'userIdentity.findMany': async () => [
          {
            id: 'identity-local-001',
            userAccountId: 'user-target-001',
            providerType: 'local_password',
            providerSubject: 'local-sub-001',
            issuer: 'erp4_local',
            status: 'active',
            lastAuthenticatedAt: new Date('2026-03-24T01:00:00.000Z'),
            linkedAt: new Date('2026-03-24T00:00:00.000Z'),
            createdAt: new Date('2026-03-24T00:00:00.000Z'),
            updatedAt: new Date('2026-03-24T00:00:00.000Z'),
            userAccount: {
              id: 'user-target-001',
              userName: 'target.user@example.com',
              displayName: 'Target User',
              active: true,
              deletedAt: null,
            },
            localCredential: {
              id: 'cred-001',
              loginId: 'target.user@example.com',
              passwordAlgo: 'argon2id',
              mfaRequired: false,
              mfaSecretRef: null,
              mustRotatePassword: false,
              failedAttempts: 0,
              lockedUntil: null,
              passwordChangedAt: new Date('2026-03-24T00:30:00.000Z'),
              createdAt: new Date('2026-03-24T00:00:00.000Z'),
              updatedAt: new Date('2026-03-24T00:30:00.000Z'),
            },
          },
        ],
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'GET',
            url: '/auth/local-credentials?status=active',
            headers: buildSessionHeaders(),
          });
          assert.equal(res.statusCode, 200, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.items.length, 1);
          assert.equal(body.items[0].loginId, 'target.user@example.com');
          assert.equal(body.items[0].status, 'active');
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('GET /auth/local-credentials returns forbidden for jwt_bff session without system_admin role', async () => {
  await withEnv(baseBffEnv(), async () => {
    let findManyCalled = false;
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => ({
          ...buildSessionRecord(),
          userAccountId: 'user-regular-001',
          userIdentityId: 'identity-user-001',
          providerSubject: 'google-sub-user-001',
        }),
        'authSession.update': async ({ data }) => ({
          ...buildSessionRecord(),
          userAccountId: 'user-regular-001',
          userIdentityId: 'identity-user-001',
          providerSubject: 'google-sub-user-001',
          lastSeenAt: data.lastSeenAt,
          idleExpiresAt: data.idleExpiresAt,
        }),
        'userIdentity.findUnique': async () => buildNonAdminIdentity(),
        'projectMember.findMany': async () => [],
        'userIdentity.findMany': async () => {
          findManyCalled = true;
          return [];
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'GET',
            url: '/auth/local-credentials',
            headers: buildSessionHeaders(),
          });
          assert.equal(res.statusCode, 403, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'forbidden');
        } finally {
          await server.close();
        }
      },
    );
    assert.equal(findManyCalled, false);
  });
});

test('POST /auth/user-identities/google-link returns invalid_csrf_token for jwt_bff admin session mismatch', async () => {
  await withEnv(baseBffEnv(), async () => {
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => buildSessionRecord(),
        'authSession.update': async ({ data }) => ({
          ...buildSessionRecord(),
          lastSeenAt: data.lastSeenAt,
          idleExpiresAt: data.idleExpiresAt,
        }),
        'userIdentity.findUnique': async () => buildAdminIdentity(),
        'projectMember.findMany': async () => [],
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/user-identities/google-link',
            headers: {
              ...buildSessionHeaders('csrf-cookie-001'),
              'x-csrf-token': 'csrf-header-001',
            },
            payload: {
              userAccountId: 'user-target-001',
              issuer: 'https://accounts.google.com',
              providerSubject: 'google-sub-001',
              ticketId: 'AUTH-MIG-201',
              reasonCode: 'google_link',
            },
          });
          assert.equal(res.statusCode, 403, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'invalid_csrf_token');
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('POST /auth/user-identities/google-link returns forbidden for jwt_bff session without system_admin role', async () => {
  await withEnv(baseBffEnv(), async () => {
    let createCalled = false;
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => ({
          ...buildSessionRecord(),
          userAccountId: 'user-regular-001',
          userIdentityId: 'identity-user-001',
          providerSubject: 'google-sub-user-001',
        }),
        'authSession.update': async ({ data }) => ({
          ...buildSessionRecord(),
          userAccountId: 'user-regular-001',
          userIdentityId: 'identity-user-001',
          providerSubject: 'google-sub-user-001',
          lastSeenAt: data.lastSeenAt,
          idleExpiresAt: data.idleExpiresAt,
        }),
        'userIdentity.findUnique': async () => buildNonAdminIdentity(),
        'projectMember.findMany': async () => [],
        'userIdentity.create': async () => {
          createCalled = true;
          throw new Error('userIdentity.create should not be called');
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/user-identities/google-link',
            headers: buildSessionHeaders(),
            payload: {
              userAccountId: 'user-target-001',
              issuer: 'https://accounts.google.com',
              providerSubject: 'google-sub-001',
              ticketId: 'AUTH-MIG-202',
              reasonCode: 'google_link',
            },
          });
          assert.equal(res.statusCode, 403, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'forbidden');
        } finally {
          await server.close();
        }
      },
    );
    assert.equal(createCalled, false);
  });
});

test('POST /auth/user-identities/local-link returns invalid_csrf_token for jwt_bff admin session mismatch', async () => {
  await withEnv(baseBffEnv(), async () => {
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => buildSessionRecord(),
        'authSession.update': async ({ data }) => ({
          ...buildSessionRecord(),
          lastSeenAt: data.lastSeenAt,
          idleExpiresAt: data.idleExpiresAt,
        }),
        'userIdentity.findUnique': async () => buildAdminIdentity(),
        'projectMember.findMany': async () => [],
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/user-identities/local-link',
            headers: {
              ...buildSessionHeaders('csrf-cookie-003'),
              'x-csrf-token': 'csrf-header-003',
            },
            payload: {
              userAccountId: 'user-target-001',
              loginId: 'target.user@example.com',
              password: 'LocalPassword123',
              ticketId: 'AUTH-MIG-301',
              reasonCode: 'local_link',
            },
          });
          assert.equal(res.statusCode, 403, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'invalid_csrf_token');
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('POST /auth/user-identities/local-link returns forbidden for jwt_bff session without system_admin role', async () => {
  await withEnv(baseBffEnv(), async () => {
    let createCalled = false;
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => ({
          ...buildSessionRecord(),
          userAccountId: 'user-regular-001',
          userIdentityId: 'identity-user-001',
          providerSubject: 'google-sub-user-001',
        }),
        'authSession.update': async ({ data }) => ({
          ...buildSessionRecord(),
          userAccountId: 'user-regular-001',
          userIdentityId: 'identity-user-001',
          providerSubject: 'google-sub-user-001',
          lastSeenAt: data.lastSeenAt,
          idleExpiresAt: data.idleExpiresAt,
        }),
        'userIdentity.findUnique': async () => buildNonAdminIdentity(),
        'projectMember.findMany': async () => [],
        'userIdentity.create': async () => {
          createCalled = true;
          throw new Error('userIdentity.create should not be called');
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/user-identities/local-link',
            headers: buildSessionHeaders(),
            payload: {
              userAccountId: 'user-target-001',
              loginId: 'target.user@example.com',
              password: 'LocalPassword123',
              ticketId: 'AUTH-MIG-302',
              reasonCode: 'local_link',
            },
          });
          assert.equal(res.statusCode, 403, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'forbidden');
        } finally {
          await server.close();
        }
      },
    );
    assert.equal(createCalled, false);
  });
});

test('POST /auth/local-credentials returns invalid_csrf_token for jwt_bff admin session mismatch', async () => {
  await withEnv(baseBffEnv(), async () => {
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => buildSessionRecord(),
        'authSession.update': async ({ data }) => ({
          ...buildSessionRecord(),
          lastSeenAt: data.lastSeenAt,
          idleExpiresAt: data.idleExpiresAt,
        }),
        'userIdentity.findUnique': async () => buildAdminIdentity(),
        'projectMember.findMany': async () => [],
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/local-credentials',
            headers: {
              ...buildSessionHeaders('csrf-cookie-002'),
              'x-csrf-token': 'csrf-header-002',
            },
            payload: {
              userAccountId: 'user-target-001',
              loginId: 'target.user@example.com',
              password: 'LocalPassword123',
              ticketId: 'AUTH-LOCAL-201',
              reasonCode: 'admin_issue',
            },
          });
          assert.equal(res.statusCode, 403, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'invalid_csrf_token');
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('POST /auth/local-credentials returns forbidden for jwt_bff session without system_admin role', async () => {
  await withEnv(baseBffEnv(), async () => {
    let createCalled = false;
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => ({
          ...buildSessionRecord(),
          userAccountId: 'user-regular-001',
          userIdentityId: 'identity-user-001',
          providerSubject: 'google-sub-user-001',
        }),
        'authSession.update': async ({ data }) => ({
          ...buildSessionRecord(),
          userAccountId: 'user-regular-001',
          userIdentityId: 'identity-user-001',
          providerSubject: 'google-sub-user-001',
          lastSeenAt: data.lastSeenAt,
          idleExpiresAt: data.idleExpiresAt,
        }),
        'userIdentity.findUnique': async () => buildNonAdminIdentity(),
        'projectMember.findMany': async () => [],
        'userIdentity.create': async () => {
          createCalled = true;
          throw new Error('userIdentity.create should not be called');
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/local-credentials',
            headers: buildSessionHeaders(),
            payload: {
              userAccountId: 'user-target-001',
              loginId: 'target.user@example.com',
              password: 'LocalPassword123',
              ticketId: 'AUTH-LOCAL-202',
              reasonCode: 'admin_issue',
            },
          });
          assert.equal(res.statusCode, 403, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'forbidden');
        } finally {
          await server.close();
        }
      },
    );
    assert.equal(createCalled, false);
  });
});

test('PATCH /auth/user-identities/:identityId returns forbidden for jwt_bff session without system_admin role', async () => {
  await withEnv(baseBffEnv(), async () => {
    let updateCalled = false;
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => ({
          ...buildSessionRecord(),
          userAccountId: 'user-regular-001',
          userIdentityId: 'identity-user-001',
          providerSubject: 'google-sub-user-001',
        }),
        'authSession.update': async ({ data }) => ({
          ...buildSessionRecord(),
          userAccountId: 'user-regular-001',
          userIdentityId: 'identity-user-001',
          providerSubject: 'google-sub-user-001',
          lastSeenAt: data.lastSeenAt,
          idleExpiresAt: data.idleExpiresAt,
        }),
        'userIdentity.findUnique': async () => buildNonAdminIdentity(),
        'projectMember.findMany': async () => [],
        'userIdentity.update': async () => {
          updateCalled = true;
          throw new Error('userIdentity.update should not be called');
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'PATCH',
            url: '/auth/user-identities/identity-google-001',
            headers: buildSessionHeaders(),
            payload: {
              status: 'disabled',
              ticketId: 'AUTH-MIG-203',
              reasonCode: 'google_disable',
            },
          });
          assert.equal(res.statusCode, 403, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'forbidden');
        } finally {
          await server.close();
        }
      },
    );
    assert.equal(updateCalled, false);
  });
});

test('PATCH /auth/local-credentials/:identityId returns forbidden for jwt_bff session without system_admin role', async () => {
  await withEnv(baseBffEnv(), async () => {
    let updateCalled = false;
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => ({
          ...buildSessionRecord(),
          userAccountId: 'user-regular-001',
          userIdentityId: 'identity-user-001',
          providerSubject: 'google-sub-user-001',
        }),
        'authSession.update': async ({ data }) => ({
          ...buildSessionRecord(),
          userAccountId: 'user-regular-001',
          userIdentityId: 'identity-user-001',
          providerSubject: 'google-sub-user-001',
          lastSeenAt: data.lastSeenAt,
          idleExpiresAt: data.idleExpiresAt,
        }),
        'userIdentity.findUnique': async () => buildNonAdminIdentity(),
        'projectMember.findMany': async () => [],
        'userIdentity.update': async () => {
          updateCalled = true;
          throw new Error('userIdentity.update should not be called');
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'PATCH',
            url: '/auth/local-credentials/identity-local-001',
            headers: buildSessionHeaders(),
            payload: {
              status: 'disabled',
              ticketId: 'AUTH-LOCAL-203',
              reasonCode: 'admin_disable',
            },
          });
          assert.equal(res.statusCode, 403, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'forbidden');
        } finally {
          await server.close();
        }
      },
    );
    assert.equal(updateCalled, false);
  });
});

test('GET /auth/user-identities returns unauthorized for jwt_bff request without session cookie', async () => {
  await withEnv(baseBffEnv(), async () => {
    let findManyCalled = false;
    await withPrismaStubs(
      {
        'userIdentity.findMany': async () => {
          findManyCalled = true;
          return [];
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'GET',
            url: '/auth/user-identities',
          });
          assert.equal(res.statusCode, 401, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'unauthorized');
        } finally {
          await server.close();
        }
      },
    );
    assert.equal(findManyCalled, false);
  });
});

test('GET /auth/local-credentials returns unauthorized for jwt_bff session with disabled identity', async () => {
  await withEnv(baseBffEnv(), async () => {
    let findManyCalled = false;
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => buildSessionRecord(),
        'authSession.update': async ({ data }) => ({
          ...buildSessionRecord(),
          lastSeenAt: data.lastSeenAt,
          idleExpiresAt: data.idleExpiresAt,
        }),
        'userIdentity.findUnique': async () => buildDisabledIdentity(),
        'projectMember.findMany': async () => [],
        'userIdentity.findMany': async () => {
          findManyCalled = true;
          return [];
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'GET',
            url: '/auth/local-credentials',
            headers: buildSessionHeaders(),
          });
          assert.equal(res.statusCode, 401, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'unauthorized');
        } finally {
          await server.close();
        }
      },
    );
    assert.equal(findManyCalled, false);
  });
});

test('POST /auth/local-credentials returns unauthorized for jwt_bff session with expired identity', async () => {
  await withEnv(baseBffEnv(), async () => {
    let createCalled = false;
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => buildSessionRecord(),
        'authSession.update': async ({ data }) => ({
          ...buildSessionRecord(),
          lastSeenAt: data.lastSeenAt,
          idleExpiresAt: data.idleExpiresAt,
        }),
        'userIdentity.findUnique': async () => buildExpiredIdentity(),
        'projectMember.findMany': async () => [],
        'userIdentity.create': async () => {
          createCalled = true;
          throw new Error('userIdentity.create should not be called');
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/local-credentials',
            headers: buildSessionHeaders(),
            payload: {
              userAccountId: 'user-target-001',
              loginId: 'target.user@example.com',
              password: 'LocalPassword123',
              ticketId: 'AUTH-LOCAL-401',
              reasonCode: 'admin_issue',
            },
          });
          assert.equal(res.statusCode, 401, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'unauthorized');
        } finally {
          await server.close();
        }
      },
    );
    assert.equal(createCalled, false);
  });
});
