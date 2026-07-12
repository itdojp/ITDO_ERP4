import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const BACKEND_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function readSource(relativePath) {
  return readFileSync(path.join(BACKEND_DIR, relativePath), 'utf8');
}

function countLines(source) {
  return source.split('\n').length;
}

test('auth route delegates auth endpoint families to dedicated modules', () => {
  const authRoute = readSource('src/routes/auth.ts');
  const googleSessionRoute = readSource(
    'src/routes/auth/googleSessionRoutes.ts',
  );
  const localAuthRoute = readSource('src/routes/auth/localAuthRoutes.ts');
  const identityAdminRoute = readSource(
    'src/routes/auth/userIdentityAdminRoutes.ts',
  );
  const credentialAdminRoute = readSource(
    'src/routes/auth/localCredentialAdminRoutes.ts',
  );

  assert.ok(
    countLines(authRoute) <= 500,
    'src/routes/auth.ts should remain an auth route composition module',
  );
  assert.match(authRoute, /registerGoogleSessionAuthRoutes\(app\)/);
  assert.match(authRoute, /registerLocalAuthRoutes\(app\)/);
  assert.match(authRoute, /registerUserIdentityAdminRoutes\(app\)/);
  assert.match(authRoute, /registerLocalCredentialAdminRoutes\(app\)/);

  for (const endpoint of [
    '/auth/google/start',
    '/auth/local/login',
    '/auth/local/password/rotate',
    '/auth/user-identities',
    '/auth/user-identities/google-link',
    '/auth/user-identities/local-link',
    '/auth/user-identities/:identityId',
    '/auth/local-credentials',
    '/auth/local-credentials/:identityId',
  ]) {
    assert.equal(
      authRoute.includes(`'${endpoint}'`) ||
        authRoute.includes(`"${endpoint}"`),
      false,
      `${endpoint} should not be registered directly by auth.ts`,
    );
  }

  for (const endpoint of [
    '/auth/google/start',
    '/auth/google/callback',
    '/auth/session',
    '/auth/csrf',
    '/auth/sessions',
    '/auth/sessions/:sessionId/revoke',
    '/auth/logout',
  ]) {
    assert.ok(
      googleSessionRoute.includes(`'${endpoint}'`),
      `${endpoint} should be registered by googleSessionRoutes.ts`,
    );
  }

  for (const endpoint of ['/auth/local/login', '/auth/local/password/rotate']) {
    assert.ok(
      localAuthRoute.includes(`'${endpoint}'`),
      `${endpoint} should be registered by localAuthRoutes.ts`,
    );
  }

  for (const endpoint of [
    '/auth/user-identities',
    '/auth/user-identities/google-link',
    '/auth/user-identities/local-link',
    '/auth/user-identities/:identityId',
  ]) {
    assert.ok(
      identityAdminRoute.includes(`'${endpoint}'`),
      `${endpoint} should be registered by userIdentityAdminRoutes.ts`,
    );
  }

  for (const endpoint of [
    '/auth/local-credentials',
    '/auth/local-credentials/:identityId',
  ]) {
    assert.ok(
      credentialAdminRoute.includes(`'${endpoint}'`),
      `${endpoint} should be registered by localCredentialAdminRoutes.ts`,
    );
  }
});

test('auth coverage scope includes split auth route and application modules', () => {
  const coverageConfig = JSON.parse(readSource('coverage-thresholds.json'));
  const configured = new Set(coverageConfig.auth.files);

  assert.ok(configured.has('src/routes/auth.ts'));
  for (const file of [
    'src/application/auth/localIdentityShared.ts',
    'src/application/auth/localIdentityUseCases.ts',
    'src/routes/auth/googleSessionRoutes.ts',
    'src/routes/auth/http.ts',
    'src/routes/auth/localAuthRoutes.ts',
    'src/routes/auth/localCredentialAdminRoutes.ts',
    'src/routes/auth/localIdentityHttp.ts',
    'src/routes/auth/localIdentitySchemas.ts',
    'src/routes/auth/userIdentityAdminRoutes.ts',
  ]) {
    assert.ok(configured.has(file), `${file} should be in auth coverage scope`);
  }
});
