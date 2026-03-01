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

function withEnv(overrides, fn) {
  const prev = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    prev.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of prev.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

function withServer(fn) {
  return withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        await fn(server);
      } finally {
        await server.close();
      }
    },
  );
}

function userHeaders(userId = 'user-1') {
  return {
    'x-user-id': userId,
    'x-roles': 'user',
  };
}

function adminHeaders(userId = 'admin-1') {
  return {
    'x-user-id': userId,
    'x-roles': 'admin,mgmt',
  };
}

test('GET /leave-calendar/workday-overrides limits non-privileged user to self', async () => {
  let capturedWhere = null;
  await withPrismaStubs(
    {
      'leaveWorkdayOverride.findMany': async (args) => {
        capturedWhere = args.where;
        return [];
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/leave-calendar/workday-overrides',
          headers: userHeaders('employee-1'),
        });
        assert.equal(res.statusCode, 200, res.body);
      });
    },
  );
  assert.equal(capturedWhere?.userId, 'employee-1');
});

test('GET /leave-calendar/workday-overrides rejects cross-user access for non-privileged user', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'GET',
      url: '/leave-calendar/workday-overrides?userId=other-user',
      headers: userHeaders('employee-1'),
    });
    assert.equal(res.statusCode, 403, res.body);
  });
});

test('POST /leave-calendar/company-holidays is forbidden for user role', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/leave-calendar/company-holidays',
      headers: userHeaders('employee-1'),
      payload: { holidayDate: '2026-03-20', name: '祝日' },
    });
    assert.equal(res.statusCode, 403, res.body);
  });
});

test('POST /leave-calendar/company-holidays upserts holiday and writes audit', async () => {
  let capturedUpsert = null;
  const auditActions = [];
  await withPrismaStubs(
    {
      'leaveCompanyHoliday.upsert': async (args) => {
        capturedUpsert = args;
        return {
          id: 'holiday-1',
          holidayDate: new Date('2026-03-20T00:00:00.000Z'),
          name: args.create.name,
        };
      },
      'auditLog.create': async (args) => {
        auditActions.push(args?.data?.action);
        return { id: 'audit-1' };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/leave-calendar/company-holidays',
          headers: adminHeaders('admin-1'),
          payload: { holidayDate: '2026-03-20', name: '春分の日' },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.id, 'holiday-1');
      });
    },
  );
  assert.equal(
    capturedUpsert?.where?.holidayDate?.toISOString(),
    '2026-03-20T00:00:00.000Z',
  );
  assert.ok(auditActions.includes('leave_company_holiday_upserted'));
});
