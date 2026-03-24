import assert from 'node:assert/strict';
import test from 'node:test';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';
let backendModulesCacheBust = `${Date.now()}-bootstrap`;
let backendModulesPromise = null;
let googleOidcTestKeyPromise = null;

async function getGoogleOidcTestKey() {
  if (!googleOidcTestKeyPromise) {
    googleOidcTestKeyPromise = generateKeyPair('RS256').then(
      async ({ privateKey, publicKey }) => ({
        privateKey,
        publicKeyPem: await exportSPKI(publicKey),
      }),
    );
  }
  return googleOidcTestKeyPromise;
}

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

async function withRateLimiterFailure(ip, fn) {
  const originalConsume = RateLimiterMemory.prototype.consume;
  RateLimiterMemory.prototype.consume = async function patchedConsume(key) {
    if (key == ip) {
      throw new Error('rate_limited_for_test');
    }
    return originalConsume.call(this, key);
  };
  try {
    await fn();
  } finally {
    RateLimiterMemory.prototype.consume = originalConsume;
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

test('GET /auth/google/callback returns invalid flow for mismatched state', async () => {
  await withEnv(baseBffEnv(), async () => {
    let auditRecord = null;
    await withPrismaStubs(
      {
        'authOidcFlow.findUnique': async () => ({
          id: 'flow-001',
          providerType: 'google_oidc',
          state: 'state-expected',
          nonce: 'nonce-001',
          codeVerifier: 'verifier',
          returnTo: '/dashboard',
          expiresAt: new Date(Date.now() + 60_000),
        }),
        'authOidcFlow.delete': async () => {
          throw new Error('authOidcFlow.delete should not be called');
        },
        'auditLog.create': async ({ data }) => {
          auditRecord = data;
          return { id: 'audit-invalid-flow' };
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'GET',
            url: '/auth/google/callback?code=auth-code&state=state-actual',
            headers: {
              cookie: 'erp4_auth_flow=flow-token-001',
            },
          });
          assert.equal(res.statusCode, 400, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'google_auth_flow_invalid');
          assert.match(String(res.headers['set-cookie']), /erp4_auth_flow=;/);
        } finally {
          await server.close();
        }
      },
    );
    assert.equal(auditRecord?.action, 'google_oidc_login_failed');
    assert.equal(auditRecord?.reasonCode, 'invalid_flow');
  });
});

