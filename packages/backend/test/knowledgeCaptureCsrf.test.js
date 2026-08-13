import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('capture mutations fail closed on the jwt_bff CSRF boundary', () => {
  const child = spawnSync(
    process.execPath,
    ['scripts/fixtures/knowledgeCaptureCsrf.mjs'],
    {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      env: {
        ...process.env,
        AUTH_MODE: 'jwt_bff',
        DATABASE_URL:
          process.env.DATABASE_URL ??
          'postgresql://erp4:erp4@127.0.0.1:5432/erp4?schema=public',
      },
    },
  );
  assert.equal(
    child.status,
    0,
    `fixture failed without exposing request content: ${child.stderr
      .split('\n')
      .slice(-10)
      .join('\n')}`,
  );
});
