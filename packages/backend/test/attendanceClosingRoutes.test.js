import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import {
  AttendanceClosingError,
  closeAttendancePeriod,
} from '../dist/services/attendanceClosings.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function withPrismaStubs(stubs, fn) {
  const effectiveStubs = {
    'periodLock.findFirst': async () => ({
      id: 'lock-001',
      scope: 'global',
      projectId: null,
    }),
    ...stubs,
  };
  const restores = [];
  for (const [path, stub] of Object.entries(effectiveStubs)) {
    const segments = path.split('.');
    const method = segments.pop();
    if (!method) throw new Error(`invalid stub target: ${path}`);
    let target = prisma;
    for (const segment of segments) {
      const next = target?.[segment];
      if (!next) throw new Error(`invalid stub target: ${path}`);
      target = next;
    }
    if (typeof target[method] !== 'function') {
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

function adminHeaders() {
  return {
    'x-user-id': 'admin-user',
    'x-roles': 'admin,mgmt',
  };
}

async function withServer(fn) {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';
  const server = await buildServer({ logger: false });
  try {
    await fn(server);
  } finally {
    await server.close();
  }
}

test('POST /integrations/hr/attendance/closings closes a period and stores summaries', async () => {
  let capturedCreate = null;
  let capturedCreateMany = null;
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => null,
      'userAccount.findMany': async () => [
        {
          id: 'user-001',
          employeeCode: 'E-001',
          joinedAt: new Date('2026-03-01T00:00:00.000Z'),
          leftAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      ],
      'timeEntry.findMany': async (args) => {
        if (args.where?.status === 'approved') {
          return [
            {
              id: 'time-001',
              userId: 'user-001',
              workDate: new Date('2026-03-01T00:00:00.000Z'),
              minutes: 300,
            },
            {
              id: 'time-002',
              userId: 'user-001',
              workDate: new Date('2026-03-01T00:00:00.000Z'),
              minutes: 240,
            },
          ];
        }
        return [];
      },
      'leaveRequest.findMany': async (args) => {
        if (args.where?.status === 'approved') {
          return [
            {
              id: 'leave-001',
              userId: 'user-001',
              leaveType: 'paid',
              startDate: new Date('2026-03-01T00:00:00.000Z'),
              endDate: new Date('2026-03-01T00:00:00.000Z'),
              hours: null,
              minutes: 120,
              startTimeMinutes: 540,
              endTimeMinutes: 660,
            },
          ];
        }
        return [];
      },
      'leaveType.findMany': async () => [{ code: 'paid', isPaid: true }],
      'leaveSetting.upsert': async () => ({
        id: 'default',
        defaultWorkdayMinutes: 480,
      }),
      'leaveCompanyHoliday.findMany': async () => [],
      'leaveWorkdayOverride.findMany': async () => [],
      'auditLog.create': async () => ({ id: 'audit-001' }),
      $transaction: async (callback) => callback(prisma),
      'attendanceClosingPeriod.create': async (args) => {
        capturedCreate = args;
        return {
          id: 'close-001',
          ...args.data,
        };
      },
      'attendanceMonthlySummary.createMany': async (args) => {
        capturedCreateMany = args;
        return { count: args.data.length };
      },
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/attendance/closings',
          headers: adminHeaders(),
          payload: { periodKey: '2026-03' },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.closing.periodKey, '2026-03');
        assert.equal(body.closing.version, 1);
        assert.equal(body.closing.summaryCount, 1);
        assert.equal(body.summaries.length, 1);
        assert.equal(body.summaries[0].employeeCode, 'E-001');
        assert.equal(body.summaries[0].approvedWorkMinutes, 540);
        assert.equal(body.summaries[0].overtimeTotalMinutes, 60);
        assert.equal(body.summaries[0].overtimeWithinStatutoryMinutes, 0);
        assert.equal(body.summaries[0].overtimeOverStatutoryMinutes, 60);
        assert.equal(body.summaries[0].holidayWorkMinutes, 0);
        assert.equal(body.summaries[0].paidLeaveMinutes, 120);
      });
    },
  );

  assert.equal(capturedCreate?.data?.approvedWorkMinutesTotal, 540);
  assert.equal(capturedCreate?.data?.overtimeTotalMinutesTotal, 60);
  assert.equal(capturedCreate?.data?.overtimeWithinStatutoryMinutesTotal, 0);
  assert.equal(capturedCreate?.data?.overtimeOverStatutoryMinutesTotal, 60);
  assert.equal(capturedCreate?.data?.holidayWorkMinutesTotal, 0);
  assert.equal(capturedCreateMany?.data?.length, 1);
  assert.equal(capturedCreateMany?.data?.[0]?.scheduledWorkMinutes, 480);
  assert.equal(capturedCreateMany?.data?.[0]?.workedDayCount, 1);
  assert.equal(
    capturedCreateMany?.data?.[0]?.overtimeWithinStatutoryMinutes,
    0,
  );
  assert.equal(capturedCreateMany?.data?.[0]?.overtimeOverStatutoryMinutes, 60);
  assert.equal(capturedCreateMany?.data?.[0]?.holidayWorkMinutes, 0);
});

