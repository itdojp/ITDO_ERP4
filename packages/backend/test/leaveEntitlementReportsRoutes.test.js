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

function headers(options = {}) {
  const base = {
    'x-user-id': 'ga-user',
    'x-roles': 'admin',
  };
  if (
    Array.isArray(options.groupAccountIds) &&
    options.groupAccountIds.length > 0
  ) {
    base['x-group-account-ids'] = options.groupAccountIds.join(',');
  }
  return base;
}

test('GET /leave-entitlements/hr-summary requires general_affairs group', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs({}, async () => {
    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method: 'GET',
        url: '/leave-entitlements/hr-summary',
        headers: headers(),
      });
      assert.equal(res.statusCode, 403, res.body);
      const body = JSON.parse(res.body);
      assert.equal(body?.error?.code, 'GENERAL_AFFAIRS_REQUIRED');
    } finally {
      await server.close();
    }
  });
});

test('GET /leave-entitlements/hr-summary returns stale pending and expiring metrics', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const leaveRequestCountCalls = [];
  await withPrismaStubs(
    {
      'leaveRequest.count': async (args) => {
        leaveRequestCountCalls.push(args);
        return args?.where?.createdAt ? 2 : 5;
      },
      'leaveRequest.findMany': async () => [
        {
          id: 'leave-pending-001',
          userId: 'user-001',
          leaveType: 'paid',
          startDate: new Date('2026-02-10T00:00:00.000Z'),
          endDate: new Date('2026-02-10T00:00:00.000Z'),
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      ],
      'leaveGrant.findMany': async () => [
        {
          id: 'grant-001',
          userId: 'user-001',
          grantDate: new Date('2025-10-01T00:00:00.000Z'),
          expiresAt: new Date('2026-03-15T00:00:00.000Z'),
          grantedMinutes: 480,
        },
      ],
      'leaveCompGrant.findMany': async () => [
        {
          id: 'comp-grant-001',
          userId: 'user-002',
          leaveType: 'compensatory',
          grantDate: new Date('2026-01-10T00:00:00.000Z'),
          expiresAt: new Date('2026-03-10T00:00:00.000Z'),
          remainingMinutes: 120,
        },
      ],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/leave-entitlements/hr-summary?asOfDate=2026-03-01&staleDays=14&expiringWithinDays=60&limit=10',
          headers: headers({ groupAccountIds: ['general_affairs'] }),
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.pending.total, 5);
        assert.equal(body.pending.stale, 2);
        assert.equal(body.pending.staleItems.length, 1);
        assert.equal(body.expiring.paidGrantCount, 1);
        assert.equal(body.expiring.paidGrantUpperBoundMinutes, 480);
        assert.equal(body.expiring.compGrantCount, 1);
        assert.equal(body.expiring.compGrantRemainingMinutes, 120);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(leaveRequestCountCalls.length >= 2, true);
});

test('GET /leave-entitlements/hr-ledger supports csv export', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let leaveGrantCallCount = 0;
  await withPrismaStubs(
    {
      'leaveGrant.findMany': async (args) => {
        leaveGrantCallCount += 1;
        if (args?.where?.grantDate) {
          return [
            {
              id: 'grant-010',
              userId: 'user-010',
              grantDate: new Date('2026-02-01T00:00:00.000Z'),
              expiresAt: new Date('2026-12-31T00:00:00.000Z'),
              grantedMinutes: 480,
              reasonText: 'regular grant',
            },
          ];
        }
        return [
          {
            id: 'grant-011',
            userId: 'user-010',
            expiresAt: new Date('2026-02-20T00:00:00.000Z'),
            grantedMinutes: 120,
          },
        ];
      },
      'leaveRequest.findMany': async () => [
        {
          id: 'leave-010',
          userId: 'user-010',
          leaveType: 'paid',
          startDate: new Date('2026-02-15T00:00:00.000Z'),
          endDate: new Date('2026-02-15T00:00:00.000Z'),
          hours: null,
          minutes: 120,
          startTimeMinutes: 540,
          endTimeMinutes: 660,
          notes: 'private',
        },
      ],
      'leaveSetting.upsert': async () => ({
        id: 'default',
        defaultWorkdayMinutes: 480,
      }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/leave-entitlements/hr-ledger?from=2026-02-01&to=2026-02-28&format=csv&limit=100',
          headers: headers({ groupAccountIds: ['general_affairs'] }),
        });
        assert.equal(res.statusCode, 200, res.body);
        assert.match(
          String(res.headers['content-type'] || ''),
          /text\/csv/i,
          'content-type should be csv',
        );
        assert.match(res.body, /eventDate,userId,eventType,direction,minutes/);
        assert.match(res.body, /grant/);
        assert.match(res.body, /usage/);
        assert.match(res.body, /expiry_scheduled/);
        assert.match(res.body, /upper_bound_debit/);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(leaveGrantCallCount, 2);
});

test('GET /leave-entitlements/hr-ledger rejects too-wide date range', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs({}, async () => {
    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method: 'GET',
        url: '/leave-entitlements/hr-ledger?from=2025-01-01&to=2026-06-01',
        headers: headers({ groupAccountIds: ['general_affairs'] }),
      });
      assert.equal(res.statusCode, 400, res.body);
      const body = JSON.parse(res.body);
      assert.equal(body?.error?.code, 'INVALID_DATE_RANGE');
    } finally {
      await server.close();
    }
  });
});
