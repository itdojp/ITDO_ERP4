import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import {
  normalizeReportSubscriptionSchedule,
  retryDueReportDeliveries,
  runReportSubscriptionById,
} from '../dist/application/reportSubscriptions/useCases.js';
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

test('normalizeReportSubscriptionSchedule preserves current cron-string semantics', () => {
  assert.equal(normalizeReportSubscriptionSchedule(undefined), undefined);
  assert.equal(normalizeReportSubscriptionSchedule(null), undefined);
  assert.equal(normalizeReportSubscriptionSchedule('   '), undefined);
  assert.equal(
    normalizeReportSubscriptionSchedule('  0 6 * * *  '),
    '0 6 * * *',
  );
  assert.equal(
    normalizeReportSubscriptionSchedule('*/15 9-17 * * 1-5'),
    '*/15 9-17 * * 1-5',
  );
  assert.throws(
    () => normalizeReportSubscriptionSchedule('@daily'),
    /Schedule must be a five-field cron expression/,
  );
  assert.throws(
    () => normalizeReportSubscriptionSchedule('0 6 * * * Asia/Tokyo'),
    /Schedule must be a five-field cron expression/,
  );
});

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

test('POST /jobs/report-subscriptions/run keeps cron-side schedule filtering semantics', async () => {
  let capturedFindManyArgs = null;
  await withPrismaStubs(
    {
      'reportSubscription.findMany': async (args) => {
        capturedFindManyArgs = args;
        return [];
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/jobs/report-subscriptions/run',
          headers: adminHeaders(),
          payload: {},
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body?.ok, true);
        assert.equal(body?.count, 0);
      });
    },
  );
  assert.deepEqual(capturedFindManyArgs, {
    where: { isEnabled: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
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
        const errorCode =
          typeof body?.error === 'string' ? body.error : body?.error?.code;
        assert.equal(errorCode, 'not_found');
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

test('POST /report-subscriptions/:id/run enqueues pending email delivery before immediate processing', async () => {
  const callOrder = [];
  let createdDeliveryData = null;
  let claimArgs = null;
  let updateArgs = null;
  let subscriptionUpdateArgs = null;
  await withEnv(
    {
      MAIL_TRANSPORT: 'stub',
      REPORT_STORAGE_DIR: '/tmp/erp4-report-tests',
    },
    async () => {
      await withPrismaStubs(
        {
          'reportSubscription.findUnique': async () => ({
            id: 'sub-1',
            reportKey: 'delivery-due',
            name: 'Delivery due',
            format: 'csv',
            params: {},
            recipients: { emails: ['ops@example.com'] },
            channels: ['email'],
            isEnabled: true,
          }),
          'projectMilestone.findMany': async () => [],
          'reportDelivery.create': async (args) => {
            callOrder.push('create');
            createdDeliveryData = args.data;
            return {
              id: 'delivery-1',
              subscriptionId: 'sub-1',
              channel: args.data.channel,
              status: args.data.status,
              target: args.data.target ?? null,
              payload: args.data.payload ?? null,
              retryCount: args.data.retryCount ?? 0,
              nextRetryAt: args.data.nextRetryAt ?? null,
            };
          },
          'reportDelivery.updateMany': async (args) => {
            callOrder.push('claim');
            claimArgs = args;
            return { count: 1 };
          },
          'reportDelivery.update': async (args) => {
            callOrder.push('update');
            updateArgs = args;
            return { id: args.where.id, ...args.data };
          },
          'reportSubscription.update': async (args) => {
            subscriptionUpdateArgs = args;
            return { id: args.where.id, ...args.data };
          },
        },
        async () => {
          await withServer(async (server) => {
            const res = await server.inject({
              method: 'POST',
              url: '/report-subscriptions/sub-1/run',
              headers: adminHeaders(),
              payload: {},
            });
            assert.equal(res.statusCode, 200, res.body);
            const body = JSON.parse(res.body);
            assert.equal(body?.deliveries?.length, 1);
            assert.equal(body?.deliveries?.[0]?.status, 'stub');
          });
        },
      );
    },
  );
  assert.equal(createdDeliveryData?.status, 'pending');
  assert.equal(createdDeliveryData?.target, 'ops@example.com');
  assert.equal(createdDeliveryData?.retryCount, 0);
  assert.equal(createdDeliveryData?.payload?.reportKey, 'delivery-due');
  assert.equal(claimArgs?.where?.status, 'pending');
  assert.equal(updateArgs?.data?.status, 'stub');
  assert.equal(updateArgs?.data?.retryCount, 0);
  assert.equal(subscriptionUpdateArgs?.data?.lastRunStatus, 'success');
  assert.deepEqual(callOrder, ['create', 'claim', 'update']);
});

test('POST /report-subscriptions/:id/run keeps lastRunStatus queued when pending delivery is not claimed', async () => {
  let subscriptionUpdateArgs = null;
  await withEnv(
    {
      MAIL_TRANSPORT: 'stub',
      REPORT_STORAGE_DIR: '/tmp/erp4-report-tests',
    },
    async () => {
      await withPrismaStubs(
        {
          'reportSubscription.findUnique': async () => ({
            id: 'sub-queued',
            reportKey: 'delivery-due',
            name: 'Delivery due',
            format: 'csv',
            params: {},
            recipients: { emails: ['ops@example.com'] },
            channels: ['email'],
            isEnabled: true,
          }),
          'projectMilestone.findMany': async () => [],
          'reportDelivery.create': async (args) => ({
            id: 'delivery-queued',
            subscriptionId: 'sub-queued',
            channel: args.data.channel,
            status: args.data.status,
            target: args.data.target ?? null,
            payload: args.data.payload ?? null,
            retryCount: args.data.retryCount ?? 0,
            nextRetryAt: args.data.nextRetryAt ?? null,
          }),
          'reportDelivery.updateMany': async () => ({ count: 0 }),
          'reportSubscription.update': async (args) => {
            subscriptionUpdateArgs = args;
            return { id: args.where.id, ...args.data };
          },
        },
        async () => {
          await withServer(async (server) => {
            const res = await server.inject({
              method: 'POST',
              url: '/report-subscriptions/sub-queued/run',
              headers: adminHeaders(),
              payload: {},
            });
            assert.equal(res.statusCode, 200, res.body);
            const body = JSON.parse(res.body);
            assert.equal(body?.deliveries?.length, 1);
            assert.equal(body?.deliveries?.[0]?.status, 'pending');
          });
        },
      );
    },
  );

  assert.equal(subscriptionUpdateArgs?.data?.lastRunStatus, 'queued');
});

test('POST /report-subscriptions/:id/run sets lastRunStatus partial when queued and failed deliveries coexist', async () => {
  let subscriptionUpdateArgs = null;
  const claimStatuses = [];
  await withEnv(
    {
      MAIL_TRANSPORT: 'stub',
      REPORT_STORAGE_DIR: '/tmp/erp4-report-tests',
    },
    async () => {
      await withPrismaStubs(
        {
          'reportSubscription.findUnique': async () => ({
            id: 'sub-partial',
            reportKey: 'delivery-due',
            name: 'Delivery due',
            format: 'csv',
            params: {},
            recipients: { emails: ['ops@example.com'] },
            channels: ['email', 'unknown-channel'],
            isEnabled: true,
          }),
          'projectMilestone.findMany': async () => [],
          'reportDelivery.create': async (args) => ({
            id: `delivery-${args.data.channel}`,
            subscriptionId: 'sub-partial',
            channel: args.data.channel,
            status: args.data.status,
            target: args.data.target ?? null,
            payload: args.data.payload ?? null,
            retryCount: args.data.retryCount ?? 0,
            nextRetryAt: args.data.nextRetryAt ?? null,
          }),
          'reportDelivery.updateMany': async (args) => {
            claimStatuses.push(args.where.status);
            return { count: 0 };
          },
          'reportSubscription.update': async (args) => {
            subscriptionUpdateArgs = args;
            return { id: args.where.id, ...args.data };
          },
        },
        async () => {
          await withServer(async (server) => {
            const res = await server.inject({
              method: 'POST',
              url: '/report-subscriptions/sub-partial/run',
              headers: adminHeaders(),
              payload: {},
            });
            assert.equal(res.statusCode, 200, res.body);
            const body = JSON.parse(res.body);
            assert.equal(body?.deliveries?.length, 2);
            assert.deepEqual(
              body?.deliveries?.map((item) => item.status),
              ['pending', 'failed_permanent'],
            );
          });
        },
      );
    },
  );

  assert.deepEqual(claimStatuses, ['pending']);
  assert.equal(subscriptionUpdateArgs?.data?.lastRunStatus, 'partial');
});

test('POST /jobs/report-deliveries/retry processes pending and failed deliveries', async () => {
  const findManyArgs = [];
  const claimStatuses = [];
  const updateCalls = [];
  await withEnv(
    {
      MAIL_TRANSPORT: 'stub',
      REPORT_STORAGE_DIR: '/tmp/erp4-report-tests',
      REPORT_DELIVERY_RETRY_MAX: '3',
      REPORT_DELIVERY_RETRY_BASE_MINUTES: '60',
    },
    async () => {
      await withPrismaStubs(
        {
          'reportDelivery.findMany': async (args) => {
            findManyArgs.push(args);
            if (args.where?.status === 'pending') {
              return [
                {
                  id: 'delivery-pending',
                  channel: 'email',
                  status: 'pending',
                  target: 'ops@example.com',
                  payload: {
                    reportKey: 'delivery-due',
                    name: 'Delivery due',
                    format: 'csv',
                    params: null,
                    generatedAt: '2026-03-07T00:00:00.000Z',
                    data: { items: [] },
                    csv: 'milestoneId\n',
                    csvFilename: 'delivery-due.csv',
                  },
                  retryCount: 0,
                  nextRetryAt: null,
                  createdAt: new Date('2026-03-07T00:00:00.000Z'),
                },
              ];
            }
            return [
              {
                id: 'delivery-failed',
                channel: 'email',
                status: 'failed',
                target: 'ops@example.com',
                payload: {
                  reportKey: 'delivery-due',
                  name: 'Delivery due',
                  format: 'csv',
                  params: null,
                  generatedAt: '2026-03-07T00:00:00.000Z',
                  data: { items: [] },
                  csv: 'milestoneId\n',
                  csvFilename: 'delivery-due.csv',
                },
                retryCount: 1,
                nextRetryAt: new Date('2026-03-06T23:00:00.000Z'),
                createdAt: new Date('2026-03-07T00:01:00.000Z'),
              },
            ];
          },
          'reportDelivery.updateMany': async (args) => {
            claimStatuses.push(args.where.status);
            return { count: 1 };
          },
          'reportDelivery.update': async (args) => {
            updateCalls.push(args);
            return { id: args.where.id, ...args.data };
          },
        },
        async () => {
          await withServer(async (server) => {
            const res = await server.inject({
              method: 'POST',
              url: '/jobs/report-deliveries/retry',
              headers: adminHeaders(),
              payload: {},
            });
            assert.equal(res.statusCode, 200, res.body);
            const body = JSON.parse(res.body);
            assert.equal(body?.count, 2);
            assert.deepEqual(
              body?.items?.map((item) => item.status),
              ['stub', 'stub'],
            );
          });
        },
      );
    },
  );
  assert.equal(findManyArgs.length, 2);
  assert.deepEqual(findManyArgs[0], {
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  assert.deepEqual(findManyArgs[1], {
    where: {
      status: 'failed',
      retryCount: { lt: 3 },
      nextRetryAt: { lte: findManyArgs[1].where.nextRetryAt.lte },
    },
    orderBy: [{ nextRetryAt: 'asc' }, { createdAt: 'asc' }],
    take: 99,
  });
  assert.deepEqual(claimStatuses, ['pending', 'failed']);
  assert.equal(updateCalls.length, 2);
  const pendingUpdate = updateCalls.find(
    (item) => item.where.id === 'delivery-pending',
  );
  const failedUpdate = updateCalls.find(
    (item) => item.where.id === 'delivery-failed',
  );
  assert.equal(pendingUpdate?.data?.status, 'stub');
  assert.equal(pendingUpdate?.data?.retryCount, 0);
  assert.equal(failedUpdate?.data?.status, 'stub');
  assert.equal(failedUpdate?.data?.retryCount, 2);
});

test('gdrive report output is stored once and reused for immediate email delivery', async () => {
  let content;
  const artifactId = '11111111-1111-4111-8111-111111111111';
  let storeCount = 0;
  let openCount = 0;
  let storedInput;
  let createdPayload;
  const storage = {
    store: async (input) => {
      storeCount += 1;
      storedInput = input;
      content = input.body;
      return {
        artifactId,
        contentType: input.contentType,
        createdAt: '2026-07-22T00:00:00.000Z',
        originalName: input.originalName,
        provider: 'gdrive',
        sha256: input.sha256,
        sizeBytes: input.sizeBytes,
      };
    },
    open: async (id, scope) => {
      openCount += 1;
      assert.equal(id, artifactId);
      assert.deepEqual(scope, {
        ownerId: 'sub-gdrive',
        ownerType: 'report_subscription',
      });
      return {
        artifact: {
          artifactId,
          contentType: 'text/csv; charset=utf-8',
          createdAt: '2026-07-22T00:00:00.000Z',
          originalName: 'delivery-due.csv',
          provider: 'gdrive',
          sha256: 'a'.repeat(64),
          sizeBytes: content.length,
        },
        stream: Readable.from(content),
      };
    },
  };

  await withEnv({ MAIL_TRANSPORT: 'stub', REPORT_PROVIDER: 'gdrive' }, () =>
    withPrismaStubs(
      {
        'reportSubscription.findUnique': async () => ({
          id: 'sub-gdrive',
          reportKey: 'delivery-due',
          name: 'Delivery due',
          format: 'csv',
          params: {},
          recipients: { emails: ['ops@example.com'] },
          channels: ['email'],
          isEnabled: true,
        }),
        'projectMilestone.findMany': async () => [],
        'reportDelivery.create': async ({ data }) => {
          createdPayload = data.payload;
          return {
            id: 'delivery-gdrive',
            channel: data.channel,
            status: data.status,
            payload: data.payload,
            target: data.target,
            retryCount: data.retryCount,
            nextRetryAt: data.nextRetryAt,
          };
        },
        'reportDelivery.updateMany': async () => ({ count: 1 }),
        'reportDelivery.update': async ({ where, data }) => ({
          id: where.id,
          ...data,
        }),
        'reportSubscription.update': async ({ where, data }) => ({
          id: where.id,
          ...data,
        }),
      },
      async () => {
        const result = await runReportSubscriptionById(
          'sub-gdrive',
          'operator-placeholder',
          false,
          {
            createStorage: () => storage,
            now: () => new Date('2026-07-22T00:00:00.000Z'),
          },
        );
        assert.equal(result.deliveries[0].status, 'stub');
      },
    ),
  );

  assert.equal(storeCount, 1);
  assert.equal(openCount, 1);
  assert.deepEqual(storedInput.body, content);
  assert.equal(storedInput.ownerId, 'sub-gdrive');
  assert.equal(storedInput.ownerType, 'report_subscription');
  assert.equal(createdPayload.artifact.artifactId, artifactId);
  assert.equal(createdPayload.artifact.url, `/report-outputs/${artifactId}`);
  assert.equal(
    JSON.stringify(createdPayload).includes('drive.google.com'),
    false,
  );
});

test('gdrive report dry-run performs no artifact or PDF write', async () => {
  let storageCalls = 0;
  let renderCalls = 0;
  let generateCalls = 0;
  await withEnv({ REPORT_PROVIDER: 'gdrive' }, () =>
    withPrismaStubs(
      {
        'reportSubscription.findUnique': async () => ({
          id: 'sub-dry-run',
          reportKey: 'delivery-due',
          name: 'Delivery due',
          format: 'pdf',
          params: {},
          recipients: { users: ['user-placeholder'] },
          channels: ['dashboard'],
          isEnabled: true,
        }),
        'projectMilestone.findMany': async () => [],
      },
      async () => {
        const result = await runReportSubscriptionById(
          'sub-dry-run',
          'operator-placeholder',
          true,
          {
            createStorage: () => {
              storageCalls += 1;
              throw new Error('storage_must_not_be_created');
            },
            generatePdf: async () => {
              generateCalls += 1;
              throw new Error('pdf_must_not_be_written');
            },
            now: () => new Date('2026-07-22T00:00:00.000Z'),
            renderPdfBuffer: async () => {
              renderCalls += 1;
              throw new Error('pdf_must_not_be_rendered');
            },
          },
        );
        assert.equal(result.deliveries.length, 0);
        assert.equal(result.payload.artifact, undefined);
        assert.match(result.payload.pdf.url, /^stub:\/\/pdf\//);
      },
    ),
  );
  assert.equal(storageCalls, 0);
  assert.equal(renderCalls, 0);
  assert.equal(generateCalls, 0);
});

test('gdrive PDF report renders to memory and persists a report artifact', async () => {
  const artifactId = '22222222-2222-4222-8222-222222222222';
  const pdfContent = Buffer.from('%PDF-report-placeholder', 'utf8');
  let storedInput;
  let generatedPdfCalls = 0;
  await withEnv({ REPORT_PROVIDER: 'gdrive', PDF_PROVIDER: 'local' }, () =>
    withPrismaStubs(
      {
        'reportSubscription.findUnique': async () => ({
          id: 'sub-pdf-gdrive',
          reportKey: 'delivery-due',
          name: 'Delivery due',
          format: 'pdf',
          params: {},
          recipients: { users: ['user-placeholder'] },
          channels: ['dashboard'],
          isEnabled: true,
        }),
        'projectMilestone.findMany': async () => [],
        'reportDelivery.create': async ({ data }) => ({
          id: 'delivery-pdf-gdrive',
          channel: data.channel,
          status: data.status,
          payload: data.payload,
          target: data.target,
          retryCount: data.retryCount ?? 0,
          nextRetryAt: data.nextRetryAt ?? null,
        }),
        'reportSubscription.update': async ({ where, data }) => ({
          id: where.id,
          ...data,
        }),
      },
      async () => {
        const result = await runReportSubscriptionById(
          'sub-pdf-gdrive',
          'operator-placeholder',
          false,
          {
            createStorage: () => ({
              store: async (input) => {
                storedInput = input;
                return {
                  artifactId,
                  contentType: input.contentType,
                  createdAt: '2026-07-22T00:00:00.000Z',
                  originalName: input.originalName,
                  provider: 'gdrive',
                  sha256: input.sha256,
                  sizeBytes: input.sizeBytes,
                };
              },
            }),
            generatePdf: async () => {
              generatedPdfCalls += 1;
              throw new Error('local_pdf_must_not_be_generated');
            },
            now: () => new Date('2026-07-22T00:00:00.000Z'),
            renderPdfBuffer: async () => pdfContent,
          },
        );
        assert.equal(result.payload.artifact.artifactId, artifactId);
        assert.equal(result.payload.pdf.filePath, undefined);
        assert.equal(result.payload.pdf.url, `/report-outputs/${artifactId}`);
      },
    ),
  );
  assert.equal(generatedPdfCalls, 0);
  assert.deepEqual(storedInput.body, pdfContent);
  assert.equal(storedInput.contentType, 'application/pdf');
  assert.equal(storedInput.ownerType, 'report_subscription');
});

test('gdrive report storage failure stops before delivery creation without local fallback', async () => {
  let deliveryCreates = 0;
  let failedRunStatus;
  await withEnv({ REPORT_PROVIDER: 'gdrive' }, () =>
    withPrismaStubs(
      {
        'reportSubscription.findUnique': async () => ({
          id: 'sub-gdrive-failure',
          reportKey: 'delivery-due',
          name: 'Delivery due',
          format: 'csv',
          params: {},
          recipients: { emails: ['ops@example.com'] },
          channels: ['email'],
          isEnabled: true,
        }),
        'projectMilestone.findMany': async () => [],
        'reportDelivery.create': async () => {
          deliveryCreates += 1;
        },
        'reportSubscription.update': async ({ data }) => {
          failedRunStatus = data.lastRunStatus;
          return data;
        },
      },
      async () => {
        await assert.rejects(
          runReportSubscriptionById(
            'sub-gdrive-failure',
            'operator-placeholder',
            false,
            {
              createStorage: () => ({
                store: async () => {
                  throw new Error('google_drive_quota');
                },
              }),
              now: () => new Date('2026-07-22T00:00:00.000Z'),
            },
          ),
          /google_drive_quota/,
        );
      },
    ),
  );
  assert.equal(deliveryCreates, 0);
  assert.equal(failedRunStatus, 'failed');
});

test('gdrive report retry reopens the same artifact and schedules retryable failures', async () => {
  const artifactId = '33333333-3333-4333-8333-333333333333';
  let updateData;
  let storageCreates = 0;
  let openCalls = 0;
  await withEnv(
    {
      REPORT_PROVIDER: 'gdrive',
      REPORT_DELIVERY_RETRY_MAX: '3',
      REPORT_DELIVERY_RETRY_BASE_MINUTES: '1',
    },
    () =>
      withPrismaStubs(
        {
          'reportDelivery.findMany': async (args) =>
            args.where?.status === 'pending'
              ? []
              : [
                  {
                    id: 'delivery-gdrive-retry',
                    channel: 'email',
                    status: 'failed',
                    target: 'ops@example.com',
                    payload: {
                      reportKey: 'delivery-due',
                      name: 'Delivery due',
                      format: 'csv',
                      params: null,
                      generatedAt: '2026-07-22T00:00:00.000Z',
                      data: { items: [] },
                      artifact: {
                        artifactId,
                        contentType: 'text/csv; charset=utf-8',
                        filename: 'delivery-due.csv',
                        ownerId: 'sub-gdrive-retry',
                        ownerType: 'report_subscription',
                        provider: 'gdrive',
                        url: `/report-outputs/${artifactId}`,
                      },
                    },
                    retryCount: 1,
                    nextRetryAt: new Date('2026-07-21T23:00:00.000Z'),
                    createdAt: new Date('2026-07-21T22:00:00.000Z'),
                  },
                ],
          'reportDelivery.updateMany': async () => ({ count: 1 }),
          'reportDelivery.update': async ({ where, data }) => {
            updateData = data;
            return { id: where.id, ...data };
          },
        },
        async () => {
          const result = await retryDueReportDeliveries(false, {
            createStorage: () => {
              storageCreates += 1;
              return {
                open: async (id) => {
                  openCalls += 1;
                  assert.equal(id, artifactId);
                  const error = new Error('google_drive_timeout');
                  error.retryable = true;
                  throw error;
                },
              };
            },
          });
          assert.equal(result.items[0].status, 'failed');
        },
      ),
  );
  assert.equal(storageCreates, 1);
  assert.equal(openCalls, 1);
  assert.equal(updateData.status, 'failed');
  assert.equal(updateData.retryCount, 2);
  assert.ok(updateData.nextRetryAt instanceof Date);
});