test('POST /integrations/hr/attendance/closings classifies within-statutory and holiday overtime', async () => {
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => null,
      'userAccount.findMany': async () => [
        {
          id: 'user-001',
          employeeCode: 'E-001',
          joinedAt: new Date('2026-03-01T00:00:00.000Z'),
          leftAt: new Date('2026-03-31T00:00:00.000Z'),
        },
      ],
      'timeEntry.findMany': async (args) => {
        if (args.where?.status === 'approved') {
          return [
            {
              id: 'time-001',
              userId: 'user-001',
              workDate: new Date('2026-03-03T00:00:00.000Z'),
              minutes: 450,
            },
            {
              id: 'time-002',
              userId: 'user-001',
              workDate: new Date('2026-03-04T00:00:00.000Z'),
              minutes: 240,
            },
          ];
        }
        return [];
      },
      'leaveRequest.findMany': async () => [],
      'leaveType.findMany': async () => [],
      'leaveSetting.upsert': async () => ({
        id: 'default',
        defaultWorkdayMinutes: 480,
      }),
      'leaveCompanyHoliday.findMany': async () => [
        { holidayDate: new Date('2026-03-04T00:00:00.000Z') },
      ],
      'leaveWorkdayOverride.findMany': async () => [
        {
          userId: 'user-001',
          workDate: new Date('2026-03-03T00:00:00.000Z'),
          workMinutes: 360,
        },
      ],
      'auditLog.create': async () => ({ id: 'audit-001' }),
      $transaction: async (callback) => callback(prisma),
      'attendanceClosingPeriod.create': async (args) => ({
        id: 'close-001',
        ...args.data,
      }),
      'attendanceMonthlySummary.createMany': async () => ({ count: 1 }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/attendance/closings',
          headers: adminHeaders(),
          payload: { periodKey: '2026-03' },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.summaries[0].approvedWorkMinutes, 690);
        assert.equal(body.summaries[0].overtimeTotalMinutes, 330);
        assert.equal(body.summaries[0].overtimeWithinStatutoryMinutes, 90);
        assert.equal(body.summaries[0].overtimeOverStatutoryMinutes, 0);
        assert.equal(body.summaries[0].holidayWorkMinutes, 240);
      });
    },
  );
});

test('POST /integrations/hr/attendance/closings returns 409 when period is already closed', async () => {
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => ({
        id: 'close-001',
        version: 1,
        status: 'closed',
      }),
      $transaction: async (callback) => callback(prisma),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/attendance/closings',
          headers: adminHeaders(),
          payload: { periodKey: '2026-03' },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error, 'attendance_period_already_closed');
      });
    },
  );
});

test('POST /integrations/hr/attendance/closings returns 409 when period lock is missing', async () => {
  await withPrismaStubs(
    {
      'periodLock.findFirst': async () => null,
      $transaction: async (callback) => callback(prisma),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/attendance/closings',
          headers: adminHeaders(),
          payload: { periodKey: '2026-03' },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error, 'attendance_period_lock_required');
      });
    },
  );
});

test('POST /integrations/hr/attendance/closings reclose supersedes previous version', async () => {
  let capturedUpdate = null;
  let capturedCreate = null;
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => ({
        id: 'close-001',
        version: 1,
        status: 'closed',
      }),
      'userAccount.findMany': async () => [
        {
          id: 'user-001',
          employeeCode: 'E-001',
          joinedAt: new Date('2026-03-01T00:00:00.000Z'),
          leftAt: new Date('2026-03-31T00:00:00.000Z'),
        },
      ],
      'timeEntry.findMany': async () => [],
      'leaveRequest.findMany': async () => [],
      'leaveType.findMany': async () => [],
      'leaveSetting.upsert': async () => ({
        id: 'default',
        defaultWorkdayMinutes: 480,
      }),
      'leaveCompanyHoliday.findMany': async () => [],
      'leaveWorkdayOverride.findMany': async () => [],
      'auditLog.create': async () => ({ id: 'audit-001' }),
      $transaction: async (callback) => callback(prisma),
      'attendanceClosingPeriod.update': async (args) => {
        capturedUpdate = args;
        return { id: 'close-001', ...args.data };
      },
      'attendanceClosingPeriod.create': async (args) => {
        capturedCreate = args;
        return {
          id: 'close-002',
          ...args.data,
        };
      },
      'attendanceMonthlySummary.createMany': async () => ({ count: 1 }),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/attendance/closings',
          headers: adminHeaders(),
          payload: { periodKey: '2026-03', reclose: true },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.closing.version, 2);
      });
    },
  );

  assert.equal(capturedUpdate?.where?.id, 'close-001');
  assert.equal(capturedUpdate?.data?.status, 'superseded');
  assert.equal(capturedCreate?.data?.version, 2);
});

