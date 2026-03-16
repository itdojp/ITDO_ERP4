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

test('GET /integrations/jobs/exports merges export logs across adapters', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'leaveIntegrationExportLog.findMany': async () => [
        {
          id: 'leave-log-001',
          target: 'attendance',
          idempotencyKey: 'leave-key-001',
          status: 'success',
          updatedSince: new Date('2026-03-01T00:00:00.000Z'),
          exportedUntil: new Date('2026-03-14T00:00:00.000Z'),
          exportedCount: 3,
          startedAt: new Date('2026-03-14T09:00:00.000Z'),
          finishedAt: new Date('2026-03-14T09:01:00.000Z'),
          message: 'exported',
        },
      ],
      'hrEmployeeMasterExportLog.findMany': async () => [
        {
          id: 'employee-log-001',
          idempotencyKey: 'employee-key-001',
          status: 'failed',
          updatedSince: null,
          exportedUntil: new Date('2026-03-15T00:00:00.000Z'),
          exportedCount: 0,
          startedAt: new Date('2026-03-15T10:00:00.000Z'),
          finishedAt: new Date('2026-03-15T10:02:00.000Z'),
          message: 'employee_master_employee_code_missing',
        },
      ],
      'accountingIcsExportLog.findMany': async () => [
        {
          id: 'accounting-log-001',
          idempotencyKey: 'accounting-key-001',
          periodKey: '2026-03',
          status: 'running',
          exportedUntil: new Date('2026-03-16T00:00:00.000Z'),
          exportedCount: 1,
          startedAt: new Date('2026-03-16T11:00:00.000Z'),
          finishedAt: null,
          message: null,
        },
      ],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/jobs/exports?limit=10&offset=0',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.items.length, 3);
        assert.deepEqual(
          body.items.map((item) => item.kind),
          [
            'accounting_ics_export',
            'hr_employee_master_export',
            'hr_leave_export_attendance',
          ],
        );
        assert.equal(body.items[0].scope.periodKey, '2026-03');
        assert.equal(body.items[1].scope.updatedSince, null);
        assert.equal(body.items[2].scope.target, 'attendance');
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/jobs/exports applies kind and status filters to the relevant adapter', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let employeeMasterArgs = null;
  let leaveCalled = false;
  let accountingCalled = false;
  await withPrismaStubs(
    {
      'leaveIntegrationExportLog.findMany': async () => {
        leaveCalled = true;
        return [];
      },
      'hrEmployeeMasterExportLog.findMany': async (args) => {
        employeeMasterArgs = args;
        return [
          {
            id: 'employee-log-002',
            idempotencyKey: 'employee-key-002',
            status: 'success',
            updatedSince: new Date('2026-03-10T00:00:00.000Z'),
            exportedUntil: new Date('2026-03-16T00:00:00.000Z'),
            exportedCount: 12,
            startedAt: new Date('2026-03-16T12:00:00.000Z'),
            finishedAt: new Date('2026-03-16T12:01:00.000Z'),
            message: 'exported',
          },
        ];
      },
      'accountingIcsExportLog.findMany': async () => {
        accountingCalled = true;
        return [];
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/jobs/exports?kind=hr_employee_master_export&status=success&limit=5&offset=0',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.items.length, 1);
        assert.equal(body.items[0].kind, 'hr_employee_master_export');
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(leaveCalled, false);
  assert.equal(accountingCalled, false);
  assert.deepEqual(employeeMasterArgs?.where, { status: 'success' });
  assert.equal(employeeMasterArgs?.take, 5);
});

test('GET /integrations/jobs/exports fetches offset + limit rows per source for merged pagination', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let employeeMasterArgs = null;
  await withPrismaStubs(
    {
      'leaveIntegrationExportLog.findMany': async () => [],
      'hrEmployeeMasterExportLog.findMany': async (args) => {
        employeeMasterArgs = args;
        return [];
      },
      'accountingIcsExportLog.findMany': async () => [],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/jobs/exports?kind=hr_employee_master_export&limit=100&offset=450',
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

  assert.equal(employeeMasterArgs?.take, 550);
});
