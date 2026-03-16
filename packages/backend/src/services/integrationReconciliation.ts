import { IntegrationRunStatus, type Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { parseAttendancePeriodKey } from './attendanceClosings.js';

type ReconciliationClient = Prisma.TransactionClient | typeof prisma;

type AttendanceClosingSnapshot = {
  id: string;
  periodKey: string;
  version: number;
  status: string;
  closedAt: Date;
  summaryCount: number;
  workedDayCountTotal: number;
  scheduledWorkMinutesTotal: number;
  approvedWorkMinutesTotal: number;
  overtimeTotalMinutesTotal: number;
  paidLeaveMinutesTotal: number;
  unpaidLeaveMinutesTotal: number;
  totalLeaveMinutesTotal: number;
  sourceTimeEntryCount: number;
  sourceLeaveRequestCount: number;
};

type EmployeeMasterExportSnapshot = {
  id: string;
  idempotencyKey: string;
  reexportOfId: string | null;
  status: IntegrationRunStatus;
  updatedSince: Date | null;
  exportedUntil: Date;
  exportedCount: number;
  startedAt: Date;
  finishedAt: Date | null;
  message: string | null;
  payload: Prisma.JsonValue | null;
};

type AccountingExportSnapshot = {
  id: string;
  idempotencyKey: string;
  reexportOfId: string | null;
  periodKey: string | null;
  status: IntegrationRunStatus;
  exportedUntil: Date;
  exportedCount: number;
  startedAt: Date;
  finishedAt: Date | null;
  message: string | null;
};

type ReconciliationSummary = {
  periodKey: string;
  attendance: {
    latestClosing: AttendanceClosingSnapshot | null;
  };
  payroll: {
    latestEmployeeMasterExport: EmployeeMasterExportSnapshot | null;
    latestEmployeeMasterFullExport: EmployeeMasterExportSnapshot | null;
    comparisonStatus:
      | 'ok'
      | 'attendance_closing_missing'
      | 'employee_master_full_export_missing'
      | 'mismatch';
    attendanceEmployeeCount: number | null;
    employeeMasterExportCount: number | null;
    matchedEmployeeCount: number | null;
    countsAligned: boolean | null;
    attendanceOnlyCount: number;
    attendanceOnlyEmployeeCodes: string[];
    employeeMasterOnlyCount: number;
    employeeMasterOnlyEmployeeCodes: string[];
  };
  accounting: {
    latestIcsExport: AccountingExportSnapshot | null;
    comparisonStatus:
      | 'ok'
      | 'export_missing'
      | 'mapping_incomplete'
      | 'ready_row_incomplete'
      | 'count_mismatch';
    latestExportedCount: number | null;
    countsAligned: boolean | null;
    mappingComplete: boolean;
    staging: {
      totalCount: number;
      readyCount: number;
      pendingMappingCount: number;
      blockedCount: number;
      invalidReadyCount: number;
      readyAmountTotal: string;
      readyDebitTotal: string;
      readyCreditTotal: string;
      debitCreditBalanced: boolean;
    };
  };
  hasBlockingDifferences: boolean;
};

const MAX_EMPLOYEE_CODE_SAMPLE = 20;

function normalizeEmployeeCodeList(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const items = (value as Record<string, Prisma.JsonValue>).items;
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const code = (item as Record<string, Prisma.JsonValue>).employeeCode;
    if (typeof code !== 'string') continue;
    const normalized = code.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    codes.push(normalized);
  }
  return codes.sort((a, b) => a.localeCompare(b));
}

function toStringAmount(
  value: Prisma.Decimal | number | string | null | undefined,
) {
  if (value === null || value === undefined) return '0';
  return String(value);
}