test('POST /integrations/hr/attendance/closings returns 409 when employeeCode is missing', async () => {
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => null,
      'userAccount.findMany': async () => [
        {
          id: 'user-001',
          employeeCode: null,
          joinedAt: new Date('2026-03-01T00:00:00.000Z'),
          leftAt: new Date('2026-03-31T00:00:00.000Z'),
        },
      ],
      'timeEntry.findMany': async () => [],
      'leaveRequest.findMany': async () => [],
      $transaction: async (callback) => callback(prisma),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/attendance/closings',
          headers: adminHeaders(),
          payload: { periodKey: '2026-03' },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error, 'attendance_employee_code_missing');
      });
    },
  );
});

test('POST /integrations/hr/attendance/closings returns 409 when unconfirmed records remain', async () => {
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => null,
      'userAccount.findMany': async () => [
        {
          id: 'user-001',
          employeeCode: 'E-001',
          joinedAt: new Date('2026-03-01T00:00:00.000Z'),
          leftAt: new Date('2026-03-31T00:00:00.000Z'),
        },
      ],
      'timeEntry.findMany': async (args) => {
        if (args.where?.status === 'approved') {
          return [];
        }
        return [{ id: 'time-pending-001' }];
      },
      'leaveRequest.findMany': async () => [],
      $transaction: async (callback) => callback(prisma),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/attendance/closings',
          headers: adminHeaders(),
          payload: { periodKey: '2026-03' },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error, 'attendance_period_unconfirmed');
        assert.deepEqual(body.details.pendingTimeEntryIds, [
          'time-pending-001',
        ]);
      });
    },
  );
});

test('POST /integrations/hr/attendance/closings returns 400 on invalid period key payload', async () => {
  await withServer(async (server) => {
    const res = await server.inject({
      method: 'POST',
      url: '/integrations/hr/attendance/closings',
      headers: adminHeaders(),
      payload: { periodKey: '2026-13' },
    });
    assert.equal(res.statusCode, 400, res.body);
  });
});

test('POST /integrations/hr/attendance/closings returns 409 when leave type master is missing', async () => {
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => null,
      'userAccount.findMany': async () => [
        {
          id: 'user-001',
          employeeCode: 'E-001',
          joinedAt: new Date('2026-03-01T00:00:00.000Z'),
          leftAt: new Date('2026-03-31T00:00:00.000Z'),
        },
      ],
      'timeEntry.findMany': async () => [],
      'leaveRequest.findMany': async (args) => {
        if (args.where?.status === 'approved') {
          return [
            {
              id: 'leave-001',
              userId: 'user-001',
              leaveType: 'paid',
              startDate: new Date('2026-03-01T00:00:00.000Z'),
              endDate: new Date('2026-03-01T00:00:00.000Z'),
              hours: null,
              minutes: 120,
              startTimeMinutes: 540,
              endTimeMinutes: 660,
            },
          ];
        }
        return [];
      },
      'leaveType.findMany': async () => [],
      'leaveSetting.upsert': async () => ({
        id: 'default',
        defaultWorkdayMinutes: 480,
      }),
      'leaveCompanyHoliday.findMany': async () => [],
      'leaveWorkdayOverride.findMany': async () => [],
      $transaction: async (callback) => callback(prisma),
    },
    async () => {
      await withServer(async (server) => {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/hr/attendance/closings',
          headers: adminHeaders(),
          payload: { periodKey: '2026-03' },
        });
        assert.equal(res.statusCode, 409, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.error, 'attendance_leave_type_unresolved');
      });
    },
  );
});

