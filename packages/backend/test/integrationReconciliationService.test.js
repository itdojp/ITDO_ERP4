import assert from 'node:assert/strict';
import test from 'node:test';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;

const {
  buildIntegrationReconciliationDetailsCsv,
  buildIntegrationReconciliationDetailsCsvFilename,
  buildIntegrationReconciliationSummaryResponse,
} = await import('../dist/services/integrationReconciliation.js');

function buildExportLog(overrides = {}) {
  return {
    id: 'export-001',
    idempotencyKey: 'export-key',
    reexportOfId: null,
    status: 'success',
    updatedSince: null,
    exportedUntil: new Date('2026-08-31T15:00:00.000Z'),
    exportedCount: 2,
    startedAt: new Date('2026-08-31T15:00:00.000Z'),
    finishedAt: new Date('2026-08-31T15:00:05.000Z'),
    message: 'exported',
    ...overrides,
  };
}

test('buildIntegrationReconciliationSummaryResponse maps export logs without Fastify dependencies', () => {
  const latestClosing = {
    id: 'closing-001',
    periodKey: '2026-08',
    version: 1,
    status: 'closed',
    closedAt: new Date('2026-08-31T14:59:00.000Z'),
    summaryCount: 2,
    workedDayCountTotal: 40,
    scheduledWorkMinutesTotal: 19200,
    approvedWorkMinutesTotal: 19000,
    overtimeTotalMinutesTotal: 120,
    paidLeaveMinutesTotal: 480,
    unpaidLeaveMinutesTotal: 0,
    totalLeaveMinutesTotal: 480,
    sourceTimeEntryCount: 40,
    sourceLeaveRequestCount: 1,
  };
  const employeeMasterExport = buildExportLog({
    id: 'emp-any-001',
    idempotencyKey: 'emp-any-key',
    updatedSince: new Date('2026-08-01T00:00:00.000Z'),
    exportedCount: 3,
  });
  const employeeMasterFullExport = buildExportLog({
    id: 'emp-full-001',
    idempotencyKey: 'emp-full-key',
    updatedSince: null,
  });
  const accountingExport = {
    id: 'ics-001',
    idempotencyKey: 'ics-key',
    reexportOfId: 'ics-original',
    periodKey: '2026-08',
    status: 'success',
    exportedUntil: new Date('2026-08-31T15:10:00.000Z'),
    exportedCount: 4,
    startedAt: new Date('2026-08-31T15:10:00.000Z'),
    finishedAt: new Date('2026-08-31T15:10:05.000Z'),
    message: 'ics exported',
  };

  const response = buildIntegrationReconciliationSummaryResponse({
    periodKey: '2026-08',
    attendance: { latestClosing },
    payroll: {
      latestEmployeeMasterExport: employeeMasterExport,
      latestEmployeeMasterFullExport: employeeMasterFullExport,
      comparisonStatus: 'mismatch',
      attendanceEmployeeCount: 2,
      employeeMasterExportCount: 3,
      matchedEmployeeCount: 1,
      countsAligned: false,
      attendanceOnlyCount: 1,
      attendanceOnlyEmployeeCodes: ['EMP-001'],
      employeeMasterOnlyCount: 2,
      employeeMasterOnlyEmployeeCodes: ['EMP-003', 'EMP-004'],
    },
    accounting: {
      latestIcsExport: accountingExport,
      comparisonStatus: 'count_mismatch',
      latestExportedCount: 4,
      countsAligned: false,
      mappingComplete: true,
      staging: {
        totalCount: 3,
        readyCount: 2,
        pendingMappingCount: 0,
        blockedCount: 1,
        invalidReadyCount: 0,
        readyAmountTotal: '1200',
        readyDebitTotal: '1200',
        readyCreditTotal: '1200',
        debitCreditBalanced: true,
      },
      statutoryActuals: {
        latestImportBatchKey: 'batch-001',
        latestAccountingSystem: 'ics',
        latestImportedAt: new Date('2026-08-31T16:00:00.000Z'),
        importedCount: 3,
        currency: 'JPY',
        currencyCount: 1,
        amountTotal: '1000',
        internalReadyDebitTotal: '1200',
        varianceAmount: '-200',
        actualTotalsByCurrency: [
          { currency: 'JPY', amountTotal: '1000', count: 3 },
        ],
        readyDebitTotalsByCurrency: [
          { currency: 'JPY', amountTotal: '1200', count: 2 },
        ],
        comparisonStatus: 'amount_mismatch',
      },
    },
    hasBlockingDifferences: true,
  });

  assert.equal(response.periodKey, '2026-08');
  assert.equal(response.attendance.latestClosing, latestClosing);
  assert.deepEqual(response.payroll.latestEmployeeMasterExport, {
    id: 'emp-any-001',
    idempotencyKey: 'emp-any-key',
    reexportOfId: null,
    status: 'success',
    updatedSince: new Date('2026-08-01T00:00:00.000Z'),
    exportedUntil: new Date('2026-08-31T15:00:00.000Z'),
    exportedCount: 3,
    startedAt: new Date('2026-08-31T15:00:00.000Z'),
    finishedAt: new Date('2026-08-31T15:00:05.000Z'),
    message: 'exported',
  });
  assert.deepEqual(response.payroll.latestEmployeeMasterFullExport, {
    id: 'emp-full-001',
    idempotencyKey: 'emp-full-key',
    reexportOfId: null,
    status: 'success',
    updatedSince: null,
    exportedUntil: new Date('2026-08-31T15:00:00.000Z'),
    exportedCount: 2,
    startedAt: new Date('2026-08-31T15:00:00.000Z'),
    finishedAt: new Date('2026-08-31T15:00:05.000Z'),
    message: 'exported',
  });
  assert.deepEqual(response.accounting.latestIcsExport, accountingExport);
  assert.equal(response.hasBlockingDifferences, true);
});

