import assert from 'node:assert/strict';
import test from 'node:test';
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

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
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

async function loadBackendModules() {
  const [{ buildServer }, { prisma }] = await Promise.all([
    import('../dist/server.js'),
    import('../dist/services/db.js'),
  ]);
  return { buildServer, prisma };
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

test('envValidation: AUTH_MODE=jwt_bff requires Google BFF settings', async () => {
  const { assertValidBackendEnv } =
    await import('../dist/services/envValidation.js');
  await withEnv(
    {
      ...baseBffEnv(),
      GOOGLE_OIDC_CLIENT_SECRET: undefined,
    },
    async () => {
      assert.throws(() => assertValidBackendEnv(), /GOOGLE_OIDC_CLIENT_SECRET/);
    },
  );
});

test('GET /auth/google/start redirects to Google and sets auth flow cookie', async () => {
  await withEnv(baseBffEnv(), async () => {
    await withPrismaStubs(
      {
        'authOidcFlow.create': async () => ({ id: 'flow-001' }),
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'GET',
            url: '/auth/google/start?returnTo=%2Freports',
          });
          assert.equal(res.statusCode, 302, res.body);
          assert.match(res.headers.location || '', /accounts\.google\.com/);
          assert.match(res.headers.location || '', /code_challenge=/);
          const setCookie = res.headers['set-cookie'];
          assert.ok(setCookie, 'set-cookie should exist');
          assert.match(String(setCookie), /erp4_auth_flow=/);
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('GET /auth/google/callback creates session and redirects to frontend', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicKeyPem = await exportSPKI(publicKey);
  const idToken = await new SignJWT({
    sub: 'google-sub-001',
    email: 'user@example.com',
    nonce: 'nonce-001',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://accounts.google.com')
    .setAudience('client-id.apps.googleusercontent.com')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(privateKey);

  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        id_token: idToken,
        access_token: 'access-token',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );

  await withEnv(
    {
      ...baseBffEnv(),
      JWT_PUBLIC_KEY: publicKeyPem,
      JWT_JWKS_URL: undefined,
    },
    async () => {
      let deletedFlowId = null;
      let createdSession = null;
      let auditActions = [];
      await withPrismaStubs(
        {
          'authOidcFlow.findUnique': async () => ({
            id: 'flow-001',
            providerType: 'google_oidc',
            state: 'state-001',
            nonce: 'nonce-001',
            codeVerifier: 'verifier',
            returnTo: '/dashboard',
            expiresAt: new Date(Date.now() + 60_000),
          }),
          'authOidcFlow.delete': async ({ where }) => {
            deletedFlowId = where.id;
            return { id: where.id };
          },
          'userIdentity.findFirst': async () => ({
            id: 'identity-001',
            userAccountId: 'user-001',
            issuer: 'https://accounts.google.com',
            providerSubject: 'google-sub-001',
            providerType: 'google_oidc',
            status: 'active',
            effectiveUntil: null,
            userAccount: {
              id: 'user-001',
              active: true,
              deletedAt: null,
              userName: 'legacy-user',
              displayName: 'Legacy User',
            },
          }),
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
              method: 'GET',
              url: '/auth/google/callback?code=auth-code&state=state-001',
              headers: {
                cookie: 'erp4_auth_flow=flow-token-001',
                'user-agent': 'test-agent',
              },
            });
            assert.equal(res.statusCode, 302, res.body);
            assert.equal(
              res.headers.location,
              'http://localhost:4173/dashboard',
            );
            assert.equal(deletedFlowId, 'flow-001');
            assert.equal(createdSession?.providerSubject, 'google-sub-001');
            assert.ok(auditActions.includes('google_oidc_login_succeeded'));
            assert.match(String(res.headers['set-cookie']), /erp4_session=/);
          } finally {
            await server.close();
          }
        },
      );
    },
  );

  global.fetch = originalFetch;
});

test('jwt_bff mode authenticates /me via session cookie', async () => {
  await withEnv(baseBffEnv(), async () => {
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => ({
          id: 'sess-001',
          userAccountId: 'user-001',
          userIdentityId: 'identity-001',
          providerType: 'google_oidc',
          issuer: 'https://accounts.google.com',
          providerSubject: 'google-sub-001',
          expiresAt: new Date(Date.now() + 60_000),
          idleExpiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
        }),
        'authSession.update': async ({ data }) => ({
          id: 'sess-001',
          userAccountId: 'user-001',
          userIdentityId: 'identity-001',
          providerType: 'google_oidc',
          issuer: 'https://accounts.google.com',
          providerSubject: 'google-sub-001',
          expiresAt: new Date(Date.now() + 60_000),
          idleExpiresAt: data.idleExpiresAt,
          revokedAt: null,
        }),
        'userIdentity.findFirst': async () => ({
          id: 'identity-001',
          status: 'active',
          effectiveUntil: null,
          userAccountId: 'user-001',
          userAccount: {
            id: 'user-001',
            active: true,
            deletedAt: null,
            userName: 'legacy-user',
            externalId: null,
            organization: 'org-001',
            memberships: [],
          },
        }),
        'projectMember.findMany': async () => [{ projectId: 'proj-001' }],
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'GET',
            url: '/me',
            headers: {
              cookie: 'erp4_session=session-token-001',
            },
          });
          assert.equal(res.statusCode, 200, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.user.userId, 'legacy-user');
          assert.deepEqual(body.user.projectIds, ['proj-001']);
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('POST /auth/logout clears current session cookie', async () => {
  await withEnv(baseBffEnv(), async () => {
    let revokedId = null;
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => ({
          id: 'sess-001',
          userAccountId: 'user-001',
          userIdentityId: 'identity-001',
          providerType: 'google_oidc',
          issuer: 'https://accounts.google.com',
          providerSubject: 'google-sub-001',
          expiresAt: new Date(Date.now() + 60_000),
          idleExpiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
        }),
        'authSession.update': async ({ where }) => {
          revokedId = where.id;
          return {
            id: where.id,
            userAccountId: 'user-001',
            userIdentityId: 'identity-001',
            providerType: 'google_oidc',
            issuer: 'https://accounts.google.com',
            providerSubject: 'google-sub-001',
            revokedAt: new Date(),
          };
        },
        'auditLog.create': async () => ({ id: 'audit-logout' }),
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/auth/logout',
            headers: {
              cookie: 'erp4_session=session-token-001',
            },
          });
          assert.equal(res.statusCode, 204, res.body);
          assert.equal(revokedId, 'sess-001');
          assert.match(String(res.headers['set-cookie']), /erp4_session=;/);
        } finally {
          await server.close();
        }
      },
    );
  });
});
