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

test('auth route delegates Google BFF/session endpoints to a dedicated module', () => {
  const authRoute = readSource('src/routes/auth.ts');
  const googleSessionRoute = readSource(
    'src/routes/auth/googleSessionRoutes.ts',
  );

  assert.ok(
    countLines(authRoute) <= 2500,
    'src/routes/auth.ts should stay below the reduced temporary max-lines cap',
  );
  assert.match(authRoute, /registerGoogleSessionAuthRoutes\(app\)/);
  assert.doesNotMatch(authRoute, /['"]\/auth\/google\/start['"]/);
  assert.doesNotMatch(
    authRoute,
    /['"]\/auth\/sessions\/:sessionId\/revoke['"]/,
  );

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
});

test('auth coverage scope includes split Google/session route modules', () => {
  const coverageConfig = JSON.parse(readSource('coverage-thresholds.json'));
  const configured = new Set(coverageConfig.auth.files);

  assert.ok(configured.has('src/routes/auth.ts'));
  assert.ok(configured.has('src/routes/auth/googleSessionRoutes.ts'));
  assert.ok(configured.has('src/routes/auth/http.ts'));
});
