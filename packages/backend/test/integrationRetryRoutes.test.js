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

test('POST /jobs/integrations/run retries eligible failed runs and skips over-limit runs', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const retryEligibleRun = {
    id: 'run-retry-eligible',
    settingId: 'setting-crm-1',
    status: 'failed',
    retryCount: 0,
    nextRetryAt: new Date('2026-02-23T18:00:00.000Z'),
    setting: {
      id: 'setting-crm-1',
      type: 'crm',
      config: { retryMax: 2, retryBaseMinutes: 5 },
    },
  };
  const overLimitRun = {
    id: 'run-retry-over-limit',
    settingId: 'setting-crm-2',
    status: 'failed',
    retryCount: 2,
    nextRetryAt: new Date('2026-02-23T18:00:00.000Z'),
    setting: {
      id: 'setting-crm-2',
      type: 'crm',
      config: { retryMax: 2, retryBaseMinutes: 5 },
    },
  };

  const integrationRunUpdateCalls = [];
  const integrationSettingUpdateCalls = [];

  await withPrismaStubs(
    {
      'integrationRun.findMany': async () => [retryEligibleRun, overLimitRun],
      'integrationRun.update': async (args) => {
        integrationRunUpdateCalls.push(args);
        const data = args?.data || {};
        return {
          id: args?.where?.id,
          status: data.status || 'running',
          retryCount: data.retryCount ?? 0,
        };
      },
      'integrationSetting.findMany': async () => [],
      'integrationSetting.update': async (args) => {
        integrationSettingUpdateCalls.push(args);
        return { id: args?.where?.id };
      },
      'customer.count': async () => 3,
      'vendor.count': async () => 2,
      'contact.count': async () => 1,
      'alertSetting.findMany': async () => [],
      'alert.updateMany': async () => ({ count: 0 }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/jobs/integrations/run',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.ok, true);
        assert.equal(body.retryCount, 1);
        assert.equal(body.scheduledCount, 0);
        assert.deepEqual(body.retries, [
          { id: retryEligibleRun.id, status: 'success' },
        ]);
      } finally {
        await server.close();
      }
    },
  );

  const retryRunIds = new Set(
    integrationRunUpdateCalls.map((call) => String(call?.where?.id ?? '')),
  );
  assert.equal(retryRunIds.has(retryEligibleRun.id), true);
  assert.equal(retryRunIds.has(overLimitRun.id), false);

  const eligibleStatusUpdates = integrationRunUpdateCalls
    .filter((call) => call?.where?.id === retryEligibleRun.id)
    .map((call) => String(call?.data?.status ?? ''));
  assert.deepEqual(eligibleStatusUpdates, ['running', 'success']);
  assert.equal(integrationSettingUpdateCalls.length, 1);
  assert.equal(integrationSettingUpdateCalls[0]?.where?.id, 'setting-crm-1');
});

