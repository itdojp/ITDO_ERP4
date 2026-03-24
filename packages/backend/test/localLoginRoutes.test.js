import assert from 'node:assert/strict';
import test from 'node:test';
import argon2 from 'argon2';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';
const LOCAL_CSRF_HEADERS = {
  cookie: 'erp4_csrf=csrf-token-001',
  'x-csrf-token': 'csrf-token-001',
};
let backendModulesCacheBust = `${Date.now()}-bootstrap`;
let backendModulesPromise = null;
let injectIpCounter = 0;

function resetBackendModules() {
  backendModulesCacheBust = `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
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
    });
}

function nextRemoteAddress() {
  injectIpCounter += 1;
  return `198.51.100.${injectIpCounter}`;
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
  };
}

async function makePasswordHash(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

async function buildLocalIdentity(overrides = {}) {
  const passwordHash = await makePasswordHash(
    overrides.password ?? 'LocalPassword123',
  );
  return {
    id: 'identity-001',
    userAccountId: 'user-001',
    providerType: 'local_password',
    providerSubject: 'local-subject-001',
    issuer: 'erp4_local',
    status: 'active',
    effectiveUntil: null,
    userAccount: {
      id: 'user-001',
      userName: 'local-user',
      displayName: 'Local User',
      active: true,
      deletedAt: null,
      ...(overrides.userAccount || {}),
    },
    localCredential: {
      id: 'cred-001',
      loginId: 'local.user@example.com',
      passwordHash,
      passwordAlgo: 'argon2id',
      mfaRequired: false,
      mfaSecretRef: null,
      mustRotatePassword: false,
      failedAttempts: 0,
      lockedUntil: null,
      passwordChangedAt: new Date('2026-03-23T00:00:00.000Z'),
      ...(overrides.localCredential || {}),
    },
    ...(overrides.identity || {}),
  };
}

test('POST /auth/local/login creates session for local credential without MFA', async () => {
  await withEnv(baseBffEnv(), async () => {
    const identity = await buildLocalIdentity({
      localCredential: {
        mfaRequired: false,
        mustRotatePassword: false,
        failedAttempts: 2,
      },
    });
    let updatedCredential = null;
    let updatedIdentity = null;
    let createdSession = null;
    const auditActions = [];

    await withPrismaStubs(
      {
        'userIdentity.findFirst': async () => identity,
        'localCredential.update': async ({ data }) => {
          updatedCredential = data;
          return { id: identity.localCredential.id };
        },
        'userIdentity.update': async ({ data }) => {
          updatedIdentity = data;
          return { id: identity.id };
        },
        'authSession.create': async ({ data }) => {
          createdSession = data;
          return {
            id: 'sess-001',
            ...data,
            createdAt: new Date('2026-03-23T00:00:00.000Z'),
            lastSeenAt: new Date('2026-03-23T00:00:00.000Z'),
            revokedAt: null,
            revokedReason: null,
          };
        },
        'auditLog.create': async ({ data }) => {
          auditActions.push(data.action);
          return { id: `audit-${auditActions.length}` };
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/local/login',
            headers: {
              ...LOCAL_CSRF_HEADERS,
              'user-agent': 'local-login-test',
            },
            payload: {
              loginId: ' Local.User@example.com ',
              password: 'LocalPassword123',
            },
          });
          assert.equal(res.statusCode, 204, res.body);
          assert.match(String(res.headers['set-cookie']), /erp4_session=/);
        } finally {
          await server.close();
        }
      },
    );

    assert.equal(updatedCredential?.failedAttempts, 0);
    assert.equal(updatedCredential?.lockedUntil, null);
    assert.ok(updatedIdentity?.lastAuthenticatedAt instanceof Date);
    assert.equal(createdSession?.providerType, 'local_password');
    assert.equal(createdSession?.providerSubject, 'local-subject-001');
    assert.ok(auditActions.includes('local_login_succeeded'));
  });
});

test('POST /auth/local/login returns invalid_csrf_token when csrf header mismatches cookie', async () => {
  await withEnv(baseBffEnv(), async () => {
    let lookedUpIdentity = false;
    await withPrismaStubs(
      {
        'userIdentity.findFirst': async () => {
          lookedUpIdentity = true;
          return null;
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/local/login',
            headers: {
              cookie: 'erp4_csrf=csrf-token-001',
              'x-csrf-token': 'csrf-token-002',
            },
            payload: {
              loginId: 'local.user@example.com',
              password: 'LocalPassword123',
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
    assert.equal(lookedUpIdentity, false);
  });
});

test('POST /auth/local/login returns locked when local credential is already locked', async () => {
  await withEnv(baseBffEnv(), async () => {
    const identity = await buildLocalIdentity({
      localCredential: {
        lockedUntil: new Date('2099-03-23T00:15:00.000Z'),
      },
    });
    let createdSession = false;
    const auditReasonCodes = [];

    await withPrismaStubs(
      {
        'userIdentity.findFirst': async () => identity,
        'authSession.create': async () => {
          createdSession = true;
          throw new Error('authSession.create should not be called');
        },
        'auditLog.create': async ({ data }) => {
          auditReasonCodes.push(data.reasonCode);
          return { id: `audit-${auditReasonCodes.length}` };
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/local/login',
            headers: LOCAL_CSRF_HEADERS,
            payload: {
              loginId: 'local.user@example.com',
              password: 'LocalPassword123',
            },
          });
          assert.equal(res.statusCode, 423, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'local_credential_locked');
          assert.equal(
            body.error.details?.lockedUntil,
            '2099-03-23T00:15:00.000Z',
          );
        } finally {
          await server.close();
        }
      },
    );

    assert.equal(createdSession, false);
    assert.ok(auditReasonCodes.includes('credential_locked'));
  });
});

test('POST /auth/local/login requires bootstrap password rotation before session issuance', async () => {
  await withEnv(baseBffEnv(), async () => {
    const identity = await buildLocalIdentity({
      localCredential: {
        mustRotatePassword: true,
      },
    });
    let createdSession = false;

    await withPrismaStubs(
      {
        'userIdentity.findFirst': async () => identity,
        'localCredential.update': async () => ({
          id: identity.localCredential.id,
        }),
        'authSession.create': async () => {
          createdSession = true;
          throw new Error('authSession.create should not be called');
        },
        'auditLog.create': async () => ({ id: 'audit-001' }),
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/local/login',
            headers: LOCAL_CSRF_HEADERS,
            payload: {
              loginId: 'local.user@example.com',
              password: 'LocalPassword123',
            },
          });
          assert.equal(res.statusCode, 409, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'local_password_rotation_required');
        } finally {
          await server.close();
        }
      },
    );

    assert.equal(createdSession, false);
  });
});

test('POST /auth/local/login increments failedAttempts and locks local credential', async () => {
  await withEnv(baseBffEnv(), async () => {
    const identity = await buildLocalIdentity({
      localCredential: {
        failedAttempts: 4,
      },
    });
    const updates = [];
    let failedAttempts = 4;
    let lockedUntil = null;

    await withPrismaStubs(
      {
        'userIdentity.findFirst': async () => identity,
        'localCredential.update': async ({ data }) => {
          updates.push(data);
          if (data.failedAttempts?.increment) {
            failedAttempts += data.failedAttempts.increment;
          } else if (typeof data.failedAttempts === 'number') {
            failedAttempts = data.failedAttempts;
          }
          if (data.lockedUntil !== undefined) {
            lockedUntil = data.lockedUntil;
          }
          return {
            id: identity.localCredential.id,
            failedAttempts,
            lockedUntil,
          };
        },
        'auditLog.create': async () => ({ id: 'audit-001' }),
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/local/login',
            headers: LOCAL_CSRF_HEADERS,
            payload: {
              loginId: 'local.user@example.com',
              password: 'WrongPassword123',
            },
          });
          assert.equal(res.statusCode, 401, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'local_login_failed');
        } finally {
          await server.close();
        }
      },
    );

    assert.equal(updates[0]?.failedAttempts?.increment, 1);
    assert.ok(updates[1]?.lockedUntil instanceof Date);
  });
});

test('POST /auth/local/login returns local login validation error for invalid payload', async () => {
  await withEnv(baseBffEnv(), async () => {
    await withPrismaStubs({}, async () => {
      const { buildServer } = await loadBackendModules();
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          remoteAddress: nextRemoteAddress(),
          method: 'POST',
          url: '/auth/local/login',
          headers: LOCAL_CSRF_HEADERS,
          payload: {
            loginId: '   ',
            password: 'LocalPassword123',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error.code, 'invalid_local_login_payload');
      } finally {
        await server.close();
      }
    });
  });
});

test('POST /auth/local/login blocks when MFA setup is still required', async () => {
  await withEnv(baseBffEnv(), async () => {
    const identity = await buildLocalIdentity({
      localCredential: {
        mfaRequired: true,
        mfaSecretRef: null,
      },
    });

    await withPrismaStubs(
      {
        'userIdentity.findFirst': async () => identity,
        'localCredential.update': async () => ({
          id: identity.localCredential.id,
        }),
        'auditLog.create': async () => ({ id: 'audit-001' }),
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/local/login',
            headers: LOCAL_CSRF_HEADERS,
            payload: {
              loginId: 'local.user@example.com',
              password: 'LocalPassword123',
            },
          });
          assert.equal(res.statusCode, 409, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'local_mfa_setup_required');
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('POST /auth/local/login treats password verification errors as auth failures', async () => {
  await withEnv(baseBffEnv(), async () => {
    const identity = await buildLocalIdentity({
      localCredential: {
        passwordHash: 'invalid-hash',
      },
    });
    const auditReasonCodes = [];

    await withPrismaStubs(
      {
        'userIdentity.findFirst': async () => identity,
        'auditLog.create': async ({ data }) => {
          auditReasonCodes.push(data.reasonCode);
          return { id: `audit-${auditReasonCodes.length}` };
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/local/login',
            headers: LOCAL_CSRF_HEADERS,
            payload: {
              loginId: 'local.user@example.com',
              password: 'LocalPassword123',
            },
          });
          assert.equal(res.statusCode, 401, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'local_login_failed');
          assert.equal(
            body.error.details?.reason,
            'credential_verification_error',
          );
        } finally {
          await server.close();
        }
      },
    );

    assert.ok(auditReasonCodes.includes('credential_verification_error'));
  });
});

test('POST /auth/local/password/rotate clears bootstrap flag and updates password hash', async () => {
  await withEnv(baseBffEnv(), async () => {
    const identity = await buildLocalIdentity({
      localCredential: {
        mustRotatePassword: true,
        failedAttempts: 2,
      },
    });
    let updatedCredential = null;
    const auditActions = [];

    await withPrismaStubs(
      {
        'userIdentity.findFirst': async () => identity,
        'localCredential.update': async ({ data }) => {
          updatedCredential = data;
          return { id: identity.localCredential.id };
        },
        'auditLog.create': async ({ data }) => {
          auditActions.push(data.action);
          return { id: `audit-${auditActions.length}` };
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/local/password/rotate',
            headers: LOCAL_CSRF_HEADERS,
            payload: {
              loginId: 'local.user@example.com',
              currentPassword: 'LocalPassword123',
              newPassword: 'NewLocalPassword123',
            },
          });
          assert.equal(res.statusCode, 204, res.body);
        } finally {
          await server.close();
        }
      },
    );

    assert.equal(updatedCredential?.mustRotatePassword, false);
    assert.equal(updatedCredential?.failedAttempts, 0);
    assert.equal(updatedCredential?.lockedUntil, null);
    assert.equal(typeof updatedCredential?.passwordHash, 'string');
    assert.equal(
      await argon2.verify(
        updatedCredential.passwordHash,
        'NewLocalPassword123',
      ),
      true,
    );
    assert.ok(auditActions.includes('local_password_rotated'));
  });
});

test('POST /auth/local/password/rotate returns invalid_csrf_token when csrf header mismatches cookie', async () => {
  await withEnv(baseBffEnv(), async () => {
    let lookedUpIdentity = false;
    await withPrismaStubs(
      {
        'userIdentity.findFirst': async () => {
          lookedUpIdentity = true;
          return null;
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/local/password/rotate',
            headers: {
              cookie: 'erp4_csrf=csrf-token-001',
              'x-csrf-token': 'csrf-token-002',
            },
            payload: {
              loginId: 'local.user@example.com',
              currentPassword: 'LocalPassword123',
              newPassword: 'NewLocalPassword123',
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
    assert.equal(lookedUpIdentity, false);
  });
});

test('POST /auth/local/password/rotate returns conflict when rotation is not required', async () => {
  await withEnv(baseBffEnv(), async () => {
    const identity = await buildLocalIdentity({
      localCredential: {
        mustRotatePassword: false,
        failedAttempts: 2,
      },
    });
    let resetUpdate = null;

    await withPrismaStubs(
      {
        'userIdentity.findFirst': async () => identity,
        'localCredential.update': async ({ data }) => {
          resetUpdate = data;
          return { id: identity.localCredential.id };
        },
        'auditLog.create': async () => ({ id: 'audit-rotate-not-required' }),
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/local/password/rotate',
            headers: LOCAL_CSRF_HEADERS,
            payload: {
              loginId: 'local.user@example.com',
              currentPassword: 'LocalPassword123',
              newPassword: 'NewLocalPassword123',
            },
          });
          assert.equal(res.statusCode, 409, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'local_password_rotation_not_required');
        } finally {
          await server.close();
        }
      },
    );

    assert.equal(resetUpdate?.failedAttempts, 0);
    assert.equal(resetUpdate?.lockedUntil, null);
  });
});

test('POST /auth/local/password/rotate increments failedAttempts and locks credential when current password is wrong', async () => {
  await withEnv(baseBffEnv(), async () => {
    const identity = await buildLocalIdentity({
      localCredential: {
        mustRotatePassword: true,
        failedAttempts: 4,
      },
    });
    const updates = [];
    let failedAttempts = 4;
    let lockedUntil = null;

    await withPrismaStubs(
      {
        'userIdentity.findFirst': async () => identity,
        'localCredential.update': async ({ data }) => {
          updates.push(data);
          if (data.failedAttempts?.increment) {
            failedAttempts += data.failedAttempts.increment;
          } else if (typeof data.failedAttempts === 'number') {
            failedAttempts = data.failedAttempts;
          }
          if (data.lockedUntil !== undefined) {
            lockedUntil = data.lockedUntil;
          }
          return {
            id: identity.localCredential.id,
            failedAttempts,
            lockedUntil,
          };
        },
        'auditLog.create': async () => ({ id: 'audit-001' }),
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/local/password/rotate',
            headers: LOCAL_CSRF_HEADERS,
            payload: {
              loginId: 'local.user@example.com',
              currentPassword: 'WrongPassword123',
              newPassword: 'NewLocalPassword123',
            },
          });
          assert.equal(res.statusCode, 401, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'local_login_failed');
        } finally {
          await server.close();
        }
      },
    );

    assert.equal(updates[0]?.failedAttempts?.increment, 1);
    assert.ok(updates[1]?.lockedUntil instanceof Date);
  });
});

test('POST /auth/local/password/rotate rejects reusing the current password', async () => {
  await withEnv(baseBffEnv(), async () => {
    const identity = await buildLocalIdentity({
      localCredential: {
        mustRotatePassword: true,
      },
    });
    const updates = [];

    await withPrismaStubs(
      {
        'userIdentity.findFirst': async () => identity,
        'localCredential.update': async ({ data }) => {
          updates.push(data);
          return { id: identity.localCredential.id };
        },
        'auditLog.create': async () => ({ id: 'audit-001' }),
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            remoteAddress: nextRemoteAddress(),
            method: 'POST',
            url: '/auth/local/password/rotate',
            headers: LOCAL_CSRF_HEADERS,
            payload: {
              loginId: 'local.user@example.com',
              currentPassword: 'LocalPassword123',
              newPassword: 'LocalPassword123',
            },
          });
          assert.equal(res.statusCode, 400, res.body);
          const body = JSON.parse(res.body);
          assert.equal(
            body.error.code,
            'invalid_local_password_rotation_payload',
          );
        } finally {
          await server.close();
        }
      },
    );

    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.failedAttempts, 0);
    assert.equal(updates[0]?.lockedUntil, null);
  });
});

test('POST /auth/local/password/rotate returns dedicated validation error code', async () => {
  await withEnv(baseBffEnv(), async () => {
    await withPrismaStubs({}, async () => {
      const { buildServer } = await loadBackendModules();
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          remoteAddress: nextRemoteAddress(),
          method: 'POST',
          url: '/auth/local/password/rotate',
          headers: LOCAL_CSRF_HEADERS,
          payload: {
            loginId: '   ',
            currentPassword: 'LocalPassword123',
            newPassword: 'NewLocalPassword123',
          },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(
          body.error.code,
          'invalid_local_password_rotation_payload',
        );
      } finally {
        await server.close();
      }
    });
  });
});