export async function buildIntegrationReconciliationSummary(options: {
  periodKey: string;
  client?: ReconciliationClient;
}): Promise<ReconciliationSummary> {
  const client = options.client ?? prisma;
  const parsedPeriod = parseAttendancePeriodKey(options.periodKey);
  const periodKey = parsedPeriod.periodKey;

  const latestClosing = await client.attendanceClosingPeriod.findFirst({
    where: { periodKey, status: 'closed' },
    select: {
      id: true,
      periodKey: true,
      version: true,
      status: true,
      closedAt: true,
      summaryCount: true,
      workedDayCountTotal: true,
      scheduledWorkMinutesTotal: true,
      approvedWorkMinutesTotal: true,
      overtimeTotalMinutesTotal: true,
      paidLeaveMinutesTotal: true,
      unpaidLeaveMinutesTotal: true,
      totalLeaveMinutesTotal: true,
      sourceTimeEntryCount: true,
      sourceLeaveRequestCount: true,
    },
    orderBy: [{ version: 'desc' }, { closedAt: 'desc' }, { id: 'desc' }],
  });

  const [
    attendanceSummaries,
    latestEmployeeMasterExport,
    latestEmployeeMasterFullExport,
    latestIcsExport,
    stagingCounts,
    readyAmountAggregate,
    invalidReadyCount,
  ] = await Promise.all([
    latestClosing
      ? client.attendanceMonthlySummary.findMany({
          where: { closingPeriodId: latestClosing.id },
          select: { employeeCode: true },
          orderBy: [{ employeeCode: 'asc' }, { id: 'asc' }],
        })
      : [],
    client.hrEmployeeMasterExportLog.findFirst({
      where: { status: 'success' },
      select: {
        id: true,
        idempotencyKey: true,
        reexportOfId: true,
        status: true,
        updatedSince: true,
        exportedUntil: true,
        exportedCount: true,
        startedAt: true,
        finishedAt: true,
        message: true,
        payload: true,
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    }),
    client.hrEmployeeMasterExportLog.findFirst({
      where: { status: 'success', updatedSince: null },
      select: {
        id: true,
        idempotencyKey: true,
        reexportOfId: true,
        status: true,
        updatedSince: true,
        exportedUntil: true,
        exportedCount: true,
        startedAt: true,
        finishedAt: true,
        message: true,
        payload: true,
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    }),
    client.accountingIcsExportLog.findFirst({
      where: { status: 'success', periodKey },
      select: {
        id: true,
        idempotencyKey: true,
        reexportOfId: true,
        periodKey: true,
        status: true,
        exportedUntil: true,
        exportedCount: true,
        startedAt: true,
        finishedAt: true,
        message: true,
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    }),
    client.accountingJournalStaging.groupBy({
      by: ['status'],
      where: { event: { periodKey } },
      _count: { _all: true },
    }),
    client.accountingJournalStaging.aggregate({
      where: { event: { periodKey }, status: 'ready' },
      _sum: { amount: true },
    }),
    client.accountingJournalStaging.count({
      where: {
        event: { periodKey },
        status: 'ready',
        OR: [
          { debitAccountCode: null },
          { debitAccountCode: '' },
          { creditAccountCode: null },
          { creditAccountCode: '' },
          { taxCode: null },
          { taxCode: '' },
          { amount: { lte: 0 } },
        ],
      },
    }),
  ]);

  const attendanceEmployeeCodes = attendanceSummaries
    .map((item) => item.employeeCode.trim())
    .filter((item) => item.length > 0)
    .sort((a, b) => a.localeCompare(b));
  const employeeMasterCodes = normalizeEmployeeCodeList(
    latestEmployeeMasterFullExport?.payload ?? null,
  );
  const employeeMasterCodeSet = new Set(employeeMasterCodes);
  const attendanceCodeSet = new Set(attendanceEmployeeCodes);
  const attendanceOnlyEmployeeCodes = attendanceEmployeeCodes.filter(
    (code) => !employeeMasterCodeSet.has(code),
  );
  const employeeMasterOnlyEmployeeCodes = employeeMasterCodes.filter(
    (code) => !attendanceCodeSet.has(code),
  );
  const matchedEmployeeCount = attendanceEmployeeCodes.filter((code) =>
    employeeMasterCodeSet.has(code),
  ).length;

  let payrollComparisonStatus: ReconciliationSummary['payroll']['comparisonStatus'];
  let payrollCountsAligned: boolean | null;
  if (!latestClosing) {
    payrollComparisonStatus = 'attendance_closing_missing';
    payrollCountsAligned = null;
  } else if (!latestEmployeeMasterFullExport) {
    payrollComparisonStatus = 'employee_master_full_export_missing';
    payrollCountsAligned = null;
  } else {
    payrollCountsAligned =
      attendanceOnlyEmployeeCodes.length === 0 &&
      employeeMasterOnlyEmployeeCodes.length === 0;
    payrollComparisonStatus = payrollCountsAligned ? 'ok' : 'mismatch';
  }

  const statusCountMap = new Map(
    stagingCounts.map((item) => [item.status, item._count._all]),
  );
  const readyCount = statusCountMap.get('ready') ?? 0;
  const pendingMappingCount = statusCountMap.get('pending_mapping') ?? 0;
  const blockedCount = statusCountMap.get('blocked') ?? 0;
  const totalCount = stagingCounts.reduce(
    (sum, item) => sum + item._count._all,
    0,
  );
  const readyAmountTotal = toStringAmount(
    readyAmountAggregate._sum.amount ?? 0,
  );
  const mappingComplete = pendingMappingCount === 0 && blockedCount === 0;
  const debitCreditBalanced = invalidReadyCount === 0;

  let accountingComparisonStatus: ReconciliationSummary['accounting']['comparisonStatus'];
  let accountingCountsAligned: boolean | null;
  if (!mappingComplete) {
    accountingComparisonStatus = 'mapping_incomplete';
    accountingCountsAligned = null;
  } else if (invalidReadyCount > 0) {
    accountingComparisonStatus = 'ready_row_incomplete';
    accountingCountsAligned = false;
  } else if (!latestIcsExport) {
    accountingComparisonStatus = 'export_missing';
    accountingCountsAligned = null;
  } else {
    accountingCountsAligned = latestIcsExport.exportedCount === readyCount;
    accountingComparisonStatus = accountingCountsAligned
      ? 'ok'
      : 'count_mismatch';
  }

  const hasBlockingDifferences =
    payrollComparisonStatus !== 'ok' || accountingComparisonStatus !== 'ok';

  return {
    periodKey,
    attendance: {
      latestClosing,
    },
    payroll: {
      latestEmployeeMasterExport,
      latestEmployeeMasterFullExport,
      comparisonStatus: payrollComparisonStatus,
      attendanceEmployeeCount: latestClosing
        ? attendanceEmployeeCodes.length
        : null,
      employeeMasterExportCount: latestEmployeeMasterFullExport
        ? employeeMasterCodes.length
        : null,
      matchedEmployeeCount:
        latestClosing && latestEmployeeMasterFullExport
          ? matchedEmployeeCount
          : null,
      countsAligned: payrollCountsAligned,
      attendanceOnlyCount: attendanceOnlyEmployeeCodes.length,
      attendanceOnlyEmployeeCodes: attendanceOnlyEmployeeCodes.slice(
        0,
        MAX_EMPLOYEE_CODE_SAMPLE,
      ),
      employeeMasterOnlyCount: employeeMasterOnlyEmployeeCodes.length,
      employeeMasterOnlyEmployeeCodes: employeeMasterOnlyEmployeeCodes.slice(
        0,
        MAX_EMPLOYEE_CODE_SAMPLE,
      ),
    },
    accounting: {
      latestIcsExport,
      comparisonStatus: accountingComparisonStatus,
      latestExportedCount: latestIcsExport?.exportedCount ?? null,
      countsAligned: accountingCountsAligned,
      mappingComplete,
      staging: {
        totalCount,
        readyCount,
        pendingMappingCount,
        blockedCount,
        invalidReadyCount,
        readyAmountTotal,
        readyDebitTotal: readyAmountTotal,
        readyCreditTotal: readyAmountTotal,
        debitCreditBalanced,
      },
    },
    hasBlockingDifferences,
  };
}