test('buildIntegrationReconciliationDetailsCsv keeps stable sections and spreadsheet-safe cells', () => {
  const csv = buildIntegrationReconciliationDetailsCsv({
    periodKey: '2026-08',
    payroll: {
      latestClosingId: null,
      latestEmployeeMasterFullExportId: null,
      attendanceOnlyEmployeeCodes: [],
      employeeMasterOnlyEmployeeCodes: [],
    },
    accounting: {
      byProject: [
        {
          key: '=PROJECT()',
          currency: 'JPY',
          totalCount: 3,
          readyCount: 2,
          pendingMappingCount: 1,
          blockedCount: 0,
          invalidReadyCount: 0,
          readyAmountTotal: '1000',
          statutoryActualAmountTotal: '900',
          varianceAmount: '-100',
        },
      ],
      byDepartment: [
        {
          key: 'Dept,A',
          currency: '@JPY',
          totalCount: 1,
          readyCount: 1,
          pendingMappingCount: 0,
          blockedCount: 0,
          invalidReadyCount: 0,
          readyAmountTotal: '200',
          statutoryActualAmountTotal: '200',
          varianceAmount: '0',
        },
      ],
      pendingMappingSamples: [],
      blockedSamples: [],
      invalidReadySamples: [],
    },
  });

  assert.equal(
    csv.split('\n')[0],
    'section,key,currency,totalCount,readyCount,pendingMappingCount,blockedCount,invalidReadyCount,readyAmountTotal,statutoryActualAmountTotal,varianceAmount',
  );
  assert.match(csv, /^project,'=PROJECT\(\),JPY,3,2,1,0,0,1000,900,'-100$/m);
  assert.match(csv, /^department,"Dept,A",'@JPY,1,1,0,0,0,200,200,0$/m);
  assert.equal(
    buildIntegrationReconciliationDetailsCsvFilename('2026-08'),
    'integration-reconciliation-details-2026-08.csv',
  );
});
