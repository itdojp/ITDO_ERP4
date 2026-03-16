import assert from 'node:assert/strict';
import test from 'node:test';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
process.env.AUTH_MODE = 'header';

const { buildServer } = await import('../dist/server.js');
const { prisma } = await import('../dist/services/db.js');

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

test('GET /integrations/reconciliation/summary returns aggregate reconciliation summary', async () => {
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => ({
        id: 'closing-001',
        periodKey: '2026-03',
        version: 2,
        status: 'closed',
        closedAt: new Date('2026-03-31T15:00:00.000Z'),
        summaryCount: 2,
        workedDayCountTotal: 40,
        scheduledWorkMinutesTotal: 19200,
        approvedWorkMinutesTotal: 18600,
        overtimeTotalMinutesTotal: 120,
        paidLeaveMinutesTotal: 480,
        unpaidLeaveMinutesTotal: 0,
        totalLeaveMinutesTotal: 480,
        sourceTimeEntryCount: 40,
        sourceLeaveRequestCount: 1,
      }),
      'attendanceMonthlySummary.findMany': async (args) => {
        assert.equal(args?.where?.closingPeriodId, 'closing-001');
        return [{ employeeCode: 'EMP-001' }, { employeeCode: 'EMP-002' }];
      },
      'hrEmployeeMasterExportLog.findFirst': async (args) => {
        if (args?.where?.updatedSince === null) {
          return {
            id: 'emp-full-001',
            idempotencyKey: 'emp-full-key',
            reexportOfId: null,
            status: 'success',
            updatedSince: null,
            exportedUntil: new Date('2026-03-31T15:10:00.000Z'),
            exportedCount: 2,
            startedAt: new Date('2026-03-31T15:10:00.000Z'),
            finishedAt: new Date('2026-03-31T15:10:05.000Z'),
            message: 'exported',
            payload: {
              items: [{ employeeCode: 'EMP-001' }, { employeeCode: 'EMP-003' }],
            },
          };
        }
        return {
          id: 'emp-any-001',
          idempotencyKey: 'emp-any-key',
          reexportOfId: null,
          status: 'success',
          updatedSince: new Date('2026-03-20T00:00:00.000Z'),
          exportedUntil: new Date('2026-03-31T15:20:00.000Z'),
          exportedCount: 1,
          startedAt: new Date('2026-03-31T15:20:00.000Z'),
          finishedAt: new Date('2026-03-31T15:20:05.000Z'),
          message: 'exported',
          payload: {
            items: [{ employeeCode: 'EMP-003' }],
          },
        };
      },
      'accountingIcsExportLog.findFirst': async () => ({
        id: 'ics-001',
        idempotencyKey: 'ics-key',
        reexportOfId: null,
        periodKey: '2026-03',
        status: 'success',
        exportedUntil: new Date('2026-03-31T15:30:00.000Z'),
        exportedCount: 3,
        startedAt: new Date('2026-03-31T15:30:00.000Z'),
        finishedAt: new Date('2026-03-31T15:30:05.000Z'),
        message: 'exported',
      }),
      'accountingJournalStaging.groupBy': async () => [
        { status: 'ready', _count: { _all: 3 } },
        { status: 'pending_mapping', _count: { _all: 1 } },
        { status: 'blocked', _count: { _all: 0 } },
        { status: 'exported', _count: { _all: 2 } },
      ],
      'accountingJournalStaging.aggregate': async () => ({
        _sum: { amount: '12345' },
      }),
      'accountingJournalStaging.count': async (args) => {
        if (args?.where?.status === 'ready' && Array.isArray(args?.where?.OR)) {
          return 0;
        }
        return 0;
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/reconciliation/summary?periodKey=2026-03',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.periodKey, '2026-03');
        assert.equal(body.attendance.latestClosing.id, 'closing-001');
        assert.equal(body.payroll.latestEmployeeMasterExport.id, 'emp-any-001');
        assert.equal(
          body.payroll.latestEmployeeMasterFullExport.id,
          'emp-full-001',
        );
        assert.equal(body.payroll.comparisonStatus, 'mismatch');
        assert.equal(body.payroll.attendanceEmployeeCount, 2);
        assert.equal(body.payroll.employeeMasterExportCount, 2);
        assert.equal(body.payroll.matchedEmployeeCount, 1);
        assert.deepEqual(body.payroll.attendanceOnlyEmployeeCodes, ['EMP-002']);
        assert.deepEqual(body.payroll.employeeMasterOnlyEmployeeCodes, [
          'EMP-003',
        ]);
        assert.equal(body.accounting.latestIcsExport.id, 'ics-001');
        assert.equal(body.accounting.comparisonStatus, 'mapping_incomplete');
        assert.equal(body.accounting.mappingComplete, false);
        assert.equal(body.accounting.staging.totalCount, 6);
        assert.equal(body.accounting.staging.readyCount, 3);
        assert.equal(body.accounting.staging.pendingMappingCount, 1);
        assert.equal(body.accounting.staging.readyAmountTotal, '12345');
        assert.equal(body.accounting.staging.readyDebitTotal, '12345');
        assert.equal(body.accounting.staging.readyCreditTotal, '12345');
        assert.equal(body.accounting.staging.debitCreditBalanced, true);
        assert.equal(body.hasBlockingDifferences, true);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/reconciliation/summary returns 400 for invalid periodKey', async () => {
  const server = await buildServer({ logger: false });
  try {
    const res = await server.inject({
      method: 'GET',
      url: '/integrations/reconciliation/summary?periodKey=2026-13',
      headers: {
        'x-user-id': 'admin-user',
        'x-roles': 'admin',
      },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.error?.code, 'VALIDATION_ERROR');
    assert.equal(body.error?.category, 'validation');
    assert.match(body.error?.details?.[0]?.message ?? '', /must match pattern/);
  } finally {
    await server.close();
  }
});

test('GET /integrations/reconciliation/summary treats missing prerequisites as blocking differences', async () => {
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => null,
      'hrEmployeeMasterExportLog.findFirst': async () => null,
      'accountingIcsExportLog.findFirst': async () => null,
      'accountingJournalStaging.groupBy': async () => [],
      'accountingJournalStaging.aggregate': async () => ({
        _sum: { amount: null },
      }),
      'accountingJournalStaging.count': async () => 0,
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/reconciliation/summary?periodKey=2026-05',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(
          body.payroll.comparisonStatus,
          'attendance_closing_missing',
        );
        assert.equal(body.accounting.comparisonStatus, 'export_missing');
        assert.equal(body.hasBlockingDifferences, true);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/reconciliation/summary reports missing full export and export mismatch', async () => {
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => ({
        id: 'closing-002',
        periodKey: '2026-04',
        version: 1,
        status: 'closed',
        closedAt: new Date('2026-04-30T15:00:00.000Z'),
        summaryCount: 1,
        workedDayCountTotal: 20,
        scheduledWorkMinutesTotal: 9600,
        approvedWorkMinutesTotal: 9600,
        overtimeTotalMinutesTotal: 0,
        paidLeaveMinutesTotal: 0,
        unpaidLeaveMinutesTotal: 0,
        totalLeaveMinutesTotal: 0,
        sourceTimeEntryCount: 20,
        sourceLeaveRequestCount: 0,
      }),
      'attendanceMonthlySummary.findMany': async (args) => {
        assert.equal(args?.where?.closingPeriodId, 'closing-002');
        return [{ employeeCode: 'EMP-010' }];
      },
      'hrEmployeeMasterExportLog.findFirst': async (args) => {
        if (args?.where?.updatedSince === null) return null;
        return null;
      },
      'accountingIcsExportLog.findFirst': async () => ({
        id: 'ics-002',
        idempotencyKey: 'ics-key-002',
        reexportOfId: null,
        periodKey: '2026-04',
        status: 'success',
        exportedUntil: new Date('2026-04-30T15:30:00.000Z'),
        exportedCount: 1,
        startedAt: new Date('2026-04-30T15:30:00.000Z'),
        finishedAt: new Date('2026-04-30T15:30:05.000Z'),
        message: 'exported',
      }),
      'accountingJournalStaging.groupBy': async () => [
        { status: 'ready', _count: { _all: 2 } },
      ],
      'accountingJournalStaging.aggregate': async () => ({
        _sum: { amount: '2500' },
      }),
      'accountingJournalStaging.count': async () => 1,
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/reconciliation/summary?periodKey=2026-04',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(
          body.payroll.comparisonStatus,
          'employee_master_full_export_missing',
        );
        assert.equal(body.payroll.countsAligned, null);
        assert.equal(body.accounting.comparisonStatus, 'ready_row_incomplete');
        assert.equal(body.accounting.countsAligned, false);
        assert.equal(body.accounting.staging.invalidReadyCount, 1);
        assert.equal(body.accounting.staging.debitCreditBalanced, false);
        assert.equal(body.hasBlockingDifferences, true);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/reconciliation/details returns payroll diffs and accounting breakdowns', async () => {
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => ({
        id: 'closing-003',
        periodKey: '2026-06',
        version: 1,
        status: 'closed',
        closedAt: new Date('2026-06-30T15:00:00.000Z'),
        summaryCount: 2,
        workedDayCountTotal: 42,
        scheduledWorkMinutesTotal: 20160,
        approvedWorkMinutesTotal: 19920,
        overtimeTotalMinutesTotal: 180,
        paidLeaveMinutesTotal: 240,
        unpaidLeaveMinutesTotal: 0,
        totalLeaveMinutesTotal: 240,
        sourceTimeEntryCount: 42,
        sourceLeaveRequestCount: 1,
      }),
      'attendanceMonthlySummary.findMany': async (args) => {
        if (args?.where?.closingPeriodId === 'closing-003') {
          return [{ employeeCode: 'EMP-001' }, { employeeCode: 'EMP-002' }];
        }
        throw new Error(
          `unexpected attendance summary query: ${JSON.stringify(args)}`,
        );
      },
      'hrEmployeeMasterExportLog.findFirst': async (args) => {
        if (args?.where?.updatedSince === null) {
          return {
            id: 'emp-full-003',
            idempotencyKey: 'emp-full-key-003',
            reexportOfId: null,
            status: 'success',
            updatedSince: null,
            exportedUntil: new Date('2026-06-30T15:10:00.000Z'),
            exportedCount: 2,
            startedAt: new Date('2026-06-30T15:10:00.000Z'),
            finishedAt: new Date('2026-06-30T15:10:05.000Z'),
            message: 'exported',
            payload: {
              items: [{ employeeCode: 'EMP-001' }, { employeeCode: 'EMP-003' }],
            },
          };
        }
        return null;
      },
      'accountingIcsExportLog.findFirst': async () => ({
        id: 'ics-003',
        idempotencyKey: 'ics-key-003',
        reexportOfId: null,
        periodKey: '2026-06',
        status: 'success',
        exportedUntil: new Date('2026-06-30T15:30:00.000Z'),
        exportedCount: 2,
        startedAt: new Date('2026-06-30T15:30:00.000Z'),
        finishedAt: new Date('2026-06-30T15:30:05.000Z'),
        message: 'exported',
      }),
      'accountingJournalStaging.groupBy': async () => [
        { status: 'ready', _count: { _all: 2 } },
        { status: 'pending_mapping', _count: { _all: 1 } },
        { status: 'blocked', _count: { _all: 1 } },
      ],
      'accountingJournalStaging.aggregate': async () => ({
        _sum: { amount: '5000' },
      }),
      'accountingJournalStaging.count': async () => 1,
      'accountingJournalStaging.findMany': async () => [
        {
          id: 'stg-001',
          eventId: 'evt-001',
          status: 'ready',
          mappingKey: 'expense:travel',
          description: 'travel expense',
          debitAccountCode: '6000',
          creditAccountCode: '2000',
          taxCode: 'A01',
          amount: '2000',
          departmentCode: 'DEP-A',
          event: {
            sourceTable: 'expenses',
            sourceId: 'exp-001',
            projectCode: 'PRJ-001',
            departmentCode: 'DEP-A',
          },
        },
        {
          id: 'stg-002',
          eventId: 'evt-002',
          status: 'pending_mapping',
          mappingKey: 'expense:meal',
          description: 'meal',
          debitAccountCode: null,
          creditAccountCode: null,
          taxCode: null,
          amount: '1200',
          departmentCode: 'DEP-A',
          event: {
            sourceTable: 'expenses',
            sourceId: 'exp-002',
            projectCode: 'PRJ-001',
            departmentCode: 'DEP-A',
          },
        },
        {
          id: 'stg-003',
          eventId: 'evt-003',
          status: 'blocked',
          mappingKey: 'invoice:service',
          description: 'invoice',
          debitAccountCode: null,
          creditAccountCode: null,
          taxCode: null,
          amount: '1800',
          departmentCode: null,
          event: {
            sourceTable: 'invoices',
            sourceId: 'inv-001',
            projectCode: 'PRJ-002',
            departmentCode: null,
          },
        },
        {
          id: 'stg-004',
          eventId: 'evt-004',
          status: 'ready',
          mappingKey: 'vendor_invoice:office',
          description: 'office',
          debitAccountCode: '',
          creditAccountCode: '2100',
          taxCode: 'A01',
          amount: '3000',
          departmentCode: 'DEP-B',
          event: {
            sourceTable: 'vendor_invoices',
            sourceId: 'vin-001',
            projectCode: null,
            departmentCode: 'DEP-B',
          },
        },
      ],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/reconciliation/details?periodKey=2026-06',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.periodKey, '2026-06');
        assert.deepEqual(body.payroll.attendanceOnlyEmployeeCodes, ['EMP-002']);
        assert.deepEqual(body.payroll.employeeMasterOnlyEmployeeCodes, [
          'EMP-003',
        ]);
        assert.deepEqual(
          body.accounting.byProject.map((item) => item.key),
          ['(unassigned)', 'PRJ-001', 'PRJ-002'],
        );
        assert.equal(body.accounting.byProject[1].pendingMappingCount, 1);
        assert.equal(body.accounting.byProject[2].blockedCount, 1);
        assert.equal(body.accounting.byProject[0].invalidReadyCount, 1);
        assert.deepEqual(
          body.accounting.byDepartment.map((item) => item.key),
          ['(unassigned)', 'DEP-A', 'DEP-B'],
        );
        assert.equal(body.accounting.pendingMappingSamples[0].id, 'stg-002');
        assert.equal(body.accounting.blockedSamples[0].id, 'stg-003');
        assert.equal(body.accounting.invalidReadySamples[0].id, 'stg-004');
      } finally {
        await server.close();
      }
    },
  );
});
