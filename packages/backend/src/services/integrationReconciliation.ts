import { IntegrationRunStatus, Prisma } from '@prisma/client';
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

type ReconciliationBreakdownRow = {
  key: string;
  totalCount: number;
  readyCount: number;
  pendingMappingCount: number;
  blockedCount: number;
  invalidReadyCount: number;
  readyAmountTotal: string;
};

type ReconciliationSampleRow = {
  id: string;
  eventId: string;
  sourceTable: string;
  sourceId: string;
  status: string;
  mappingKey: string | null;
  description: string | null;
  projectCode: string | null;
  departmentCode: string | null;
  debitAccountCode: string | null;
  creditAccountCode: string | null;
  taxCode: string | null;
  amount: string;
};

type ReconciliationDetails = {
  periodKey: string;
  payroll: {
    latestClosingId: string | null;
    latestEmployeeMasterFullExportId: string | null;
    attendanceOnlyEmployeeCodes: string[];
    employeeMasterOnlyEmployeeCodes: string[];
  };
  accounting: {
    byProject: ReconciliationBreakdownRow[];
    byDepartment: ReconciliationBreakdownRow[];
    pendingMappingSamples: ReconciliationSampleRow[];
    blockedSamples: ReconciliationSampleRow[];
    invalidReadySamples: ReconciliationSampleRow[];
  };
};

const MAX_EMPLOYEE_CODE_SAMPLE = 20;
const MAX_RECONCILIATION_DETAIL_SAMPLE = 20;

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

function isReadyRowIncomplete(row: {
  status: string;
  debitAccountCode: string | null;
  creditAccountCode: string | null;
  taxCode: string | null;
  amount: Prisma.Decimal | number | string | null;
}) {
  if (row.status !== 'ready') return false;
  if (!row.debitAccountCode) return true;
  if (!row.creditAccountCode) return true;
  if (!row.taxCode) return true;
  return new Prisma.Decimal(row.amount ?? 0).lte(0);
}

function normalizeBreakdownKey(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : '(unassigned)';
}

function ensureBreakdownRow(
  map: Map<string, ReconciliationBreakdownRow>,
  key: string,
) {
  let row = map.get(key);
  if (!row) {
    row = {
      key,
      totalCount: 0,
      readyCount: 0,
      pendingMappingCount: 0,
      blockedCount: 0,
      invalidReadyCount: 0,
      readyAmountTotal: '0',
    };
    map.set(key, row);
  }
  return row;
}

