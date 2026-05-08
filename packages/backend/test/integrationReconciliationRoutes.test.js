import assert from 'node:assert/strict';
import test from 'node:test';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
process.env.AUTH_MODE = 'header';

const { buildServer } = await import('../dist/server.js');
const { prisma } = await import('../dist/services/db.js');

function withPrismaStubs(stubs, fn) {
  const restores = [];
  const defaultStubs = {
    'statutoryAccountingActualImportBatch.findFirst': async () => null,
    'statutoryAccountingActualImportBatch.create': async () => ({}),
    'statutoryAccountingActual.aggregate': async () => ({
      _count: { _all: 0 },
      _sum: { amount: null },
    }),
    'statutoryAccountingActual.groupBy': async () => [],
    'statutoryAccountingActual.createMany': async (args) => ({
      count: Array.isArray(args?.data) ? args.data.length : 0,
    }),
    $transaction: async (fn) => fn(prisma),
  };
  for (const [path, stub] of Object.entries({ ...defaultStubs, ...stubs })) {
    const [model, method] = path.split('.');
    const target = method ? prisma[model] : prisma;
    const key = method ?? model;
    if (!target || typeof target[key] !== 'function') {
      throw new Error(`invalid stub target: ${path}`);
    }
    const original = target[key];
    target[key] = stub;
    restores.push(() => {
      target[key] = original;
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
        return [
          { employeeCode: 'EMP-001' },
          { employeeCode: 'EMP-001' },
          { employeeCode: 'EMP-002' },
        ];
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
      $queryRaw: async (query) => {
        const sql = Array.isArray(query?.strings)
          ? query.strings.join(' ')
          : String(query);
        if (sql.includes('"readyDebitTotal"')) {
          return [
            {
              readyAmountTotal: '12345',
              readyDebitTotal: '12345',
              readyCreditTotal: '12345',
            },
          ];
        }
        if (sql.includes('GROUP BY ajs."currency"')) {
          return [{ currency: 'JPY', count: 3, amountTotal: '12345' }];
        }
        if (sql.includes('SELECT COUNT(*)::int AS "count"')) {
          return [{ count: 0 }];
        }
        throw new Error(`unexpected $queryRaw: ${sql}`);
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
      $queryRaw: async (query) => {
        const sql = Array.isArray(query?.strings)
          ? query.strings.join(' ')
          : String(query);
        if (sql.includes('"readyDebitTotal"')) {
          return [
            {
              readyAmountTotal: '0',
              readyDebitTotal: '0',
              readyCreditTotal: '0',
            },
          ];
        }
        if (sql.includes('GROUP BY ajs."currency"')) {
          return [];
        }
        if (sql.includes('SELECT COUNT(*)::int AS "count"')) {
          return [{ count: 0 }];
        }
        throw new Error(`unexpected $queryRaw: ${sql}`);
      },
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
      $queryRaw: async (query) => {
        const sql = Array.isArray(query?.strings)
          ? query.strings.join(' ')
          : String(query);
        if (sql.includes('"readyDebitTotal"')) {
          return [
            {
              readyAmountTotal: '2500',
              readyDebitTotal: '2500',
              readyCreditTotal: '0',
            },
          ];
        }
        if (sql.includes('GROUP BY ajs."currency"')) {
          return [{ currency: 'JPY', count: 2, amountTotal: '2500' }];
        }
        if (sql.includes('SELECT COUNT(*)::int AS "count"')) {
          return [{ count: 1 }];
        }
        throw new Error(`unexpected $queryRaw: ${sql}`);
      },
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
        assert.equal(body.accounting.staging.readyDebitTotal, '2500');
        assert.equal(body.accounting.staging.readyCreditTotal, '0');
        assert.equal(body.accounting.staging.debitCreditBalanced, false);
        assert.equal(body.hasBlockingDifferences, true);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/reconciliation/summary reports true debit and credit totals', async () => {
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => null,
      'hrEmployeeMasterExportLog.findFirst': async () => null,
      'accountingIcsExportLog.findFirst': async () => ({
        id: 'ics-true-totals',
        idempotencyKey: 'ics-key-true-totals',
        reexportOfId: null,
        periodKey: '2026-05',
        status: 'success',
        exportedUntil: new Date('2026-05-31T15:30:00.000Z'),
        exportedCount: 2,
        startedAt: new Date('2026-05-31T15:30:00.000Z'),
        finishedAt: new Date('2026-05-31T15:30:05.000Z'),
        message: 'exported',
      }),
      'accountingJournalStaging.groupBy': async () => [
        { status: 'ready', _count: { _all: 2 } },
      ],
      $queryRaw: async (query) => {
        const sql = Array.isArray(query?.strings)
          ? query.strings.join(' ')
          : String(query);
        if (sql.includes('"readyDebitTotal"')) {
          return [
            {
              readyAmountTotal: '5500',
              readyDebitTotal: '3000',
              readyCreditTotal: '2500',
            },
          ];
        }
        if (sql.includes('GROUP BY ajs."currency"')) {
          return [{ currency: 'JPY', count: 1, amountTotal: '3000' }];
        }
        if (sql.includes('SELECT COUNT(*)::int AS "count"')) {
          return [{ count: 0 }];
        }
        throw new Error(`unexpected $queryRaw: ${sql}`);
      },
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
          body.accounting.comparisonStatus,
          'debit_credit_unbalanced',
        );
        assert.equal(body.accounting.countsAligned, false);
        assert.equal(body.accounting.staging.readyAmountTotal, '5500');
        assert.equal(body.accounting.staging.readyDebitTotal, '3000');
        assert.equal(body.accounting.staging.readyCreditTotal, '2500');
        assert.equal(body.accounting.staging.debitCreditBalanced, false);
        assert.equal(body.hasBlockingDifferences, true);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/reconciliation/summary compares statutory actuals with internal ready debit total', async () => {
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => ({
        id: 'closing-statutory-001',
        periodKey: '2026-06',
        version: 1,
        status: 'closed',
        closedAt: new Date('2026-06-30T15:00:00.000Z'),
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
      'attendanceMonthlySummary.findMany': async () => [
        { employeeCode: 'EMP-020' },
      ],
      'hrEmployeeMasterExportLog.findFirst': async () => ({
        id: 'emp-full-statutory-001',
        idempotencyKey: 'emp-full-statutory-key',
        reexportOfId: null,
        status: 'success',
        updatedSince: null,
        exportedUntil: new Date('2026-06-30T15:10:00.000Z'),
        exportedCount: 1,
        startedAt: new Date('2026-06-30T15:10:00.000Z'),
        finishedAt: new Date('2026-06-30T15:10:05.000Z'),
        message: 'exported',
        payload: {
          items: [{ employeeCode: 'EMP-020' }],
        },
      }),
      'accountingIcsExportLog.findFirst': async () => ({
        id: 'ics-statutory-001',
        idempotencyKey: 'ics-statutory-key',
        reexportOfId: null,
        periodKey: '2026-06',
        status: 'success',
        exportedUntil: new Date('2026-06-30T15:30:00.000Z'),
        exportedCount: 1,
        startedAt: new Date('2026-06-30T15:30:00.000Z'),
        finishedAt: new Date('2026-06-30T15:30:05.000Z'),
        message: 'exported',
      }),
      'accountingJournalStaging.groupBy': async () => [
        { status: 'ready', _count: { _all: 1 } },
      ],
      'statutoryAccountingActual.groupBy': async (args) => {
        if (args?.by?.includes('currency')) {
          return [
            {
              currency: 'JPY',
              _count: { _all: 2 },
              _sum: { amount: '5300' },
            },
          ];
        }
        return [];
      },
      'statutoryAccountingActualImportBatch.findFirst': async () => ({
        importBatchKey: 'statutory-actual-2026-06-v1',
        accountingSystem: 'keiri-jokun-alpha',
        importedAt: new Date('2026-07-01T01:00:00.000Z'),
      }),
      $queryRaw: async (query) => {
        const sql = Array.isArray(query?.strings)
          ? query.strings.join(' ')
          : String(query);
        if (sql.includes('"readyDebitTotal"')) {
          return [
            {
              readyAmountTotal: '10000',
              readyDebitTotal: '5000',
              readyCreditTotal: '5000',
            },
          ];
        }
        if (sql.includes('GROUP BY ajs."currency"')) {
          return [{ currency: 'JPY', count: 1, amountTotal: '5000' }];
        }
        if (sql.includes('SELECT COUNT(*)::int AS "count"')) {
          return [{ count: 0 }];
        }
        throw new Error(`unexpected $queryRaw: ${sql}`);
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/reconciliation/summary?periodKey=2026-06',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.accounting.comparisonStatus, 'ok');
        assert.equal(
          body.accounting.statutoryActuals.comparisonStatus,
          'amount_mismatch',
        );
        assert.equal(body.accounting.statutoryActuals.importedCount, 2);
        assert.equal(body.accounting.statutoryActuals.currency, 'JPY');
        assert.equal(body.accounting.statutoryActuals.amountTotal, '5300');
        assert.equal(
          body.accounting.statutoryActuals.internalReadyDebitTotal,
          '5000',
        );
        assert.equal(body.accounting.statutoryActuals.varianceAmount, '300');
        assert.equal(
          body.accounting.statutoryActuals.latestImportBatchKey,
          'statutory-actual-2026-06-v1',
        );
        assert.equal(body.hasBlockingDifferences, true);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/reconciliation/summary treats missing statutory actuals as non-blocking when other checks pass', async () => {
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => ({
        id: 'closing-no-statutory',
        periodKey: '2026-09',
        version: 1,
        status: 'closed',
        closedAt: new Date('2026-09-30T15:00:00.000Z'),
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
      'attendanceMonthlySummary.findMany': async () => [
        { employeeCode: 'EMP-090' },
      ],
      'hrEmployeeMasterExportLog.findFirst': async () => ({
        id: 'emp-full-no-statutory',
        idempotencyKey: 'emp-full-no-statutory-key',
        reexportOfId: null,
        status: 'success',
        updatedSince: null,
        exportedUntil: new Date('2026-09-30T15:10:00.000Z'),
        exportedCount: 1,
        startedAt: new Date('2026-09-30T15:10:00.000Z'),
        finishedAt: new Date('2026-09-30T15:10:05.000Z'),
        message: 'exported',
        payload: {
          items: [{ employeeCode: 'EMP-090' }],
        },
      }),
      'accountingIcsExportLog.findFirst': async () => ({
        id: 'ics-no-statutory',
        idempotencyKey: 'ics-no-statutory-key',
        reexportOfId: null,
        periodKey: '2026-09',
        status: 'success',
        exportedUntil: new Date('2026-09-30T15:30:00.000Z'),
        exportedCount: 1,
        startedAt: new Date('2026-09-30T15:30:00.000Z'),
        finishedAt: new Date('2026-09-30T15:30:05.000Z'),
        message: 'exported',
      }),
      'accountingJournalStaging.groupBy': async () => [
        { status: 'ready', _count: { _all: 1 } },
      ],
      $queryRaw: async (query) => {
        const sql = Array.isArray(query?.strings)
          ? query.strings.join(' ')
          : String(query);
        if (sql.includes('"readyDebitTotal"')) {
          return [
            {
              readyAmountTotal: '1000',
              readyDebitTotal: '1000',
              readyCreditTotal: '1000',
            },
          ];
        }
        if (sql.includes('GROUP BY ajs."currency"')) {
          return [{ currency: 'JPY', count: 1, amountTotal: '1000' }];
        }
        if (sql.includes('SELECT COUNT(*)::int AS "count"')) {
          return [{ count: 0 }];
        }
        throw new Error(`unexpected $queryRaw: ${sql}`);
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/reconciliation/summary?periodKey=2026-09',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.payroll.comparisonStatus, 'ok');
        assert.equal(body.accounting.comparisonStatus, 'ok');
        assert.equal(
          body.accounting.statutoryActuals.comparisonStatus,
          'not_imported',
        );
        assert.equal(body.hasBlockingDifferences, false);
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
          return [
            { employeeCode: 'EMP-001' },
            { employeeCode: 'EMP-001' },
            { employeeCode: 'EMP-002' },
          ];
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
      'statutoryAccountingActual.groupBy': async (args) => {
        if (args?.by?.includes('projectCode')) {
          return [
            {
              projectCode: 'PRJ-001',
              currency: 'JPY',
              _count: { _all: 1 },
              _sum: { amount: '2100' },
            },
            {
              projectCode: 'PRJ-003',
              currency: 'JPY',
              _count: { _all: 1 },
              _sum: { amount: '500' },
            },
          ];
        }
        if (args?.by?.includes('departmentCode')) {
          return [
            {
              departmentCode: 'DEP-A',
              currency: 'JPY',
              _count: { _all: 1 },
              _sum: { amount: '1800' },
            },
            {
              departmentCode: 'DEP-C',
              currency: 'JPY',
              _count: { _all: 1 },
              _sum: { amount: '750' },
            },
          ];
        }
        return [];
      },
      'accountingJournalStaging.aggregate': async () => ({
        _sum: { amount: '5000' },
      }),
      'accountingJournalStaging.count': async () => 1,
      $queryRaw: async (query) => {
        const sql = Array.isArray(query?.strings)
          ? query.strings.join(' ')
          : String(query);
        if (sql.includes('"readyDebitTotal"')) {
          return [
            {
              readyAmountTotal: '5000',
              readyDebitTotal: '5000',
              readyCreditTotal: '5000',
            },
          ];
        }
        if (sql.includes('GROUP BY ajs."currency"')) {
          return [{ currency: 'JPY', count: 2, amountTotal: '5000' }];
        }
        if (sql.includes('SELECT ajs."id"')) {
          return [{ id: 'stg-004' }];
        }
        if (sql.includes('ae."projectCode"')) {
          return [
            {
              key: '(unassigned)',
              currency: 'JPY',
              totalCount: 1,
              readyCount: 1,
              pendingMappingCount: 0,
              blockedCount: 0,
              invalidReadyCount: 1,
              readyAmountTotal: '3000',
            },
            {
              key: 'PRJ-001',
              currency: 'JPY',
              totalCount: 2,
              readyCount: 1,
              pendingMappingCount: 1,
              blockedCount: 0,
              invalidReadyCount: 0,
              readyAmountTotal: '2000',
            },
            {
              key: 'PRJ-002',
              currency: 'JPY',
              totalCount: 1,
              readyCount: 0,
              pendingMappingCount: 0,
              blockedCount: 1,
              invalidReadyCount: 0,
              readyAmountTotal: '0',
            },
          ];
        }
        return [
          {
            key: '(unassigned)',
            currency: 'JPY',
            totalCount: 1,
            readyCount: 0,
            pendingMappingCount: 0,
            blockedCount: 1,
            invalidReadyCount: 0,
            readyAmountTotal: '0',
          },
          {
            key: 'DEP-A',
            currency: 'JPY',
            totalCount: 2,
            readyCount: 1,
            pendingMappingCount: 1,
            blockedCount: 0,
            invalidReadyCount: 0,
            readyAmountTotal: '2000',
          },
          {
            key: 'DEP-B',
            currency: 'JPY',
            totalCount: 1,
            readyCount: 1,
            pendingMappingCount: 0,
            blockedCount: 0,
            invalidReadyCount: 1,
            readyAmountTotal: '3000',
          },
        ];
      },
      'accountingJournalStaging.findMany': async (args) => {
        const rows = [
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
        ];
        return rows.filter((row) => {
          const ids = args?.where?.id?.in;
          if (Array.isArray(ids) && !ids.includes(row.id)) return false;
          const status = args?.where?.status;
          if (status && row.status !== status) return false;
          if (Array.isArray(args?.where?.OR)) {
            return (
              !row.debitAccountCode ||
              !row.creditAccountCode ||
              !row.taxCode ||
              Number(row.amount) <= 0
            );
          }
          return true;
        });
      },
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
          ['(unassigned)', 'PRJ-001', 'PRJ-002', 'PRJ-003'],
        );
        assert.equal(body.accounting.byProject[1].pendingMappingCount, 1);
        assert.equal(body.accounting.byProject[2].blockedCount, 1);
        assert.equal(body.accounting.byProject[0].invalidReadyCount, 1);
        assert.equal(
          body.accounting.byProject[1].statutoryActualAmountTotal,
          '2100',
        );
        assert.equal(body.accounting.byProject[1].varianceAmount, '100');
        assert.equal(
          body.accounting.byProject[3].statutoryActualAmountTotal,
          '500',
        );
        assert.equal(body.accounting.byProject[3].varianceAmount, '500');
        assert.deepEqual(
          body.accounting.byDepartment.map((item) => item.key),
          ['(unassigned)', 'DEP-A', 'DEP-B', 'DEP-C'],
        );
        assert.equal(
          body.accounting.byDepartment[1].statutoryActualAmountTotal,
          '1800',
        );
        assert.equal(body.accounting.byDepartment[1].varianceAmount, '-200');
        assert.equal(
          body.accounting.byDepartment[3].statutoryActualAmountTotal,
          '750',
        );
        assert.equal(body.accounting.byDepartment[3].varianceAmount, '750');
        assert.equal(body.accounting.pendingMappingSamples[0].id, 'stg-002');
        assert.equal(body.accounting.blockedSamples[0].id, 'stg-003');
        assert.equal(body.accounting.invalidReadySamples[0].id, 'stg-004');
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/reconciliation/details returns 400 for invalid periodKey', async () => {
  const server = await buildServer({ logger: false });
  try {
    const res = await server.inject({
      method: 'GET',
      url: '/integrations/reconciliation/details?periodKey=2026-13',
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

test('GET /integrations/reconciliation/details returns empty details when prerequisites are missing', async () => {
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => null,
      'hrEmployeeMasterExportLog.findFirst': async () => null,
      'accountingIcsExportLog.findFirst': async () => null,
      'attendanceMonthlySummary.findMany': async () => [],
      'accountingJournalStaging.groupBy': async () => [],
      'accountingJournalStaging.aggregate': async () => ({
        _sum: { amount: null },
      }),
      'accountingJournalStaging.count': async () => 0,
      'accountingJournalStaging.findMany': async () => [],
      $queryRaw: async () => [],
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/reconciliation/details?periodKey=2026-07',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.periodKey, '2026-07');
        assert.equal(body.payroll.latestClosingId, null);
        assert.equal(body.payroll.latestEmployeeMasterFullExportId, null);
        assert.deepEqual(body.payroll.attendanceOnlyEmployeeCodes, []);
        assert.deepEqual(body.payroll.employeeMasterOnlyEmployeeCodes, []);
        assert.deepEqual(body.accounting.byProject, []);
        assert.deepEqual(body.accounting.byDepartment, []);
        assert.deepEqual(body.accounting.pendingMappingSamples, []);
        assert.deepEqual(body.accounting.blockedSamples, []);
        assert.deepEqual(body.accounting.invalidReadySamples, []);
      } finally {
        await server.close();
      }
    },
  );
});

test('GET /integrations/reconciliation/details exports statutory actual reconciliation as CSV', async () => {
  await withPrismaStubs(
    {
      'attendanceClosingPeriod.findFirst': async () => null,
      'hrEmployeeMasterExportLog.findFirst': async () => null,
      'accountingIcsExportLog.findFirst': async () => null,
      'attendanceMonthlySummary.findMany': async () => [],
      'accountingJournalStaging.groupBy': async () => [],
      'accountingJournalStaging.findMany': async () => [],
      'statutoryAccountingActual.groupBy': async (args) => {
        if (args?.by?.includes('projectCode')) {
          return [
            {
              projectCode: '=PRJ-CSV',
              currency: 'JPY',
              _count: { _all: 1 },
              _sum: { amount: '123' },
            },
          ];
        }
        if (args?.by?.includes('departmentCode')) {
          return [
            {
              departmentCode: 'DEP-CSV',
              currency: 'JPY',
              _count: { _all: 1 },
              _sum: { amount: '456' },
            },
          ];
        }
        return [];
      },
      $queryRaw: async (query) => {
        const sql = Array.isArray(query?.strings)
          ? query.strings.join(' ')
          : String(query);
        if (sql.includes('"readyDebitTotal"')) {
          return [
            {
              readyAmountTotal: '0',
              readyDebitTotal: '0',
              readyCreditTotal: '0',
            },
          ];
        }
        if (sql.includes('GROUP BY ajs."currency"')) {
          return [];
        }
        if (
          sql.includes('SELECT COUNT(*)::int AS "count"') ||
          sql.includes('SELECT ajs."id"') ||
          sql.includes('GROUP BY 1')
        ) {
          return [];
        }
        throw new Error(`unexpected $queryRaw: ${sql}`);
      },
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'GET',
          url: '/integrations/reconciliation/details?periodKey=2026-08&format=csv',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
        });
        assert.equal(res.statusCode, 200, res.body);
        assert.match(
          String(res.headers['content-type']),
          /text\/csv; charset=utf-8/,
        );
        assert.match(
          String(res.headers['content-disposition']),
          /integration-reconciliation-details-2026-08\.csv/,
        );
        assert.match(
          res.body,
          /section,key,currency,totalCount,readyCount,pendingMappingCount,blockedCount,invalidReadyCount,readyAmountTotal,statutoryActualAmountTotal,varianceAmount/,
        );
        assert.match(res.body, /project,'=PRJ-CSV,JPY,0,0,0,0,0,0,123,123/);
        assert.match(res.body, /department,DEP-CSV,JPY,0,0,0,0,0,0,456,456/);
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /integrations/accounting/statutory-actuals/import validates and persists rows', async () => {
  await withPrismaStubs(
    {
      'statutoryAccountingActualImportBatch.create': async (args) => {
        assert.equal(args?.data?.importBatchKey, 'statutory-actual-2026-06-v1');
        assert.equal(args.data.periodKey, '2026-06');
        assert.equal(args.data.accountingSystem, 'keiri-jokun-alpha');
        assert.equal(args.data.importedCount, 2);
        assert.equal(args.data.createdBy, 'admin-user');
        assert.equal(args.data.updatedBy, 'admin-user');
        return {};
      },
      'statutoryAccountingActual.createMany': async (args) => {
        assert.equal(args?.data?.length, 2);
        assert.equal(args.data[0].periodKey, '2026-06');
        assert.equal(
          args.data[0].importBatchKey,
          'statutory-actual-2026-06-v1',
        );
        assert.equal(args.data[0].rowNo, 1);
        assert.equal(args.data[0].accountingSystem, 'keiri-jokun-alpha');
        assert.equal(args.data[0].projectCode, 'PRJ-001');
        assert.equal(args.data[0].departmentCode, 'DEP-A');
        assert.equal(args.data[0].accountCode, '6100');
        assert.equal(args.data[0].amountType, 'direct_cost');
        assert.equal(args.data[0].currency, 'JPY');
        assert.equal(String(args.data[0].amount), '1200');
        assert.equal(args.data[0].createdBy, 'admin-user');
        assert.equal(args.data[0].updatedBy, 'admin-user');
        assert.equal(args.data[1].rowNo, 2);
        assert.equal(args.data[1].amountType, 'labor_cost');
        return { count: 2 };
      },
      'auditLog.create': async () => ({}),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const res = await server.inject({
          method: 'POST',
          url: '/integrations/accounting/statutory-actuals/import',
          headers: {
            'x-user-id': 'admin-user',
            'x-roles': 'admin',
          },
          payload: {
            periodKey: '2026-06',
            importBatchKey: 'statutory-actual-2026-06-v1',
            accountingSystem: 'keiri-jokun-alpha',
            rows: [
              {
                rowNo: 1,
                sourceRef: 'GL-001',
                projectCode: ' PRJ-001 ',
                departmentCode: 'DEP-A',
                accountCode: '6100',
                accountName: '外注費',
                amountType: 'direct_cost',
                currency: 'JPY',
                amount: '1200',
              },
              {
                rowNo: 2,
                departmentCode: 'DEP-A',
                accountCode: '6200',
                accountName: '労務費',
                amountType: 'labor_cost',
                currency: 'JPY',
                amount: 800,
              },
            ],
          },
        });
        assert.equal(res.statusCode, 201, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.periodKey, '2026-06');
        assert.equal(body.importBatchKey, 'statutory-actual-2026-06-v1');
        assert.equal(body.accountingSystem, 'keiri-jokun-alpha');
        assert.equal(body.importedCount, 2);
        assert.match(body.importedAt, /^\d{4}-\d{2}-\d{2}T/);
      } finally {
        await server.close();
      }
    },
  );
});

test('POST /integrations/accounting/statutory-actuals/import returns 400 for invalid rows', async () => {
  await withPrismaStubs({}, async () => {
    const server = await buildServer({ logger: false });
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/integrations/accounting/statutory-actuals/import',
        headers: {
          'x-user-id': 'admin-user',
          'x-roles': 'admin',
        },
        payload: {
          periodKey: '2026-06',
          importBatchKey: 'statutory-actual-2026-06-invalid',
          rows: [
            {
              rowNo: 1,
              accountCode: '6100',
              amountType: 'direct_cost',
              currency: 'JPY',
              amount: '1200',
            },
            {
              rowNo: 1,
              departmentCode: 'DEP-A',
              accountCode: '6200',
              amountType: 'labor_cost',
              currency: 'JPY',
              amount: '800',
            },
          ],
        },
      });
      assert.equal(res.statusCode, 400, res.body);
      const body = JSON.parse(res.body);
      assert.equal(body.error, 'invalid_statutory_accounting_actual_import');
      assert.ok(
        body.details.some(
          (item) =>
            item.field === 'projectCode' &&
            /projectCode or departmentCode/.test(item.message),
        ),
      );
      assert.ok(
        body.details.some(
          (item) =>
            item.field === 'rowNo' &&
            /unique within an import batch/.test(item.message),
        ),
      );
    } finally {
      await server.close();
    }
  });
});
