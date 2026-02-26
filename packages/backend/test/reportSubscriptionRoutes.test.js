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

function adminHeaders() {
  return {
    'x-user-id': 'admin-user',
    'x-roles': 'admin,mgmt',
  };
}

function userHeaders() {
  return {
    'x-user-id': 'normal-user',
    'x-roles': 'user',
  };
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

test('GET /report-subscriptions denies non admin/mgmt user', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'GET',
      url: '/report-subscriptions',
      headers: userHeaders(),
    });
    assert.equal(res.statusCode, 403, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'forbidden');
  });
});

test('GET /report-subscriptions returns ordered subscriptions', async () => {
  let capturedArgs = null;
  await withPrismaStubs(
    {
      'reportSubscription.findMany': async (args) => {
        capturedArgs = args;
        return [{ id: 'sub-1', reportKey: 'project_profit' }];
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/report-subscriptions',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.items?.length, 1);
      });
    },
  );
  assert.deepEqual(capturedArgs, { orderBy: { createdAt: 'desc' } });
});

test('GET /report-deliveries uses default pagination for invalid query values', async () => {
  let capturedArgs = null;
  await withPrismaStubs(
    {
      'reportDelivery.findMany': async (args) => {
        capturedArgs = args;
        return [];
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/report-deliveries?limit=abc&offset=-3',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.limit, 50);
        assert.equal(body?.offset, 0);
        assert.deepEqual(body?.items, []);
      });
    },
  );
  assert.equal(capturedArgs?.take, 50);
  assert.equal(capturedArgs?.skip, 0);
  assert.deepEqual(capturedArgs?.orderBy, { sentAt: 'desc' });
  assert.equal(capturedArgs?.where, undefined);
});

test('GET /report-deliveries caps pagination and applies subscriptionId filter', async () => {
  let capturedArgs = null;
  await withPrismaStubs(
    {
      'reportDelivery.findMany': async (args) => {
        capturedArgs = args;
        return [];
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'GET',
          url: '/report-deliveries?subscriptionId=11111111-1111-4111-8111-111111111111&limit=999&offset=5',
          headers: adminHeaders(),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.limit, 200);
        assert.equal(body?.offset, 5);
      });
    },
  );
  assert.equal(capturedArgs?.take, 200);
  assert.equal(capturedArgs?.skip, 5);
  assert.deepEqual(capturedArgs?.where, {
    subscriptionId: '11111111-1111-4111-8111-111111111111',
  });
});

test('POST /report-subscriptions sets defaults and actor metadata', async () => {
  let capturedArgs = null;
  await withPrismaStubs(
    {
      'reportSubscription.create': async (args) => {
        capturedArgs = args;
        return {
          id: 'sub-1',
          reportKey: args.data.reportKey,
          format: args.data.format,
          channels: args.data.channels,
          isEnabled: args.data.isEnabled,
        };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/report-subscriptions',
          headers: adminHeaders(),
          payload: {
            name: '  Weekly Profit  ',
            reportKey: 'project_profit',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.format, 'csv');
        assert.deepEqual(body?.channels, ['dashboard']);
        assert.equal(body?.isEnabled, true);
      });
    },
  );
  assert.equal(capturedArgs?.data?.name, 'Weekly Profit');
  assert.equal(capturedArgs?.data?.reportKey, 'project_profit');
  assert.equal(capturedArgs?.data?.format, 'csv');
  assert.deepEqual(capturedArgs?.data?.channels, ['dashboard']);
  assert.equal(capturedArgs?.data?.isEnabled, true);
  assert.equal(capturedArgs?.data?.createdBy, 'admin-user');
  assert.equal(capturedArgs?.data?.updatedBy, 'admin-user');
});

test('POST /report-subscriptions rejects unsupported format in schema', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/report-subscriptions',
      headers: adminHeaders(),
      payload: {
        reportKey: 'project_profit',
        format: 'xlsx',
      },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body?.error?.code, 'VALIDATION_ERROR');
  });
});

test('PATCH /report-subscriptions/:id returns not_found when subscription does not exist', async () => {
  await withPrismaStubs(
    {
      'reportSubscription.findUnique': async () => null,
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'PATCH',
          url: '/report-subscriptions/sub-missing',
          headers: adminHeaders(),
          payload: { isEnabled: false },
        });
        assert.equal(res.statusCode, 404, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'not_found');
      });
    },
  );
});

test('PATCH /report-subscriptions/:id rejects blank reportKey after trim', async () => {
  let updateCalled = false;
  await withPrismaStubs(
    {
      'reportSubscription.findUnique': async () => ({
        id: 'sub-1',
        reportKey: 'project_profit',
        format: 'csv',
      }),
      'reportSubscription.update': async () => {
        updateCalled = true;
        return null;
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'PATCH',
          url: '/report-subscriptions/sub-1',
          headers: adminHeaders(),
          payload: { reportKey: '   ' },
        });
        assert.equal(res.statusCode, 400, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.error?.code, 'INVALID_REPORT_KEY');
      });
    },
  );
  assert.equal(updateCalled, false);
});

test('PATCH /report-subscriptions/:id updates mutable fields and preserves reportKey/format', async () => {
  let capturedUpdateArgs = null;
  await withPrismaStubs(
    {
      'reportSubscription.findUnique': async () => ({
        id: 'sub-1',
        reportKey: 'project_profit',
        format: 'csv',
      }),
      'reportSubscription.update': async (args) => {
        capturedUpdateArgs = args;
        return {
          id: 'sub-1',
          reportKey: args.data.reportKey,
          format: args.data.format,
          isEnabled: args.data.isEnabled,
          channels: args.data.channels,
        };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'PATCH',
          url: '/report-subscriptions/sub-1',
          headers: adminHeaders(),
          payload: {
            name: '  Daily Digest  ',
            schedule: '0 6 * * *',
            recipients: { emails: ['ops@example.com'] },
            channels: ['email'],
            isEnabled: false,
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.reportKey, 'project_profit');
        assert.equal(body?.format, 'csv');
        assert.equal(body?.isEnabled, false);
      });
    },
  );
  assert.equal(capturedUpdateArgs?.where?.id, 'sub-1');
  assert.equal(capturedUpdateArgs?.data?.name, 'Daily Digest');
  assert.equal(capturedUpdateArgs?.data?.reportKey, 'project_profit');
  assert.equal(capturedUpdateArgs?.data?.format, 'csv');
  assert.equal(capturedUpdateArgs?.data?.schedule, '0 6 * * *');
  assert.deepEqual(capturedUpdateArgs?.data?.recipients, {
    emails: ['ops@example.com'],
  });
  assert.deepEqual(capturedUpdateArgs?.data?.channels, ['email']);
  assert.equal(capturedUpdateArgs?.data?.isEnabled, false);
  assert.equal(capturedUpdateArgs?.data?.updatedBy, 'admin-user');
});