function buildReconciliationSampleRow(row: {
  id: string;
  eventId: string;
  status: string;
  mappingKey: string | null;
  description: string | null;
  debitAccountCode: string | null;
  creditAccountCode: string | null;
  taxCode: string | null;
  amount: Prisma.Decimal | number | string | null;
  event: {
    sourceTable: string;
    sourceId: string;
    projectCode: string | null;
    departmentCode: string | null;
  };
  departmentCode: string | null;
}): ReconciliationSampleRow {
  return {
    id: row.id,
    eventId: row.eventId,
    sourceTable: row.event.sourceTable,
    sourceId: row.event.sourceId,
    status: row.status,
    mappingKey: row.mappingKey,
    description: row.description,
    projectCode: row.event.projectCode,
    departmentCode: row.departmentCode ?? row.event.departmentCode,
    debitAccountCode: row.debitAccountCode,
    creditAccountCode: row.creditAccountCode,
    taxCode: row.taxCode,
    amount: toStringAmount(row.amount),
  };
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

export async function buildIntegrationReconciliationDetails(options: {
  periodKey: string;
  client?: ReconciliationClient;
}): Promise<ReconciliationDetails> {
  const client = options.client ?? prisma;
  const summary = await buildIntegrationReconciliationSummary({
    periodKey: options.periodKey,
    client,
  });

  const [attendanceSummaries, stagingRows] = await Promise.all([
    summary.attendance.latestClosing
      ? client.attendanceMonthlySummary.findMany({
          where: { closingPeriodId: summary.attendance.latestClosing.id },
          select: { employeeCode: true },
          orderBy: [{ employeeCode: 'asc' }, { id: 'asc' }],
        })
      : [],
    client.accountingJournalStaging.findMany({
      where: { event: { periodKey: summary.periodKey } },
      orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        eventId: true,
        status: true,
        mappingKey: true,
        description: true,
        debitAccountCode: true,
        creditAccountCode: true,
        taxCode: true,
        amount: true,
        departmentCode: true,
        event: {
          select: {
            sourceTable: true,
            sourceId: true,
            projectCode: true,
            departmentCode: true,
          },
        },
      },
    }),
  ]);

  const attendanceCodes = attendanceSummaries
    .map((item) => item.employeeCode.trim())
    .filter((item) => item.length > 0)
    .sort((a, b) => a.localeCompare(b));
  const employeeMasterCodes = normalizeEmployeeCodeList(
    summary.payroll.latestEmployeeMasterFullExport?.payload ?? null,
  );
  const employeeMasterCodeSet = new Set(employeeMasterCodes);
  const attendanceCodeSet = new Set(attendanceCodes);

  const byProjectMap = new Map<string, ReconciliationBreakdownRow>();
  const byDepartmentMap = new Map<string, ReconciliationBreakdownRow>();
  const pendingMappingSamples: ReconciliationSampleRow[] = [];
  const blockedSamples: ReconciliationSampleRow[] = [];
  const invalidReadySamples: ReconciliationSampleRow[] = [];

  for (const row of stagingRows) {
    const projectKey = normalizeBreakdownKey(row.event.projectCode);
    const departmentKey = normalizeBreakdownKey(
      row.departmentCode ?? row.event.departmentCode,
    );
    const projectBreakdown = ensureBreakdownRow(byProjectMap, projectKey);
    const departmentBreakdown = ensureBreakdownRow(
      byDepartmentMap,
      departmentKey,
    );
    const invalidReady = isReadyRowIncomplete(row);
    const amount = new Prisma.Decimal(row.amount ?? 0);

    for (const breakdown of [projectBreakdown, departmentBreakdown]) {
      breakdown.totalCount += 1;
      if (row.status === 'ready') {
        breakdown.readyCount += 1;
        breakdown.readyAmountTotal = new Prisma.Decimal(
          breakdown.readyAmountTotal,
        )
          .plus(amount)
          .toString();
      }
      if (row.status === 'pending_mapping') breakdown.pendingMappingCount += 1;
      if (row.status === 'blocked') breakdown.blockedCount += 1;
      if (invalidReady) breakdown.invalidReadyCount += 1;
    }

    if (
      row.status === 'pending_mapping' &&
      pendingMappingSamples.length < MAX_RECONCILIATION_DETAIL_SAMPLE
    ) {
      pendingMappingSamples.push(buildReconciliationSampleRow(row));
    }
    if (
      row.status === 'blocked' &&
      blockedSamples.length < MAX_RECONCILIATION_DETAIL_SAMPLE
    ) {
      blockedSamples.push(buildReconciliationSampleRow(row));
    }
    if (
      invalidReady &&
      invalidReadySamples.length < MAX_RECONCILIATION_DETAIL_SAMPLE
    ) {
      invalidReadySamples.push(buildReconciliationSampleRow(row));
    }
  }

  return {
    periodKey: summary.periodKey,
    payroll: {
      latestClosingId: summary.attendance.latestClosing?.id ?? null,
      latestEmployeeMasterFullExportId:
        summary.payroll.latestEmployeeMasterFullExport?.id ?? null,
      attendanceOnlyEmployeeCodes: attendanceCodes.filter(
        (code) => !employeeMasterCodeSet.has(code),
      ),
      employeeMasterOnlyEmployeeCodes: employeeMasterCodes.filter(
        (code) => !attendanceCodeSet.has(code),
      ),
    },
    accounting: {
      byProject: [...byProjectMap.values()].sort((a, b) =>
        a.key.localeCompare(b.key),
      ),
      byDepartment: [...byDepartmentMap.values()].sort((a, b) =>
        a.key.localeCompare(b.key),
      ),
      pendingMappingSamples,
      blockedSamples,
      invalidReadySamples,
    },
  };
}