test('GET /auth/google/callback creates session and redirects to frontend', async () => {
  const { privateKey, publicKeyPem } = await getGoogleOidcTestKey();
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
  let tokenExchangeBody = '';
  global.fetch = async (_input, init) => {
    tokenExchangeBody = String(init?.body ?? '');
    return new Response(
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
  };

  try {
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
              assert.match(tokenExchangeBody, /code_verifier=verifier/);
            } finally {
              await server.close();
            }
          },
        );
      },
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('GET /auth/google/callback writes audit log on callback validation failure', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        error: 'invalid_grant',
      }),
      {
        status: 400,
        headers: { 'content-type': 'application/json' },
      },
    );

  try {
    await withEnv(baseBffEnv(), async () => {
      let capturedAudit = null;
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
          'authOidcFlow.delete': async ({ where }) => ({ id: where.id }),
          'auditLog.create': async ({ data }) => {
            capturedAudit = data;
            return { id: 'audit-001' };
          },
        },
        async () => {
          const { buildServer } = await loadBackendModules();
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'GET',
              url: '/auth/google/callback?code=bad-code&state=state-001',
              headers: {
                cookie: 'erp4_auth_flow=flow-token-001',
                'user-agent': 'test-agent',
              },
            });
            assert.equal(res.statusCode, 401, res.body);
            const body = JSON.parse(res.body);
            assert.equal(body.error.code, 'google_auth_callback_failed');
            assert.equal(capturedAudit?.action, 'google_oidc_login_failed');
            assert.equal(capturedAudit?.targetTable, 'AuthOidcFlow');
            assert.equal(
              capturedAudit?.reasonCode,
              'callback_validation_failed',
            );
            assert.equal(capturedAudit?.metadata?.state, 'state-001');
            assert.match(
              String(capturedAudit?.metadata?.error || ''),
              /^google_token_exchange_failed:400:/,
            );
            assert.equal(capturedAudit?.userAgent, 'test-agent');
          } finally {
            await server.close();
          }
        },
      );
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('GET /auth/google/callback returns identity unavailable when Google identity is not linked', async () => {
  const { privateKey, publicKeyPem } = await getGoogleOidcTestKey();
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
    new Response(JSON.stringify({ id_token: idToken }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  try {
    await withEnv(
      {
        ...baseBffEnv(),
        JWT_PUBLIC_KEY: publicKeyPem,
        JWT_JWKS_URL: undefined,
      },
      async () => {
        let auditRecord = null;
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
            'authOidcFlow.delete': async ({ where }) => ({ id: where.id }),
            'userIdentity.findFirst': async () => null,
            'authSession.create': async () => {
              throw new Error('authSession.create should not be called');
            },
            'auditLog.create': async ({ data }) => {
              auditRecord = data;
              return { id: 'audit-identity-unavailable' };
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
                },
              });
              assert.equal(res.statusCode, 403, res.body);
              const body = JSON.parse(res.body);
              assert.equal(body.error.code, 'google_identity_unavailable');
              assert.match(
                String(res.headers['set-cookie']),
                /erp4_auth_flow=;/,
              );
            } finally {
              await server.close();
            }
          },
        );
        assert.equal(auditRecord?.action, 'google_oidc_login_failed');
        assert.equal(auditRecord?.reasonCode, 'identity_unavailable');
      },
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('GET /auth/google/callback returns callback validation error when nonce verification fails', async () => {
  const { privateKey, publicKeyPem } = await getGoogleOidcTestKey();
  const idToken = await new SignJWT({
    sub: 'google-sub-001',
    email: 'user@example.com',
    nonce: 'nonce-mismatch',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://accounts.google.com')
    .setAudience('client-id.apps.googleusercontent.com')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(privateKey);

  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(JSON.stringify({ id_token: idToken }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  try {
    await withEnv(
      {
        ...baseBffEnv(),
        JWT_PUBLIC_KEY: publicKeyPem,
        JWT_JWKS_URL: undefined,
      },
      async () => {
        let auditRecord = null;
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
            'authOidcFlow.delete': async ({ where }) => ({ id: where.id }),
            'userIdentity.findFirst': async () => {
              throw new Error('userIdentity.findFirst should not be called');
            },
            'authSession.create': async () => {
              throw new Error('authSession.create should not be called');
            },
            'auditLog.create': async ({ data }) => {
              auditRecord = data;
              return { id: 'audit-callback-failed' };
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
                },
              });
              assert.equal(res.statusCode, 401, res.body);
              const body = JSON.parse(res.body);
              assert.equal(body.error.code, 'google_auth_callback_failed');
              assert.match(
                String(res.headers['set-cookie']),
                /erp4_auth_flow=;/,
              );
            } finally {
              await server.close();
            }
          },
        );
        assert.equal(auditRecord?.action, 'google_oidc_login_failed');
        assert.equal(auditRecord?.reasonCode, 'callback_validation_failed');
        assert.match(
          String(auditRecord?.metadata?.error ?? ''),
          /google_nonce_mismatch/,
        );
      },
    );
  } finally {
    global.fetch = originalFetch;
  }
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
        'userIdentity.findUnique': async () => ({
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

test('GET /auth/session returns current authenticated session in jwt_bff mode', async () => {
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
          createdAt: new Date('2026-03-23T00:00:00.000Z'),
          lastSeenAt: new Date('2026-03-23T00:05:00.000Z'),
          expiresAt: new Date(Date.now() + 60_000),
          idleExpiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
          revokedReason: null,
          sourceIp: '127.0.0.1',
          userAgent: 'test-agent',
        }),
        'authSession.update': async ({ data }) => ({
          id: 'sess-001',
          userAccountId: 'user-001',
          userIdentityId: 'identity-001',
          providerType: 'google_oidc',
          issuer: 'https://accounts.google.com',
          providerSubject: 'google-sub-001',
          createdAt: new Date('2026-03-23T00:00:00.000Z'),
          lastSeenAt: data.lastSeenAt,
          expiresAt: new Date(Date.now() + 60_000),
          idleExpiresAt: data.idleExpiresAt,
          revokedAt: null,
          revokedReason: null,
          sourceIp: '127.0.0.1',
          userAgent: 'test-agent',
        }),
        'userIdentity.findUnique': async () => ({
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
            url: '/auth/session',
            headers: {
              cookie: 'erp4_session=session-token-001',
            },
          });
          assert.equal(res.statusCode, 200, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.user.userId, 'legacy-user');
          assert.equal(body.user.auth.sessionBased, true);
          assert.equal(body.session.sessionId, 'sess-001');
          assert.equal(body.session.userAccountId, 'user-001');
          assert.equal(body.session.userIdentityId, 'identity-001');
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('GET /auth/session returns unauthorized when session cookie is missing', async () => {
  await withEnv(baseBffEnv(), async () => {
    await withPrismaStubs({}, async () => {
      const { buildServer } = await loadBackendModules();
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/auth/session',
        });
        assert.equal(res.statusCode, 401, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error.code, 'unauthorized');
        assert.equal(body.error.details.reason, 'missing_session');
      } finally {
        await server.close();
      }
    });
  });
});

test('POST /auth/logout clears current session cookie', async () => {
  await withEnv(baseBffEnv(), async () => {
    let revokedId = null;
    let capturedAudit = null;
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
        'auditLog.create': async ({ data }) => {
          capturedAudit = data;
          return { id: 'audit-logout' };
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/auth/logout',
            headers: {
              cookie:
                'erp4_session=session-token-001; erp4_csrf=csrf-token-001',
              'x-csrf-token': 'csrf-token-001',
              'user-agent': 'test-agent',
            },
          });
          assert.equal(res.statusCode, 204, res.body);
          assert.equal(revokedId, 'sess-001');
          assert.equal(capturedAudit?.action, 'auth_session_logout');
          assert.equal(capturedAudit?.targetTable, 'AuthSession');
          assert.equal(capturedAudit?.targetId, 'sess-001');
          assert.equal(capturedAudit?.metadata?.userAccountId, 'user-001');
          assert.equal(capturedAudit?.metadata?.identityId, 'identity-001');
          assert.equal(
            capturedAudit?.metadata?.issuer,
            'https://accounts.google.com',
          );
          assert.equal(
            capturedAudit?.metadata?.providerSubject,
            'google-sub-001',
          );
          assert.equal(capturedAudit?.userAgent, 'test-agent');
          assert.match(String(res.headers['set-cookie']), /erp4_session=;/);
          assert.match(String(res.headers['set-cookie']), /erp4_csrf=;/);
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('GET /auth/csrf returns token and sets csrf cookie', async () => {
  await withEnv(baseBffEnv(), async () => {
    await withPrismaStubs({}, async () => {
      const { buildServer } = await loadBackendModules();
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/auth/csrf',
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.ok(typeof body.csrfToken === 'string' && body.csrfToken.length);
        assert.match(String(res.headers['set-cookie']), /erp4_csrf=/);
        assert.equal(res.headers['cache-control'], 'no-store');
        assert.equal(res.headers.pragma, 'no-cache');
      } finally {
        await server.close();
      }
    });
  });
});

test('GET /auth/csrf reuses csrf cookie token without rotating it', async () => {
  await withEnv(baseBffEnv(), async () => {
    await withPrismaStubs({}, async () => {
      const { buildServer } = await loadBackendModules();
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/auth/csrf',
          headers: {
            cookie: 'erp4_csrf=csrf-token-existing',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.csrfToken, 'csrf-token-existing');
        assert.equal(res.headers['set-cookie'], undefined);
        assert.equal(res.headers['cache-control'], 'no-store');
        assert.equal(res.headers.pragma, 'no-cache');
      } finally {
        await server.close();
      }
    });
  });
});

test('POST /auth/logout returns invalid_csrf_token when csrf header mismatches cookie', async () => {
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
        'authSession.update': async () => {
          throw new Error('authSession.update should not be called');
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/auth/logout',
            headers: {
              cookie:
                'erp4_session=session-token-001; erp4_csrf=csrf-token-001',
              'x-csrf-token': 'csrf-token-002',
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

test('GET /auth/sessions returns unauthorized when session cookie is missing', async () => {
  await withEnv(baseBffEnv(), async () => {
    await withPrismaStubs({}, async () => {
      const { buildServer } = await loadBackendModules();
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/auth/sessions',
        });
        assert.equal(res.statusCode, 401, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error.code, 'unauthorized');
        assert.equal(body.error.details.reason, 'missing_session');
      } finally {
        await server.close();
      }
    });
  });
});

test('POST /auth/sessions/:sessionId/revoke returns invalid_csrf_token when csrf header mismatches cookie', async () => {
  await withEnv(baseBffEnv(), async () => {
    let findFirstCalled = false;
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => ({
          id: 'sess-current',
          userAccountId: 'user-001',
          userIdentityId: 'identity-001',
          providerType: 'google_oidc',
          issuer: 'https://accounts.google.com',
          providerSubject: 'google-sub-001',
          expiresAt: new Date(Date.now() + 60_000),
          idleExpiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
        }),
        'authSession.update': async ({ where, data }) => ({
          id: where.id,
          userAccountId: 'user-001',
          userIdentityId: 'identity-001',
          providerType: 'google_oidc',
          issuer: 'https://accounts.google.com',
          providerSubject: 'google-sub-001',
          expiresAt: new Date(Date.now() + 60_000),
          idleExpiresAt: data.idleExpiresAt ?? new Date(Date.now() + 60_000),
          revokedAt: null,
        }),
        'authSession.findFirst': async () => {
          findFirstCalled = true;
          return null;
        },
        'userIdentity.findUnique': async () => ({
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
        'auditLog.create': async () => {
          throw new Error('auditLog.create should not be called');
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/auth/sessions/sess-current/revoke',
            headers: {
              cookie:
                'erp4_session=session-token-001; erp4_csrf=csrf-token-001',
              'x-csrf-token': 'csrf-token-002',
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
    assert.equal(findFirstCalled, false);
  });
});

test('POST /auth/sessions/:sessionId/revoke returns auth_session_not_found when target session is missing', async () => {
  await withEnv(baseBffEnv(), async () => {
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => ({
          id: 'sess-current',
          userAccountId: 'user-001',
          userIdentityId: 'identity-001',
          providerType: 'google_oidc',
          issuer: 'https://accounts.google.com',
          providerSubject: 'google-sub-001',
          expiresAt: new Date(Date.now() + 60_000),
          idleExpiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
        }),
        'authSession.update': async ({ where, data }) => ({
          id: where.id,
          userAccountId: 'user-001',
          userIdentityId: 'identity-001',
          providerType: 'google_oidc',
          issuer: 'https://accounts.google.com',
          providerSubject: 'google-sub-001',
          createdAt: new Date('2026-03-23T00:00:00.000Z'),
          lastSeenAt: data.lastSeenAt ?? new Date('2026-03-23T00:05:00.000Z'),
          expiresAt: new Date(Date.now() + 60_000),
          idleExpiresAt: data.idleExpiresAt ?? new Date(Date.now() + 60_000),
          revokedAt: null,
          revokedReason: null,
          sourceIp: '127.0.0.1',
          userAgent: 'test-agent',
        }),
        'authSession.findFirst': async () => null,
        'userIdentity.findUnique': async () => ({
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
        'auditLog.create': async () => {
          throw new Error('auditLog.create should not be called');
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/auth/sessions/sess-missing/revoke',
            headers: {
              cookie:
                'erp4_session=session-token-001; erp4_csrf=csrf-token-001',
              'x-csrf-token': 'csrf-token-001',
            },
          });
          assert.equal(res.statusCode, 404, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'auth_session_not_found');
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('GET /auth/sessions lists active sessions for current user', async () => {
  await withEnv(baseBffEnv(), async () => {
    let capturedFindManyArgs = null;
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => ({
          id: 'sess-current',
          userAccountId: 'user-001',
          userIdentityId: 'identity-001',
          providerType: 'google_oidc',
          issuer: 'https://accounts.google.com',
          providerSubject: 'google-sub-001',
          expiresAt: new Date(Date.now() + 60_000),
          idleExpiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
        }),
        'authSession.update': async ({ where, data }) => ({
          id: where.id,
          userAccountId: 'user-001',
          userIdentityId: 'identity-001',
          providerType: 'google_oidc',
          issuer: 'https://accounts.google.com',
          providerSubject: 'google-sub-001',
          createdAt: new Date('2026-03-23T00:00:00.000Z'),
          lastSeenAt: new Date('2026-03-23T00:05:00.000Z'),
          expiresAt: new Date(Date.now() + 60_000),
          idleExpiresAt: data.idleExpiresAt ?? new Date(Date.now() + 60_000),
          revokedAt: null,
          revokedReason: null,
          sourceIp: '127.0.0.1',
          userAgent: 'test-agent',
        }),
        'userIdentity.findUnique': async () => ({
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
        'authSession.findMany': async (args) => {
          capturedFindManyArgs = args;
          return [
            {
              id: 'sess-current',
              userAccountId: 'user-001',
              userIdentityId: 'identity-001',
              providerType: 'google_oidc',
              issuer: 'https://accounts.google.com',
              providerSubject: 'google-sub-001',
              sourceIp: '127.0.0.1',
              userAgent: 'test-agent',
              createdAt: new Date('2026-03-23T00:00:00.000Z'),
              lastSeenAt: new Date('2026-03-23T00:05:00.000Z'),
              expiresAt: new Date('2026-03-23T12:00:00.000Z'),
              idleExpiresAt: new Date('2026-03-23T02:00:00.000Z'),
              revokedAt: null,
              revokedReason: null,
            },
            {
              id: 'sess-other',
              userAccountId: 'user-001',
              userIdentityId: 'identity-002',
              providerType: 'local_password',
              issuer: 'erp4_local',
              providerSubject: 'local-sub-001',
              sourceIp: '127.0.0.2',
              userAgent: 'test-agent-2',
              createdAt: new Date('2026-03-22T20:00:00.000Z'),
              lastSeenAt: new Date('2026-03-23T00:03:00.000Z'),
              expiresAt: new Date('2026-03-23T12:00:00.000Z'),
              idleExpiresAt: new Date('2026-03-23T02:00:00.000Z'),
              revokedAt: null,
              revokedReason: null,
            },
          ];
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'GET',
            url: '/auth/sessions?limit=10&offset=0',
            headers: {
              cookie: 'erp4_session=session-token-001',
            },
          });
          assert.equal(res.statusCode, 200, res.body);
          const body = JSON.parse(res.body);
          assert.equal(body.items.length, 2);
          assert.equal(body.items[0].sessionId, 'sess-current');
          assert.equal(body.items[0].current, true);
          assert.equal(body.items[1].sessionId, 'sess-other');
          assert.equal(body.items[1].current, false);
          assert.equal(capturedFindManyArgs?.where?.revokedAt, null);
          assert.ok(capturedFindManyArgs?.where?.expiresAt?.gt instanceof Date);
          assert.ok(
            capturedFindManyArgs?.where?.idleExpiresAt?.gt instanceof Date,
          );
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('POST /auth/sessions/:sessionId/revoke revokes current-user session and clears cookie when current session is targeted', async () => {
  await withEnv(baseBffEnv(), async () => {
    let revokedId = null;
    let capturedAudit = null;
    let capturedFindFirstArgs = null;
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => ({
          id: 'sess-current',
          userAccountId: 'user-001',
          userIdentityId: 'identity-001',
          providerType: 'google_oidc',
          issuer: 'https://accounts.google.com',
          providerSubject: 'google-sub-001',
          expiresAt: new Date(Date.now() + 60_000),
          idleExpiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
        }),
        'authSession.update': async ({ where, data }) => {
          if (where.id === 'sess-current' && data.idleExpiresAt) {
            return {
              id: where.id,
              userAccountId: 'user-001',
              userIdentityId: 'identity-001',
              providerType: 'google_oidc',
              issuer: 'https://accounts.google.com',
              providerSubject: 'google-sub-001',
              createdAt: new Date('2026-03-23T00:00:00.000Z'),
              lastSeenAt: new Date('2026-03-23T00:05:00.000Z'),
              expiresAt: new Date(Date.now() + 60_000),
              idleExpiresAt: data.idleExpiresAt,
              revokedAt: null,
              revokedReason: null,
              sourceIp: '127.0.0.1',
              userAgent: 'test-agent',
            };
          }
          revokedId = where.id;
          return {
            id: where.id,
            userAccountId: 'user-001',
            userIdentityId: 'identity-001',
            providerType: 'google_oidc',
            issuer: 'https://accounts.google.com',
            providerSubject: 'google-sub-001',
            createdAt: new Date('2026-03-23T00:00:00.000Z'),
            lastSeenAt: new Date('2026-03-23T00:05:00.000Z'),
            expiresAt: new Date(Date.now() + 60_000),
            idleExpiresAt: new Date(Date.now() + 60_000),
            revokedAt: new Date('2026-03-23T00:06:00.000Z'),
            revokedReason: data.revokedReason,
            sourceIp: '127.0.0.1',
            userAgent: 'test-agent',
          };
        },
        'authSession.findFirst': async (args) => {
          capturedFindFirstArgs = args;
          return {
            id: 'sess-current',
            userAccountId: 'user-001',
            userIdentityId: 'identity-001',
            providerType: 'google_oidc',
            issuer: 'https://accounts.google.com',
            providerSubject: 'google-sub-001',
            createdAt: new Date('2026-03-23T00:00:00.000Z'),
            lastSeenAt: new Date('2026-03-23T00:05:00.000Z'),
            expiresAt: new Date(Date.now() + 60_000),
            idleExpiresAt: new Date(Date.now() + 60_000),
            revokedAt: null,
            revokedReason: null,
            sourceIp: '127.0.0.1',
            userAgent: 'test-agent',
          };
        },
        'userIdentity.findUnique': async () => ({
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
        'auditLog.create': async ({ data }) => {
          capturedAudit = data;
          return { id: 'audit-session-revoke' };
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/auth/sessions/sess-current/revoke',
            headers: {
              cookie:
                'erp4_session=session-token-001; erp4_csrf=csrf-token-001',
              'x-csrf-token': 'csrf-token-001',
              'user-agent': 'test-agent',
            },
          });
          assert.equal(res.statusCode, 200, res.body);
          assert.equal(revokedId, 'sess-current');
          assert.equal(capturedAudit?.action, 'auth_session_revoked');
          assert.equal(capturedAudit?.targetTable, 'AuthSession');
          assert.equal(capturedAudit?.targetId, 'sess-current');
          assert.equal(capturedAudit?.metadata?.userAccountId, 'user-001');
          assert.equal(capturedAudit?.metadata?.identityId, 'identity-001');
          assert.equal(
            capturedAudit?.metadata?.issuer,
            'https://accounts.google.com',
          );
          assert.equal(
            capturedAudit?.metadata?.providerSubject,
            'google-sub-001',
          );
          assert.equal(
            capturedAudit?.metadata?.revokedBySessionId,
            'sess-current',
          );
          assert.equal(capturedAudit?.userAgent, 'test-agent');
          assert.match(String(res.headers['set-cookie']), /erp4_session=;/);
          assert.match(String(res.headers['set-cookie']), /erp4_csrf=;/);
          const body = JSON.parse(res.body);
          assert.equal(body.sessionId, 'sess-current');
          assert.equal(body.revokedReason, 'user_requested');
          assert.equal(body.current, true);
          assert.equal(capturedFindFirstArgs?.where?.revokedAt, null);
          assert.ok(
            capturedFindFirstArgs?.where?.expiresAt?.gt instanceof Date,
          );
          assert.ok(
            capturedFindFirstArgs?.where?.idleExpiresAt?.gt instanceof Date,
          );
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('POST /auth/sessions/:sessionId/revoke keeps current cookie when another session is targeted', async () => {
  await withEnv(baseBffEnv(), async () => {
    let revokedId = null;
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => ({
          id: 'sess-current',
          userAccountId: 'user-001',
          userIdentityId: 'identity-001',
          providerType: 'google_oidc',
          issuer: 'https://accounts.google.com',
          providerSubject: 'google-sub-001',
          expiresAt: new Date(Date.now() + 60_000),
          idleExpiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
        }),
        'authSession.update': async ({ where, data }) => {
          if (where.id === 'sess-current' && data.idleExpiresAt) {
            return {
              id: where.id,
              userAccountId: 'user-001',
              userIdentityId: 'identity-001',
              providerType: 'google_oidc',
              issuer: 'https://accounts.google.com',
              providerSubject: 'google-sub-001',
              createdAt: new Date('2026-03-23T00:00:00.000Z'),
              lastSeenAt: new Date('2026-03-23T00:05:00.000Z'),
              expiresAt: new Date(Date.now() + 60_000),
              idleExpiresAt: data.idleExpiresAt,
              revokedAt: null,
              revokedReason: null,
              sourceIp: '127.0.0.1',
              userAgent: 'test-agent',
            };
          }
          revokedId = where.id;
          return {
            id: where.id,
            userAccountId: 'user-001',
            userIdentityId: 'identity-002',
            providerType: 'local_password',
            issuer: 'erp4_local',
            providerSubject: 'local-sub-001',
            createdAt: new Date('2026-03-23T00:00:00.000Z'),
            lastSeenAt: new Date('2026-03-23T00:05:00.000Z'),
            expiresAt: new Date(Date.now() + 60_000),
            idleExpiresAt: new Date(Date.now() + 60_000),
            revokedAt: new Date('2026-03-23T00:06:00.000Z'),
            revokedReason: data.revokedReason,
            sourceIp: '127.0.0.2',
            userAgent: 'other-agent',
          };
        },
        'authSession.findFirst': async () => ({
          id: 'sess-other',
          userAccountId: 'user-001',
          userIdentityId: 'identity-002',
          providerType: 'local_password',
          issuer: 'erp4_local',
          providerSubject: 'local-sub-001',
          createdAt: new Date('2026-03-23T00:00:00.000Z'),
          lastSeenAt: new Date('2026-03-23T00:05:00.000Z'),
          expiresAt: new Date(Date.now() + 60_000),
          idleExpiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
          revokedReason: null,
          sourceIp: '127.0.0.2',
          userAgent: 'other-agent',
        }),
        'userIdentity.findUnique': async () => ({
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
        'auditLog.create': async () => ({ id: 'audit-session-revoke-other' }),
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/auth/sessions/sess-other/revoke',
            headers: {
              cookie:
                'erp4_session=session-token-001; erp4_csrf=csrf-token-001',
              'x-csrf-token': 'csrf-token-001',
            },
          });
          assert.equal(res.statusCode, 200, res.body);
          assert.equal(revokedId, 'sess-other');
          assert.equal(res.headers['set-cookie'], undefined);
          const body = JSON.parse(res.body);
          assert.equal(body.sessionId, 'sess-other');
          assert.equal(body.current, false);
          assert.equal(body.revokedReason, 'user_requested');
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('POST /auth/logout clears cookies without audit when session cookie is missing', async () => {
  await withEnv(baseBffEnv(), async () => {
    let auditCalled = false;
    await withPrismaStubs(
      {
        'authSession.findUnique': async () => null,
        'auditLog.create': async () => {
          auditCalled = true;
          return { id: 'audit-unexpected' };
        },
      },
      async () => {
        const { buildServer } = await loadBackendModules();
        const server = await buildServer({ logger: false });
        try {
          const res = await server.inject({
            method: 'POST',
            url: '/auth/logout',
            headers: {
              cookie: 'erp4_csrf=csrf-token-001',
              'x-csrf-token': 'csrf-token-001',
            },
          });
          assert.equal(res.statusCode, 204, res.body);
          assert.equal(auditCalled, false);
          assert.match(String(res.headers['set-cookie']), /erp4_session=;/);
          assert.match(String(res.headers['set-cookie']), /erp4_csrf=;/);
        } finally {
          await server.close();
        }
      },
    );
  });
});

test('POST /auth/logout returns auth_gateway_rate_limited before session revoke', async () => {
  await withEnv(baseBffEnv(), async () => {
    let authSessionLookupCalled = false;
    let auditCalled = false;
    const ip = '198.51.100.201';
    await withRateLimiterFailure(ip, async () => {
      await withPrismaStubs(
        {
          'authSession.findUnique': async () => {
            authSessionLookupCalled = true;
            return null;
          },
          'auditLog.create': async () => {
            auditCalled = true;
            return { id: 'audit-unexpected' };
          },
        },
        async () => {
          const { buildServer } = await loadBackendModules();
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/auth/logout',
              headers: {
                cookie: 'erp4_csrf=csrf-token-001',
                'x-csrf-token': 'csrf-token-001',
              },
              remoteAddress: ip,
            });
            assert.equal(res.statusCode, 429, res.body);
            const body = JSON.parse(res.body);
            assert.equal(body.error.code, 'auth_gateway_rate_limited');
          } finally {
            await server.close();
          }
        },
      );
    });
    assert.equal(authSessionLookupCalled, false);
    assert.equal(auditCalled, false);
  });
});