test('POST /integration-settings/:id/run sets retry metadata with exponential backoff on failure', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const setting = {
    id: 'setting-failed-run',
    type: 'crm',
    status: 'active',
    config: {
      simulateFailure: true,
      retryMax: 3,
      retryBaseMinutes: 5,
    },
  };

  let failedUpdateCall = null;

  await withPrismaStubs(
    {
      'integrationSetting.findUnique': async () => setting,
      'integrationRun.create': async () => ({
        id: 'run-failed-once',
        retryCount: 0,
      }),
      'integrationRun.update': async (args) => {
        failedUpdateCall = args;
        return {
          id: 'run-failed-once',
          status: args?.data?.status,
          retryCount: args?.data?.retryCount ?? 0,
          nextRetryAt: args?.data?.nextRetryAt ?? null,
          message: args?.data?.message ?? null,
        };
      },
      'integrationSetting.update': async () => ({ id: setting.id }),
      'alertSetting.findMany': async () => [],
      'alert.updateMany': async () => ({ count: 0 }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      const before = Date.now();
      try {
        const res = await server.inject({
          method: 'POST',
          url: `/integration-settings/${encodeURIComponent(setting.id)}/run`,
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.status, 'failed');
        assert.equal(body.retryCount, 1);
        assert.equal(body.message, 'simulate_failure');
        assert.equal(typeof body.nextRetryAt, 'string');
        const nextRetryMs = new Date(body.nextRetryAt).getTime();
        const expectedMs = 5 * 60 * 1000;
        // Allow small timing jitter around request execution time.
        assert.ok(nextRetryMs >= before + expectedMs - 2000);
        assert.ok(nextRetryMs <= Date.now() + expectedMs + 2000);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(String(failedUpdateCall?.data?.status ?? ''), 'failed');
  assert.equal(Number(failedUpdateCall?.data?.retryCount ?? 0), 1);
  assert.ok(failedUpdateCall?.data?.nextRetryAt instanceof Date);
});

test('POST /integration-settings/:id/run returns 409 when setting is disabled', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'integrationSetting.findUnique': async () => ({
        id: 'setting-disabled',
        status: 'disabled',
        type: 'crm',
        config: {},
      }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integration-settings/setting-disabled/run',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        const errorCode =
          typeof body.error === 'string' ? body.error : body?.error?.code;
        assert.equal(String(errorCode ?? ''), 'disabled');
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integration-runs/metrics aggregates status, duration, reasons and type breakdown', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'integrationRun.findMany': async () => [
        {
          id: 'run-success-crm',
          status: 'success',
          startedAt: new Date('2026-02-23T10:00:00.000Z'),
          finishedAt: new Date('2026-02-23T10:00:10.000Z'),
          nextRetryAt: null,
          message: null,
          setting: { id: 'setting-crm', type: 'crm', name: 'CRM' },
        },
        {
          id: 'run-failed-crm',
          status: 'failed',
          startedAt: new Date('2026-02-23T10:10:00.000Z'),
          finishedAt: new Date('2026-02-23T10:10:30.000Z'),
          nextRetryAt: new Date('2026-02-23T11:10:00.000Z'),
          message: 'timeout',
          setting: { id: 'setting-crm', type: 'crm', name: 'CRM' },
        },
        {
          id: 'run-running-hr',
          status: 'running',
          startedAt: new Date('2026-02-23T10:20:00.000Z'),
          finishedAt: null,
          nextRetryAt: null,
          message: null,
          setting: { id: 'setting-hr', type: 'hr', name: 'HR' },
        },
        {
          id: 'run-failed-hr',
          status: 'failed',
          startedAt: new Date('2026-02-23T10:30:00.000Z'),
          finishedAt: new Date('2026-02-23T10:30:05.000Z'),
          nextRetryAt: null,
          message: 'timeout',
          setting: { id: 'setting-hr', type: 'hr', name: 'HR' },
        },
      ],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integration-runs/metrics?days=30&limit=100',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.summary.totalRuns, 4);
        assert.equal(body.summary.successRuns, 1);
        assert.equal(body.summary.failedRuns, 2);
        assert.equal(body.summary.runningRuns, 1);
        assert.equal(body.summary.retryScheduledRuns, 1);
        assert.equal(body.summary.successRate, 25);
        assert.equal(body.summary.avgDurationMs, 15000);
        assert.equal(body.summary.p95DurationMs, 30000);
        assert.deepEqual(body.failureReasons, [{ reason: 'timeout', count: 2 }]);
        assert.deepEqual(body.byType, [
          {
            type: 'crm',
            totalRuns: 2,
            successRuns: 1,
            failedRuns: 1,
            runningRuns: 0,
            successRate: 50,
          },
          {
            type: 'hr',
            totalRuns: 2,
            successRuns: 0,
            failedRuns: 1,
            runningRuns: 1,
            successRate: 0,
          },
        ]);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integration-runs/metrics forwards settingId filter and validates role', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let capturedFindManyArgs = null;
  await withPrismaStubs(
    {
      'integrationRun.findMany': async (args) => {
        capturedFindManyArgs = args;
        return [];
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const forbidden = await server.inject({
          method: 'GET',
          url: '/integration-runs/metrics?settingId=setting-filtered',
          headers: {
            'x-user-id': 'normal-user',
            'x-roles': 'user',
          },
        });
        assert.equal(forbidden.statusCode, 403, forbidden.body);

        const res = await server.inject({
          method: 'GET',
          url: '/integration-runs/metrics?settingId=setting-filtered&days=7',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(capturedFindManyArgs?.where?.settingId, 'setting-filtered');
});
