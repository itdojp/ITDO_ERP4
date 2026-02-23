import assert from 'node:assert/strict';
import test from 'node:test';

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

function extractErrorCode(payload) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.error === 'string') return payload.error;
    if (payload.error && typeof payload.error === 'object') {
      return payload.error.code;
    }
  }
  return '';
}

test('POST /jobs/alerts/run returns 403 for non-admin role', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  const server = await buildServer({ logger: false });
  try {
    const res = await server.inject({
      method: 'POST',
      url: '/jobs/alerts/run',
      headers: {
        'x-user-id': 'user-1',
        'x-roles': 'user',
      },
    });
    assert.equal(res.statusCode, 403, res.body);
    const body = JSON.parse(res.body);
    assert.equal(String(extractErrorCode(body)), 'forbidden');
  } finally {
    await server.close();
  }
});

test('POST /jobs/approval-escalations/run returns 403 for non-admin role', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  const server = await buildServer({ logger: false });
  try {
    const res = await server.inject({
      method: 'POST',
      url: '/jobs/approval-escalations/run',
      headers: {
        'x-user-id': 'user-1',
        'x-roles': 'user',
      },
    });
    assert.equal(res.statusCode, 403, res.body);
    const body = JSON.parse(res.body);
    assert.equal(String(extractErrorCode(body)), 'forbidden');
  } finally {
    await server.close();
  }
});

test('POST /jobs/alerts/run and /jobs/approval-escalations/run return 200 for admin role', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  await withPrismaStubs(
    {
      'alertSetting.findMany': async () => [],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const alertJobRes = await server.inject({
          method: 'POST',
          url: '/jobs/alerts/run',
          headers: {
            'x-user-id': 'admin-1',
            'x-roles': 'admin',
          },
        });
        assert.equal(alertJobRes.statusCode, 200, alertJobRes.body);
        assert.equal(JSON.parse(alertJobRes.body).ok, true);

        const escalationJobRes = await server.inject({
          method: 'POST',
          url: '/jobs/approval-escalations/run',
          headers: {
            'x-user-id': 'admin-1',
            'x-roles': 'admin',
          },
        });
        assert.equal(escalationJobRes.statusCode, 200, escalationJobRes.body);
        assert.equal(JSON.parse(escalationJobRes.body).ok, true);
      } finally {
        await server.close();
      }
    },
  );
});
