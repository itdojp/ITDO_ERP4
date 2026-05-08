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

type ReconciliationBaseData = {
  periodKey: string;
  latestClosing: AttendanceClosingSnapshot | null;
  attendanceEmployeeCodes: string[];
  latestEmployeeMasterExport: EmployeeMasterExportSnapshot | null;
  latestEmployeeMasterFullExport: EmployeeMasterExportSnapshot | null;
  latestIcsExport: AccountingExportSnapshot | null;
  stagingCounts: Array<{ status: string; _count: { _all: number } }>;
  readyAmountTotal: string;
  readyDebitTotal: string;
  readyCreditTotal: string;
  invalidReadyCount: number;
  latestStatutoryActualImport: {
    importBatchKey: string;
    accountingSystem: string;
    importedAt: Date;
  } | null;
  statutoryActualImportedCount: number;
  statutoryActualAmountTotal: string;
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
      | 'debit_credit_unbalanced'
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
    statutoryActuals: {
      latestImportBatchKey: string | null;
      latestAccountingSystem: string | null;
      latestImportedAt: Date | null;
      importedCount: number;
      amountTotal: string;
      internalReadyDebitTotal: string;
      varianceAmount: string | null;
      comparisonStatus: 'not_imported' | 'ok' | 'amount_mismatch';
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
  statutoryActualAmountTotal: string;
  varianceAmount: string;
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

function normalizeEmployeeCodesFromRows(
  rows: Array<{ employeeCode: string | null | undefined }>,
) {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const row of rows) {
    const normalized = row.employeeCode?.trim();
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

function areAmountsEqual(left: string, right: string) {
  try {
    return new Prisma.Decimal(left).equals(new Prisma.Decimal(right));
  } catch {
    return left === right;
  }
}

function addAmounts(left: string, right: string) {
  try {
    return new Prisma.Decimal(left).plus(new Prisma.Decimal(right)).toString();
  } catch {
    return String(Number(left || 0) + Number(right || 0));
  }
}

function subtractAmounts(left: string, right: string) {
  try {
    return new Prisma.Decimal(left).minus(new Prisma.Decimal(right)).toString();
  } catch {
    return String(Number(left || 0) - Number(right || 0));
  }
}

function normalizeBreakdownKey(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || '(unassigned)';
}

function withStatutoryActualBreakdownDefaults(
  row: Omit<
    ReconciliationBreakdownRow,
    'statutoryActualAmountTotal' | 'varianceAmount'
  > &
    Partial<
      Pick<
        ReconciliationBreakdownRow,
        'statutoryActualAmountTotal' | 'varianceAmount'
      >
    >,
): ReconciliationBreakdownRow {
  const statutoryActualAmountTotal = row.statutoryActualAmountTotal ?? '0';
  return {
    key: row.key,
    totalCount: Number(row.totalCount ?? 0),
    readyCount: Number(row.readyCount ?? 0),
    pendingMappingCount: Number(row.pendingMappingCount ?? 0),
    blockedCount: Number(row.blockedCount ?? 0),
    invalidReadyCount: Number(row.invalidReadyCount ?? 0),
    readyAmountTotal: toStringAmount(row.readyAmountTotal),
    statutoryActualAmountTotal,
    varianceAmount:
      row.varianceAmount ??
      subtractAmounts(
        statutoryActualAmountTotal,
        toStringAmount(row.readyAmountTotal),
      ),
  };
}

function buildActualBreakdownRows(
  internalRows: Array<
    Omit<
      ReconciliationBreakdownRow,
      'statutoryActualAmountTotal' | 'varianceAmount'
    > &
      Partial<
        Pick<
          ReconciliationBreakdownRow,
          'statutoryActualAmountTotal' | 'varianceAmount'
        >
      >
  >,
  actualRows: Array<{
    key: string;
    amountTotal: string;
  }>,
) {
  const rowsByKey = new Map<string, ReconciliationBreakdownRow>();
  for (const row of internalRows) {
    rowsByKey.set(row.key, withStatutoryActualBreakdownDefaults(row));
  }

  for (const actual of actualRows) {
    const key = normalizeBreakdownKey(actual.key);
    const existing =
      rowsByKey.get(key) ??
      withStatutoryActualBreakdownDefaults({
        key,
        totalCount: 0,
        readyCount: 0,
        pendingMappingCount: 0,
        blockedCount: 0,
        invalidReadyCount: 0,
        readyAmountTotal: '0',
      });
    existing.statutoryActualAmountTotal = addAmounts(
      existing.statutoryActualAmountTotal,
      actual.amountTotal,
    );
    existing.varianceAmount = subtractAmounts(
      existing.statutoryActualAmountTotal,
      existing.readyAmountTotal,
    );
    rowsByKey.set(key, existing);
  }

  return Array.from(rowsByKey.values()).sort((left, right) =>
    left.key.localeCompare(right.key),
  );
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

function buildIntegrationReconciliationSummaryFromBaseData(
  base: ReconciliationBaseData,
): ReconciliationSummary {
  const employeeMasterCodes = normalizeEmployeeCodeList(
    base.latestEmployeeMasterFullExport?.payload ?? null,
  );
  const employeeMasterCodeSet = new Set(employeeMasterCodes);
  const attendanceCodeSet = new Set(base.attendanceEmployeeCodes);
  const attendanceOnlyEmployeeCodes = base.attendanceEmployeeCodes.filter(
    (code) => !employeeMasterCodeSet.has(code),
  );
  const employeeMasterOnlyEmployeeCodes = employeeMasterCodes.filter(
    (code) => !attendanceCodeSet.has(code),
  );
  const matchedEmployeeCount = base.attendanceEmployeeCodes.filter((code) =>
    employeeMasterCodeSet.has(code),
  ).length;

  let payrollComparisonStatus: ReconciliationSummary['payroll']['comparisonStatus'];
  let payrollCountsAligned: boolean | null;
  if (!base.latestClosing) {
    payrollComparisonStatus = 'attendance_closing_missing';
    payrollCountsAligned = null;
  } else if (!base.latestEmployeeMasterFullExport) {
    payrollComparisonStatus = 'employee_master_full_export_missing';
    payrollCountsAligned = null;
  } else {
    payrollCountsAligned =
      attendanceOnlyEmployeeCodes.length === 0 &&
      employeeMasterOnlyEmployeeCodes.length === 0;
    payrollComparisonStatus = payrollCountsAligned ? 'ok' : 'mismatch';
  }

  const statusCountMap = new Map(
    base.stagingCounts.map((item) => [item.status, item._count._all]),
  );
  const readyCount = statusCountMap.get('ready') ?? 0;
  const pendingMappingCount = statusCountMap.get('pending_mapping') ?? 0;
  const blockedCount = statusCountMap.get('blocked') ?? 0;
  const totalCount = base.stagingCounts.reduce(
    (sum, item) => sum + item._count._all,
    0,
  );
  const mappingComplete = pendingMappingCount === 0 && blockedCount === 0;
  const debitCreditBalanced =
    base.invalidReadyCount === 0 &&
    areAmountsEqual(base.readyDebitTotal, base.readyCreditTotal);
  const statutoryActualComparisonStatus =
    base.statutoryActualImportedCount === 0
      ? 'not_imported'
      : areAmountsEqual(base.statutoryActualAmountTotal, base.readyDebitTotal)
        ? 'ok'
        : 'amount_mismatch';
  const statutoryActualVariance =
    base.statutoryActualImportedCount === 0
      ? null
      : subtractAmounts(base.statutoryActualAmountTotal, base.readyDebitTotal);

  let accountingComparisonStatus: ReconciliationSummary['accounting']['comparisonStatus'];
  let accountingCountsAligned: boolean | null;
  if (!mappingComplete) {
    accountingComparisonStatus = 'mapping_incomplete';
    accountingCountsAligned = null;
  } else if (base.invalidReadyCount > 0) {
    accountingComparisonStatus = 'ready_row_incomplete';
    accountingCountsAligned = false;
  } else if (!debitCreditBalanced) {
    accountingComparisonStatus = 'debit_credit_unbalanced';
    accountingCountsAligned = false;
  } else if (!base.latestIcsExport) {
    accountingComparisonStatus = 'export_missing';
    accountingCountsAligned = null;
  } else {
    accountingCountsAligned = base.latestIcsExport.exportedCount === readyCount;
    accountingComparisonStatus = accountingCountsAligned
      ? 'ok'
      : 'count_mismatch';
  }

  const hasBlockingDifferences =
    payrollComparisonStatus !== 'ok' ||
    accountingComparisonStatus !== 'ok' ||
    statutoryActualComparisonStatus !== 'ok';

  return {
    periodKey: base.periodKey,
    attendance: {
      latestClosing: base.latestClosing,
    },
    payroll: {
      latestEmployeeMasterExport: base.latestEmployeeMasterExport,
      latestEmployeeMasterFullExport: base.latestEmployeeMasterFullExport,
      comparisonStatus: payrollComparisonStatus,
      attendanceEmployeeCount: base.latestClosing
        ? base.attendanceEmployeeCodes.length
        : null,
      employeeMasterExportCount: base.latestEmployeeMasterFullExport
        ? employeeMasterCodes.length
        : null,
      matchedEmployeeCount:
        base.latestClosing && base.latestEmployeeMasterFullExport
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
      latestIcsExport: base.latestIcsExport,
      comparisonStatus: accountingComparisonStatus,
      latestExportedCount: base.latestIcsExport?.exportedCount ?? null,
      countsAligned: accountingCountsAligned,
      mappingComplete,
      staging: {
        totalCount,
        readyCount,
        pendingMappingCount,
        blockedCount,
        invalidReadyCount: base.invalidReadyCount,
        readyAmountTotal: base.readyAmountTotal,
        readyDebitTotal: base.readyDebitTotal,
        readyCreditTotal: base.readyCreditTotal,
        debitCreditBalanced,
      },
      statutoryActuals: {
        latestImportBatchKey:
          base.latestStatutoryActualImport?.importBatchKey ?? null,
        latestAccountingSystem:
          base.latestStatutoryActualImport?.accountingSystem ?? null,
        latestImportedAt: base.latestStatutoryActualImport?.importedAt ?? null,
        importedCount: base.statutoryActualImportedCount,
        amountTotal: base.statutoryActualAmountTotal,
        internalReadyDebitTotal: base.readyDebitTotal,
        varianceAmount: statutoryActualVariance,
        comparisonStatus: statutoryActualComparisonStatus,
      },
    },
    hasBlockingDifferences,
  };
}

async function fetchIntegrationReconciliationBaseData(options: {
  periodKey: string;
  client: ReconciliationClient;
}): Promise<ReconciliationBaseData> {
  const parsedPeriod = parseAttendancePeriodKey(options.periodKey);
  const periodKey = parsedPeriod.periodKey;
  const client = options.client;

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
    readyTotalsRows,
    invalidReadyCountRows,
    statutoryActualTotals,
    latestStatutoryActualImport,
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
    client.$queryRaw<
      Array<{
        readyAmountTotal: string | Prisma.Decimal | number | null;
        readyDebitTotal: string | Prisma.Decimal | number | null;
        readyCreditTotal: string | Prisma.Decimal | number | null;
      }>
    >(Prisma.sql`
      SELECT
        COALESCE(SUM(CASE WHEN ajs."status" = 'ready' THEN ajs."amount" ELSE 0 END), 0)::text AS "readyAmountTotal",
        COALESCE(SUM(
          CASE
            WHEN ajs."status" = 'ready'
              AND ajs."debitAccountCode" IS NOT NULL
              AND BTRIM(ajs."debitAccountCode") <> ''
            THEN ajs."amount"
            ELSE 0
          END
        ), 0)::text AS "readyDebitTotal",
        COALESCE(SUM(
          CASE
            WHEN ajs."status" = 'ready'
              AND ajs."creditAccountCode" IS NOT NULL
              AND BTRIM(ajs."creditAccountCode") <> ''
            THEN ajs."amount"
            ELSE 0
          END
        ), 0)::text AS "readyCreditTotal"
      FROM "AccountingJournalStaging" ajs
      INNER JOIN "AccountingEvent" ae ON ae."id" = ajs."eventId"
      WHERE ae."periodKey" = ${periodKey}
    `),
    client.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS "count"
      FROM "AccountingJournalStaging" ajs
      INNER JOIN "AccountingEvent" ae ON ae."id" = ajs."eventId"
      WHERE ae."periodKey" = ${periodKey}
        AND ajs."status" = 'ready'
        AND (
          (
            (ajs."debitAccountCode" IS NULL OR BTRIM(ajs."debitAccountCode") = '')
            AND (ajs."creditAccountCode" IS NULL OR BTRIM(ajs."creditAccountCode") = '')
          )
          OR ajs."taxCode" IS NULL OR BTRIM(ajs."taxCode") = ''
          OR ajs."amount" <= 0
        )
    `),
    client.statutoryAccountingActual.aggregate({
      where: { periodKey },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    client.statutoryAccountingActual.findFirst({
      where: { periodKey },
      select: {
        importBatchKey: true,
        accountingSystem: true,
        importedAt: true,
      },
      orderBy: [{ importedAt: 'desc' }, { id: 'desc' }],
    }),
  ]);

  return {
    periodKey,
    latestClosing,
    attendanceEmployeeCodes:
      normalizeEmployeeCodesFromRows(attendanceSummaries),
    latestEmployeeMasterExport,
    latestEmployeeMasterFullExport,
    latestIcsExport,
    stagingCounts,
    readyAmountTotal: toStringAmount(readyTotalsRows[0]?.readyAmountTotal),
    readyDebitTotal: toStringAmount(readyTotalsRows[0]?.readyDebitTotal),
    readyCreditTotal: toStringAmount(readyTotalsRows[0]?.readyCreditTotal),
    invalidReadyCount: Number(invalidReadyCountRows[0]?.count ?? 0),
    latestStatutoryActualImport,
    statutoryActualImportedCount: Number(
      statutoryActualTotals._count._all ?? 0,
    ),
    statutoryActualAmountTotal: toStringAmount(
      statutoryActualTotals._sum.amount,
    ),
  };
}

export async function buildIntegrationReconciliationSummary(options: {
  periodKey: string;
  client?: ReconciliationClient;
}): Promise<ReconciliationSummary> {
  const client = options.client ?? prisma;
  const base = await fetchIntegrationReconciliationBaseData({
    periodKey: options.periodKey,
    client,
  });
  return buildIntegrationReconciliationSummaryFromBaseData(base);
}

export async function buildIntegrationReconciliationDetails(options: {
  periodKey: string;
  client?: ReconciliationClient;
}): Promise<ReconciliationDetails> {
  const client = options.client ?? prisma;
  const base = await fetchIntegrationReconciliationBaseData({
    periodKey: options.periodKey,
    client,
  });
  const summary = buildIntegrationReconciliationSummaryFromBaseData(base);
  const employeeMasterCodes = normalizeEmployeeCodeList(
    base.latestEmployeeMasterFullExport?.payload ?? null,
  );
  const attendanceCodes = base.attendanceEmployeeCodes;
  const employeeMasterCodeSet = new Set(employeeMasterCodes);
  const attendanceCodeSet = new Set(attendanceCodes);

  const [
    byProject,
    byDepartment,
    pendingMappingRows,
    blockedRows,
    invalidReadyIds,
    statutoryActualsByProject,
    statutoryActualsByDepartment,
  ] = await Promise.all([
    client.$queryRaw<Array<ReconciliationBreakdownRow>>(Prisma.sql`
      SELECT
        COALESCE(NULLIF(BTRIM(ae."projectCode"), ''), '(unassigned)') AS "key",
        COUNT(*)::int AS "totalCount",
        COUNT(*) FILTER (WHERE ajs."status" = 'ready')::int AS "readyCount",
        COUNT(*) FILTER (WHERE ajs."status" = 'pending_mapping')::int AS "pendingMappingCount",
        COUNT(*) FILTER (WHERE ajs."status" = 'blocked')::int AS "blockedCount",
        COUNT(*) FILTER (
          WHERE ajs."status" = 'ready'
            AND (
              (
                (ajs."debitAccountCode" IS NULL OR BTRIM(ajs."debitAccountCode") = '')
                AND (ajs."creditAccountCode" IS NULL OR BTRIM(ajs."creditAccountCode") = '')
              )
              OR ajs."taxCode" IS NULL OR BTRIM(ajs."taxCode") = ''
              OR ajs."amount" <= 0
            )
        )::int AS "invalidReadyCount",
        COALESCE(SUM(CASE WHEN ajs."status" = 'ready' THEN ajs."amount" ELSE 0 END), 0)::text AS "readyAmountTotal"
      FROM "AccountingJournalStaging" ajs
      INNER JOIN "AccountingEvent" ae ON ae."id" = ajs."eventId"
      WHERE ae."periodKey" = ${summary.periodKey}
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    client.$queryRaw<Array<ReconciliationBreakdownRow>>(Prisma.sql`
      SELECT
        COALESCE(
          NULLIF(BTRIM(COALESCE(ajs."departmentCode", ae."departmentCode")), ''),
          '(unassigned)'
        ) AS "key",
        COUNT(*)::int AS "totalCount",
        COUNT(*) FILTER (WHERE ajs."status" = 'ready')::int AS "readyCount",
        COUNT(*) FILTER (WHERE ajs."status" = 'pending_mapping')::int AS "pendingMappingCount",
        COUNT(*) FILTER (WHERE ajs."status" = 'blocked')::int AS "blockedCount",
        COUNT(*) FILTER (
          WHERE ajs."status" = 'ready'
            AND (
              (
                (ajs."debitAccountCode" IS NULL OR BTRIM(ajs."debitAccountCode") = '')
                AND (ajs."creditAccountCode" IS NULL OR BTRIM(ajs."creditAccountCode") = '')
              )
              OR ajs."taxCode" IS NULL OR BTRIM(ajs."taxCode") = ''
              OR ajs."amount" <= 0
            )
        )::int AS "invalidReadyCount",
        COALESCE(SUM(CASE WHEN ajs."status" = 'ready' THEN ajs."amount" ELSE 0 END), 0)::text AS "readyAmountTotal"
      FROM "AccountingJournalStaging" ajs
      INNER JOIN "AccountingEvent" ae ON ae."id" = ajs."eventId"
      WHERE ae."periodKey" = ${summary.periodKey}
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    client.accountingJournalStaging.findMany({
      where: {
        event: { periodKey: summary.periodKey },
        status: 'pending_mapping',
      },
      orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
      take: MAX_RECONCILIATION_DETAIL_SAMPLE,
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
    client.accountingJournalStaging.findMany({
      where: { event: { periodKey: summary.periodKey }, status: 'blocked' },
      orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
      take: MAX_RECONCILIATION_DETAIL_SAMPLE,
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
    client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT ajs."id"
      FROM "AccountingJournalStaging" ajs
      INNER JOIN "AccountingEvent" ae ON ae."id" = ajs."eventId"
      WHERE ae."periodKey" = ${summary.periodKey}
        AND ajs."status" = 'ready'
        AND (
          (
            (ajs."debitAccountCode" IS NULL OR BTRIM(ajs."debitAccountCode") = '')
            AND (ajs."creditAccountCode" IS NULL OR BTRIM(ajs."creditAccountCode") = '')
          )
          OR ajs."taxCode" IS NULL OR BTRIM(ajs."taxCode") = ''
          OR ajs."amount" <= 0
        )
      ORDER BY ajs."entryDate" ASC, ajs."id" ASC
      LIMIT ${MAX_RECONCILIATION_DETAIL_SAMPLE}
    `),
    client.statutoryAccountingActual.groupBy({
      by: ['projectCode'],
      where: { periodKey: summary.periodKey },
      _sum: { amount: true },
      _count: { _all: true },
      orderBy: { projectCode: 'asc' },
    }),
    client.statutoryAccountingActual.groupBy({
      by: ['departmentCode'],
      where: { periodKey: summary.periodKey },
      _sum: { amount: true },
      _count: { _all: true },
      orderBy: { departmentCode: 'asc' },
    }),
  ]);

  const invalidReadyRows =
    invalidReadyIds.length === 0
      ? []
      : await client.accountingJournalStaging.findMany({
          where: { id: { in: invalidReadyIds.map((item) => item.id) } },
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
        });

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
      byProject: buildActualBreakdownRows(
        byProject,
        statutoryActualsByProject.map((row) => ({
          key: row.projectCode ?? '(unassigned)',
          amountTotal: toStringAmount(row._sum.amount),
        })),
      ),
      byDepartment: buildActualBreakdownRows(
        byDepartment,
        statutoryActualsByDepartment.map((row) => ({
          key: row.departmentCode ?? '(unassigned)',
          amountTotal: toStringAmount(row._sum.amount),
        })),
      ),
      pendingMappingSamples: pendingMappingRows.map(
        buildReconciliationSampleRow,
      ),
      blockedSamples: blockedRows.map(buildReconciliationSampleRow),
      invalidReadySamples: invalidReadyRows.map(buildReconciliationSampleRow),
    },
  };
}
