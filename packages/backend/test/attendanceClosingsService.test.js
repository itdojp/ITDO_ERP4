import assert from 'node:assert/strict';
import test from 'node:test';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';
process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;

const {
  AttendanceClosingError,
  createAttendanceClosing,
  getAttendanceClosingSummaries,
  listAttendanceClosings,
} = await import('../dist/services/attendanceClosings.js');

function auditContext() {
  return {
    actorUserId: 'admin-user',
    ipAddress: '127.0.0.1',
    userAgent: 'node:test',
  };
}

test('createAttendanceClosing delegates close and writes audit metadata', async () => {
  const auditCalls = [];
  const closeCalls = [];
  const closing = {
    id: 'closing-001',
    periodKey: '2026-03',
    version: 1,
    summaryCount: 2,
  };
  const summaries = [{ userId: 'user-001' }];

  const result = await createAttendanceClosing(
    {
      periodKey: '2026-03',
      reclose: false,
      actorId: 'admin-user',
      auditContext: auditContext(),
    },
    {
      client: { marker: 'client' },
      closePeriod: async (input) => {
        closeCalls.push(input);
        return { closing, summaries };
      },
      logAudit: async (entry) => {
        auditCalls.push(entry);
      },
    },
  );

  assert.equal(result.closing, closing);
  assert.equal(result.summaries, summaries);
  assert.equal(closeCalls.length, 1);
  assert.equal(closeCalls[0].periodKey, '2026-03');
  assert.equal(closeCalls[0].reclose, false);
  assert.equal(closeCalls[0].actorId, 'admin-user');
  assert.deepEqual(closeCalls[0].client, { marker: 'client' });
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, 'attendance_closing_created');
  assert.equal(auditCalls[0].targetTable, 'AttendanceClosingPeriod');
  assert.equal(auditCalls[0].targetId, 'closing-001');
  assert.deepEqual(auditCalls[0].metadata, {
    periodKey: '2026-03',
    version: 1,
    summaryCount: 2,
  });
});

test('createAttendanceClosing uses reclose audit action', async () => {
  const auditCalls = [];
  await createAttendanceClosing(
    {
      periodKey: '2026-03',
      reclose: true,
      actorId: 'admin-user',
      auditContext: auditContext(),
    },
    {
      closePeriod: async () => ({
        closing: {
          id: 'closing-002',
          periodKey: '2026-03',
          version: 2,
          summaryCount: 1,
        },
        summaries: [],
      }),
      logAudit: async (entry) => {
        auditCalls.push(entry);
      },
    },
  );

  assert.equal(auditCalls[0].action, 'attendance_closing_reclosed');
});

test('listAttendanceClosings applies filters and bounded pagination', async () => {
  let capturedFindMany = null;
  const client = {
    attendanceClosingPeriod: {
      findMany: async (args) => {
        capturedFindMany = args;
        return [{ id: 'closing-001', periodKey: '2026-03', version: 1 }];
      },
    },
  };

  const result = await listAttendanceClosings(
    { periodKey: ' 2026-03 ', limit: '999', offset: '-5' },
    { client },
  );

  assert.equal(result.limit, 200);
  assert.equal(result.offset, 0);
  assert.deepEqual(capturedFindMany.where, { periodKey: '2026-03' });
  assert.deepEqual(capturedFindMany.orderBy, [
    { periodKey: 'desc' },
    { version: 'desc' },
  ]);
  assert.equal(capturedFindMany.take, 200);
  assert.equal(capturedFindMany.skip, 0);
  assert.equal(result.items[0].id, 'closing-001');
});

test('getAttendanceClosingSummaries returns closing and ordered summary rows', async () => {
  let capturedSummaryFindMany = null;
  const closing = {
    id: 'closing-001',
    periodKey: '2026-03',
    version: 1,
    status: 'closed',
    closedAt: new Date('2026-03-31T12:00:00.000Z'),
    summaryCount: 1,
  };
  const client = {
    attendanceClosingPeriod: {
      findUnique: async (args) => {
        assert.deepEqual(args.where, { id: 'closing-001' });
        return closing;
      },
    },
    attendanceMonthlySummary: {
      findMany: async (args) => {
        capturedSummaryFindMany = args;
        return [{ id: 'summary-001', userId: 'user-001' }];
      },
    },
  };

  const result = await getAttendanceClosingSummaries(
    { id: 'closing-001', limit: '5', offset: '4' },
    { client },
  );

  assert.equal(result.closing, closing);
  assert.equal(result.limit, 5);
  assert.equal(result.offset, 4);
  assert.deepEqual(capturedSummaryFindMany.where, {
    closingPeriodId: 'closing-001',
  });
  assert.deepEqual(capturedSummaryFindMany.orderBy, [
    { employeeCode: 'asc' },
    { userId: 'asc' },
  ]);
  assert.equal(capturedSummaryFindMany.take, 5);
  assert.equal(capturedSummaryFindMany.skip, 4);
  assert.equal(result.items[0].id, 'summary-001');
});

test('getAttendanceClosingSummaries throws not found for missing closing', async () => {
  const client = {
    attendanceClosingPeriod: {
      findUnique: async () => null,
    },
  };

  await assert.rejects(
    () => getAttendanceClosingSummaries({ id: 'missing' }, { client }),
    (error) => {
      assert.ok(error instanceof AttendanceClosingError);
      assert.equal(error.code, 'attendance_closing_not_found');
      assert.deepEqual(error.details, { id: 'missing' });
      return true;
    },
  );
});