test('closeAttendancePeriod returns deterministic conflict on concurrent version collision', async () => {
  const tx = {
    periodLock: {
      findFirst: async () => ({
        id: 'lock-001',
        scope: 'global',
        projectId: null,
      }),
    },
    attendanceClosingPeriod: {
      findFirst: async () => null,
      create: async () => {
        const error = new Error('unique violation');
        error.code = 'P2002';
        throw error;
      },
    },
    userAccount: {
      findMany: async () => [],
    },
    timeEntry: {
      findMany: async () => [],
    },
    leaveRequest: {
      findMany: async () => [],
    },
    leaveType: {
      findMany: async () => [],
    },
    leaveSetting: {
      upsert: async () => ({
        id: 'default',
        defaultWorkdayMinutes: 480,
      }),
    },
    leaveCompanyHoliday: {
      findMany: async () => [],
    },
    leaveWorkdayOverride: {
      findMany: async () => [],
    },
    attendanceMonthlySummary: {
      createMany: async () => ({ count: 0 }),
    },
  };

  await assert.rejects(
    closeAttendancePeriod({
      periodKey: '2026-03',
      client: tx,
    }),
    (error) => {
      assert.ok(error instanceof AttendanceClosingError);
      assert.equal(error.code, 'attendance_period_concurrent_close');
      return true;
    },
  );
});

test('closeAttendancePeriod rejects invalid period key', async () => {
  await assert.rejects(
    closeAttendancePeriod({ periodKey: '2026-13' }),
    (error) => {
      assert.ok(error instanceof AttendanceClosingError);
      assert.equal(error.code, 'invalid_period_key');
      return true;
    },
  );
});

test('GET /integrations/hr/attendance/closings and summaries return stored records', async () => {
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findMany': async () => [
        {
          id: 'close-001',
          periodKey: '2026-03',
          version: 2,
          status: 'closed',
          closedAt: new Date('2026-03-31T12:00:00.000Z'),
          closedBy: 'admin-user',
          supersededAt: null,
          supersededBy: null,
          summaryCount: 1,
          workedDayCountTotal: 20,
          scheduledWorkMinutesTotal: 9600,
          approvedWorkMinutesTotal: 9300,
          overtimeTotalMinutesTotal: 180,
          overtimeWithinStatutoryMinutesTotal: 60,
          overtimeOverStatutoryMinutesTotal: 120,
          holidayWorkMinutesTotal: 0,
          paidLeaveMinutesTotal: 480,
          unpaidLeaveMinutesTotal: 0,
          totalLeaveMinutesTotal: 480,
          sourceTimeEntryCount: 22,
          sourceLeaveRequestCount: 1,
        },
      ],
      'attendanceClosingPeriod.findUnique': async () => ({
        id: 'close-001',
        periodKey: '2026-03',
        version: 2,
        status: 'closed',
        closedAt: new Date('2026-03-31T12:00:00.000Z'),
        summaryCount: 1,
      }),
      'attendanceMonthlySummary.findMany': async () => [
        {
          id: 'sum-001',
          userId: 'user-001',
          employeeCode: 'E-001',
          workedDayCount: 20,
          scheduledWorkMinutes: 9600,
          approvedWorkMinutes: 9300,
          overtimeTotalMinutes: 180,
          overtimeWithinStatutoryMinutes: 60,
          overtimeOverStatutoryMinutes: 120,
          holidayWorkMinutes: 0,
          paidLeaveMinutes: 480,
          unpaidLeaveMinutes: 0,
          totalLeaveMinutes: 480,
          sourceTimeEntryCount: 22,
          sourceLeaveRequestCount: 1,
        },
      ],
    },
    async () => {
      await withServer(async (server) => {
        const list = await server.inject({
          method: 'GET',
          url: '/integrations/hr/attendance/closings?periodKey=2026-03&limit=10&offset=0',
          headers: adminHeaders(),
        });
        assert.equal(list.statusCode, 200, list.body);
        const listBody = JSON.parse(list.body);
        assert.equal(listBody.items.length, 1);
        assert.equal(listBody.items[0].version, 2);
        assert.equal(listBody.items[0].overtimeWithinStatutoryMinutesTotal, 60);
        assert.equal(listBody.items[0].overtimeOverStatutoryMinutesTotal, 120);
        assert.equal(listBody.items[0].holidayWorkMinutesTotal, 0);

        const summary = await server.inject({
          method: 'GET',
          url: '/integrations/hr/attendance/closings/close-001/summaries?limit=10&offset=0',
          headers: adminHeaders(),
        });
        assert.equal(summary.statusCode, 200, summary.body);
        const summaryBody = JSON.parse(summary.body);
        assert.equal(summaryBody.closing.id, 'close-001');
        assert.equal(summaryBody.items.length, 1);
        assert.equal(summaryBody.items[0].employeeCode, 'E-001');
        assert.equal(summaryBody.items[0].overtimeWithinStatutoryMinutes, 60);
        assert.equal(summaryBody.items[0].overtimeOverStatutoryMinutes, 120);
        assert.equal(summaryBody.items[0].holidayWorkMinutes, 0);
      });
    },
  );
});
