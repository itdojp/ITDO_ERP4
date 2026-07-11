import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@prisma/client';

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
          reexportOfId: null,
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
          reexportOfId: 'employee-log-000',
          status: 'failed',
          updatedSince: null,
          exportedUntil: new Date('2026-03-15T00:00:00.000Z'),
          exportedCount: 0,
          startedAt: new Date('2026-03-15T10:00:00.000Z'),
          finishedAt: new Date('2026-03-15T10:02:00.000Z'),
          message: 'employee_master_employee_code_missing',
        },
      ],
      'hrAttendanceExportLog.findMany': async () => [
        {
          id: 'attendance-log-001',
          idempotencyKey: 'attendance-key-001',
          reexportOfId: null,
          periodKey: '2026-03',
          closingPeriodId: 'attendance-close-001',
          closingVersion: 4,
          status: 'success',
          exportedUntil: new Date('2026-03-15T11:00:00.000Z'),
          exportedCount: 8,
          startedAt: new Date('2026-03-15T11:00:00.000Z'),
          finishedAt: new Date('2026-03-15T11:01:00.000Z'),
          message: 'exported',
        },
      ],
      'accountingIcsExportLog.findMany': async () => [
        {
          id: 'accounting-log-001',
          idempotencyKey: 'accounting-key-001',
          reexportOfId: null,
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
        assert.equal(body.items.length, 4);
        assert.deepEqual(
          body.items.map((item) => item.kind),
          [
            'accounting_ics_export',
            'hr_attendance_export',
            'hr_employee_master_export',
            'hr_leave_export_attendance',
          ],
        );
        assert.equal(body.items[0].scope.periodKey, '2026-03');
        assert.equal(body.items[1].scope.periodKey, '2026-03');
        assert.equal(body.items[1].scope.closingVersion, 4);
        assert.equal(
          body.items[1].scope.closingPeriodId,
          'attendance-close-001',
        );
        assert.equal(body.items[2].scope.updatedSince, null);
        assert.equal(body.items[2].reexportOfId, 'employee-log-000');
        assert.equal(body.items[3].scope.target, 'attendance');
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
  let hrAttendanceCalled = false;
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
      'hrAttendanceExportLog.findMany': async () => {
        hrAttendanceCalled = true;
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
  assert.equal(hrAttendanceCalled, false);
  assert.equal(accountingCalled, false);
  assert.deepEqual(employeeMasterArgs?.where, { status: 'success' });
  assert.equal(employeeMasterArgs?.take, 5);
});

test('GET /integrations/jobs/exports applies kind and status filters to HR attendance exports', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let hrAttendanceArgs = null;
  let leaveCalled = false;
  let employeeCalled = false;
  let accountingCalled = false;
  await withPrismaStubs(
    {
      'leaveIntegrationExportLog.findMany': async () => {
        leaveCalled = true;
        return [];
      },
      'hrEmployeeMasterExportLog.findMany': async () => {
        employeeCalled = true;
        return [];
      },
      'hrAttendanceExportLog.findMany': async (args) => {
        hrAttendanceArgs = args;
        return [
          {
            id: 'attendance-log-002',
            idempotencyKey: 'attendance-key-002',
            reexportOfId: null,
            periodKey: '2026-03',
            closingPeriodId: 'attendance-close-002',
            closingVersion: 2,
            status: 'success',
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
          url: '/integrations/jobs/exports?kind=hr_attendance_export&status=success&limit=5&offset=0',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.items.length, 1);
        assert.equal(body.items[0].kind, 'hr_attendance_export');
        assert.equal(body.items[0].scope.periodKey, '2026-03');
        assert.equal(body.items[0].scope.closingVersion, 2);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(leaveCalled, false);
  assert.equal(employeeCalled, false);
  assert.equal(accountingCalled, false);
  assert.deepEqual(hrAttendanceArgs?.where, { status: 'success' });
  assert.equal(hrAttendanceArgs?.take, 5);
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
      'hrAttendanceExportLog.findMany': async () => [],
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

test('POST /integrations/jobs/exports/:kind/:id/redispatch creates a linked employee master rerun', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const payload = {
    schemaVersion: 'rakuda-employee-master.v1',
    exportedAt: '2026-03-16T00:00:00.000Z',
    exportedUntil: '2026-03-16T00:00:00.000Z',
    updatedSince: null,
    limit: 100,
    offset: 0,
    exportedCount: 1,
    headers: ['employeeCode'],
    items: [{ employeeCode: 'EMP-001' }],
  };
  let createArgs = null;

  await withPrismaStubs(
    {
      'hrEmployeeMasterExportLog.findUnique': async (args) => {
        if (args?.where?.id === 'employee-log-source') {
          return {
            id: 'employee-log-source',
            idempotencyKey: 'employee-source-key',
            requestHash: 'employee-request-hash',
            reexportOfId: null,
            updatedSince: null,
            exportedUntil: new Date('2026-03-16T00:00:00.000Z'),
            status: 'success',
            exportedCount: 1,
            payload,
            message: 'exported',
            startedAt: new Date('2026-03-16T00:00:00.000Z'),
            finishedAt: new Date('2026-03-16T00:00:05.000Z'),
          };
        }
        if (args?.where?.idempotencyKey === 'employee-redispatch-key') {
          return null;
        }
        return null;
      },
      'auditLog.create': async () => ({ id: 'audit-employee-created' }),
      'hrEmployeeMasterExportLog.create': async (args) => {
        createArgs = args;
        return {
          id: 'employee-log-rerun',
          idempotencyKey: args.data.idempotencyKey,
          requestHash: args.data.requestHash,
          reexportOfId: args.data.reexportOfId,
          updatedSince: args.data.updatedSince,
          exportedUntil: args.data.exportedUntil,
          status: args.data.status,
          exportedCount: args.data.exportedCount,
          payload: args.data.payload,
          message: args.data.message,
          startedAt: args.data.startedAt,
          finishedAt: args.data.finishedAt,
        };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/jobs/exports/hr_employee_master_export/employee-log-source/redispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            idempotencyKey: 'employee-redispatch-key',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.replayed, false);
        assert.equal(body.log.id, 'employee-log-rerun');
        assert.equal(body.log.reexportOfId, 'employee-log-source');
        assert.deepEqual(body.payload, payload);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(createArgs?.data?.reexportOfId, 'employee-log-source');
  assert.equal(createArgs?.data?.message, 'redispatched');
});

test('POST /integrations/jobs/exports/:kind/:id/redispatch creates a linked HR attendance rerun', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const payload = {
    schemaVersion: 'rakuda_attendance_v1',
    exportedAt: '2026-03-17T00:00:00.000Z',
    exportedUntil: '2026-03-17T00:00:00.000Z',
    periodKey: '2026-03',
    closingId: 'attendance-close-source',
    closingVersion: 4,
    exportedCount: 1,
    headers: ['employeeCode'],
    items: [{ employeeCode: 'EMP-001' }],
  };
  let createArgs = null;

  await withPrismaStubs(
    {
      'hrAttendanceExportLog.findUnique': async (args) => {
        if (args?.where?.id === 'attendance-log-source') {
          return {
            id: 'attendance-log-source',
            idempotencyKey: 'attendance-source-key',
            requestHash: 'attendance-request-hash',
            reexportOfId: null,
            periodKey: '2026-03',
            closingPeriodId: 'attendance-close-source',
            closingVersion: 4,
            exportedUntil: new Date('2026-03-17T00:00:00.000Z'),
            status: 'success',
            exportedCount: 1,
            payload,
            message: 'exported',
            startedAt: new Date('2026-03-17T00:00:00.000Z'),
            finishedAt: new Date('2026-03-17T00:00:05.000Z'),
          };
        }
        if (args?.where?.idempotencyKey === 'attendance-redispatch-key') {
          return null;
        }
        return null;
      },
      'auditLog.create': async () => ({ id: 'audit-attendance-created' }),
      'hrAttendanceExportLog.create': async (args) => {
        createArgs = args;
        return {
          id: 'attendance-log-rerun',
          idempotencyKey: args.data.idempotencyKey,
          requestHash: args.data.requestHash,
          reexportOfId: args.data.reexportOfId,
          periodKey: args.data.periodKey,
          closingPeriodId: args.data.closingPeriodId,
          closingVersion: args.data.closingVersion,
          exportedUntil: args.data.exportedUntil,
          status: args.data.status,
          exportedCount: args.data.exportedCount,
          payload: args.data.payload,
          message: args.data.message,
          startedAt: args.data.startedAt,
          finishedAt: args.data.finishedAt,
        };
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/jobs/exports/hr_attendance_export/attendance-log-source/redispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            idempotencyKey: 'attendance-redispatch-key',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.replayed, false);
        assert.equal(body.log.id, 'attendance-log-rerun');
        assert.equal(body.log.reexportOfId, 'attendance-log-source');
        assert.equal(body.log.periodKey, '2026-03');
        assert.equal(body.log.closingVersion, 4);
        assert.deepEqual(body.payload, payload);
      } finally {
        await server.close();
      }
    },
  );

  assert.equal(createArgs?.data?.reexportOfId, 'attendance-log-source');
  assert.equal(createArgs?.data?.periodKey, '2026-03');
  assert.equal(createArgs?.data?.closingPeriodId, 'attendance-close-source');
  assert.equal(createArgs?.data?.closingVersion, 4);
  assert.equal(createArgs?.data?.message, 'redispatched');
});

test('POST /integrations/jobs/exports/:kind/:id/redispatch handles leave redispatch create races as replay', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let findUniqueCalls = 0;
  await withPrismaStubs(
    {
      'leaveIntegrationExportLog.findUnique': async (args) => {
        if (args?.where?.id === 'leave-log-source') {
          return {
            id: 'leave-log-source',
            target: 'attendance',
            idempotencyKey: 'leave-source-key',
            requestHash: 'leave-request-hash',
            reexportOfId: null,
            updatedSince: new Date('2026-03-01T00:00:00.000Z'),
            exportedUntil: new Date('2026-03-15T00:00:00.000Z'),
            status: 'success',
            exportedCount: 2,
            payload: { exportedCount: 2, items: [] },
            message: 'exported',
            startedAt: new Date('2026-03-15T00:00:00.000Z'),
            finishedAt: new Date('2026-03-15T00:00:10.000Z'),
          };
        }
        if (
          args?.where?.target_idempotencyKey?.target === 'attendance' &&
          args?.where?.target_idempotencyKey?.idempotencyKey ===
            'leave-redispatch-race-key'
        ) {
          findUniqueCalls += 1;
          if (findUniqueCalls === 1) {
            return null;
          }
          return {
            id: 'leave-log-rerun',
            target: 'attendance',
            idempotencyKey: 'leave-redispatch-race-key',
            requestHash: 'leave-request-hash',
            reexportOfId: 'leave-log-source',
            updatedSince: new Date('2026-03-01T00:00:00.000Z'),
            exportedUntil: new Date('2026-03-15T00:00:00.000Z'),
            status: 'running',
            exportedCount: 2,
            payload: { exportedCount: 2, items: [] },
            message: 'redispatched',
            startedAt: new Date('2026-03-16T00:00:00.000Z'),
            finishedAt: null,
          };
        }
        return null;
      },
      'leaveIntegrationExportLog.create': async () => {
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`target`,`idempotencyKey`)',
          { code: 'P2002', clientVersion: 'test' },
        );
      },
      'auditLog.create': async () => ({ id: 'audit-leave-race' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/jobs/exports/hr_leave_export_attendance/leave-log-source/redispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            idempotencyKey: 'leave-redispatch-race-key',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        assert.deepEqual(JSON.parse(res.body), {
          error: 'dispatch_in_progress',
          logId: 'leave-log-rerun',
        });
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /integrations/jobs/exports/:kind/:id/redispatch replays existing leave rerun with same idempotency key', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'leaveIntegrationExportLog.findUnique': async (args) => {
        if (args?.where?.id === 'leave-log-source') {
          return {
            id: 'leave-log-source',
            target: 'attendance',
            idempotencyKey: 'leave-source-key',
            requestHash: 'leave-request-hash',
            reexportOfId: null,
            updatedSince: new Date('2026-03-01T00:00:00.000Z'),
            exportedUntil: new Date('2026-03-15T00:00:00.000Z'),
            status: 'success',
            exportedCount: 2,
            payload: { exportedCount: 2, items: [] },
            message: 'exported',
            startedAt: new Date('2026-03-15T00:00:00.000Z'),
            finishedAt: new Date('2026-03-15T00:00:10.000Z'),
          };
        }
        if (
          args?.where?.target_idempotencyKey?.target === 'attendance' &&
          args?.where?.target_idempotencyKey?.idempotencyKey ===
            'leave-redispatch-key'
        ) {
          return {
            id: 'leave-log-rerun',
            target: 'attendance',
            idempotencyKey: 'leave-redispatch-key',
            requestHash: 'leave-request-hash',
            reexportOfId: 'leave-log-source',
            updatedSince: new Date('2026-03-01T00:00:00.000Z'),
            exportedUntil: new Date('2026-03-15T00:00:00.000Z'),
            status: 'success',
            exportedCount: 2,
            payload: { exportedCount: 2, items: [] },
            message: 'redispatched',
            startedAt: new Date('2026-03-16T00:00:00.000Z'),
            finishedAt: new Date('2026-03-16T00:00:01.000Z'),
          };
        }
        return null;
      },
      'auditLog.create': async () => ({ id: 'audit-leave-replay' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/jobs/exports/hr_leave_export_attendance/leave-log-source/redispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            idempotencyKey: 'leave-redispatch-key',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.replayed, true);
        assert.equal(body.log.reexportOfId, 'leave-log-source');
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /integrations/jobs/exports/:kind/:id/redispatch handles employee master redispatch create races as replay', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let findUniqueCalls = 0;
  await withPrismaStubs(
    {
      'hrEmployeeMasterExportLog.findUnique': async (args) => {
        if (args?.where?.id === 'employee-log-source') {
          return {
            id: 'employee-log-source',
            idempotencyKey: 'employee-source-key',
            requestHash: 'employee-request-hash',
            reexportOfId: null,
            updatedSince: null,
            exportedUntil: new Date('2026-03-16T00:00:00.000Z'),
            status: 'success',
            exportedCount: 1,
            payload: { exportedCount: 1, items: [{ employeeCode: 'EMP-001' }] },
            message: 'exported',
            startedAt: new Date('2026-03-16T00:00:00.000Z'),
            finishedAt: new Date('2026-03-16T00:00:05.000Z'),
          };
        }
        if (args?.where?.idempotencyKey === 'employee-redispatch-race-key') {
          findUniqueCalls += 1;
          if (findUniqueCalls === 1) {
            return null;
          }
          return {
            id: 'employee-log-rerun',
            idempotencyKey: 'employee-redispatch-race-key',
            requestHash: 'employee-request-hash',
            reexportOfId: 'employee-log-source',
            updatedSince: null,
            exportedUntil: new Date('2026-03-16T00:00:00.000Z'),
            status: 'running',
            exportedCount: 1,
            payload: { exportedCount: 1, items: [{ employeeCode: 'EMP-001' }] },
            message: 'redispatched',
            startedAt: new Date('2026-03-16T00:00:06.000Z'),
            finishedAt: null,
          };
        }
        return null;
      },
      'hrEmployeeMasterExportLog.create': async () => {
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`idempotencyKey`)',
          { code: 'P2002', clientVersion: 'test' },
        );
      },
      'auditLog.create': async () => ({ id: 'audit-employee-race' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/jobs/exports/hr_employee_master_export/employee-log-source/redispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            idempotencyKey: 'employee-redispatch-race-key',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        assert.deepEqual(JSON.parse(res.body), {
          error: 'dispatch_in_progress',
          logId: 'employee-log-rerun',
        });
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /integrations/jobs/exports/:kind/:id/redispatch rejects failed accounting source logs', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  await withPrismaStubs(
    {
      'accountingIcsExportLog.findUnique': async (args) => {
        if (args?.where?.id === 'accounting-log-source') {
          return {
            id: 'accounting-log-source',
            idempotencyKey: 'accounting-source-key',
            requestHash: 'accounting-request-hash',
            reexportOfId: null,
            periodKey: '2026-03',
            exportedUntil: new Date('2026-03-16T00:00:00.000Z'),
            status: 'failed',
            exportedCount: 0,
            payload: null,
            message: 'mapping_incomplete',
            startedAt: new Date('2026-03-16T00:00:00.000Z'),
            finishedAt: new Date('2026-03-16T00:00:02.000Z'),
          };
        }
        return null;
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/jobs/exports/accounting_ics_export/accounting-log-source/redispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            idempotencyKey: 'accounting-redispatch-key',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        assert.deepEqual(JSON.parse(res.body), {
          error: 'redispatch_source_not_exported',
          logId: 'accounting-log-source',
        });
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /integrations/jobs/exports/:kind/:id/redispatch handles accounting redispatch create races as replay', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  let findUniqueCalls = 0;
  await withPrismaStubs(
    {
      'accountingIcsExportLog.findUnique': async (args) => {
        if (args?.where?.id === 'accounting-log-source') {
          return {
            id: 'accounting-log-source',
            idempotencyKey: 'accounting-source-key',
            requestHash: 'accounting-request-hash',
            reexportOfId: null,
            periodKey: '2026-03',
            exportedUntil: new Date('2026-03-16T00:00:00.000Z'),
            status: 'success',
            exportedCount: 2,
            payload: { exportedCount: 2, rows: [] },
            message: 'exported',
            startedAt: new Date('2026-03-16T00:00:00.000Z'),
            finishedAt: new Date('2026-03-16T00:00:02.000Z'),
          };
        }
        if (args?.where?.idempotencyKey === 'accounting-redispatch-race-key') {
          findUniqueCalls += 1;
          if (findUniqueCalls === 1) {
            return null;
          }
          return {
            id: 'accounting-log-rerun',
            idempotencyKey: 'accounting-redispatch-race-key',
            requestHash: 'accounting-request-hash',
            reexportOfId: 'accounting-log-source',
            periodKey: '2026-03',
            exportedUntil: new Date('2026-03-16T00:00:00.000Z'),
            status: 'running',
            exportedCount: 2,
            payload: { exportedCount: 2, rows: [] },
            message: 'redispatched',
            startedAt: new Date('2026-03-16T00:00:03.000Z'),
            finishedAt: null,
          };
        }
        return null;
      },
      'accountingIcsExportLog.create': async () => {
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`idempotencyKey`)',
          { code: 'P2002', clientVersion: 'test' },
        );
      },
      'auditLog.create': async () => ({ id: 'audit-accounting-race' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/jobs/exports/accounting_ics_export/accounting-log-source/redispatch',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            idempotencyKey: 'accounting-redispatch-race-key',
          },
        });
        assert.equal(res.statusCode, 409, res.body);
        assert.deepEqual(JSON.parse(res.body), {
          error: 'dispatch_in_progress',
          logId: 'accounting-log-rerun',
        });
      } finally {
        await server.close();
      }
    },
  );
});
