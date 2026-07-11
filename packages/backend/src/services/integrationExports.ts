import { createHash } from 'node:crypto';
import { IntegrationRunStatus, Prisma } from '@prisma/client';
import { prisma as defaultPrisma } from './db.js';
import { type AuditContext, logAudit as defaultLogAudit } from './audit.js';
import {
  AttendanceClosingError,
  parseAttendancePeriodKey,
} from './attendanceClosings.js';
import {
  AccountingIcsExportError,
  type AccountingIcsExportPayload,
  type AccountingIcsTemplateOptions,
  buildAccountingIcsExportPayload,
  buildAccountingIcsExportRequestHash,
} from './accountingIcsExport.js';
import { toCsv } from '../utils/csv.js';

type IntegrationExportPrisma = typeof defaultPrisma;
type IntegrationExportAuditLogger = typeof defaultLogAudit;

type IntegrationExportDependencies = {
  prisma?: IntegrationExportPrisma;
  logAudit?: IntegrationExportAuditLogger;
};

function resolveDependencies(deps: IntegrationExportDependencies = {}) {
  return {
    prisma: deps.prisma ?? defaultPrisma,
    logAudit: deps.logAudit ?? defaultLogAudit,
  };
}

export class IntegrationExportDispatchError extends Error {
  code: string;
  statusCode: number;
  responseBody: Record<string, unknown>;

  constructor(
    code: string,
    responseBody: Record<string, unknown>,
    statusCode = 409,
  ) {
    super(code);
    this.name = 'IntegrationExportDispatchError';
    this.code = code;
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

function parseBoundedInteger(
  input: unknown,
  defaultValue: number,
  maxValue: number,
) {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.min(maxValue, Math.max(1, Math.floor(input)));
  }
  if (typeof input === 'string' && input.trim().length > 0) {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) {
      return Math.min(maxValue, Math.max(1, Math.floor(parsed)));
    }
  }
  return defaultValue;
}

function parseBoundedNonNegativeInteger(
  input: unknown,
  defaultValue: number,
  maxValue: number,
) {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.min(maxValue, Math.max(0, Math.floor(input)));
  }
  if (typeof input === 'string' && input.trim().length > 0) {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) {
      return Math.min(maxValue, Math.max(0, Math.floor(parsed)));
    }
  }
  return defaultValue;
}

function parseUpdatedSince(raw?: string) {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function truncateForAudit(value: unknown) {
  if (value === null || value === undefined) return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length <= 500) return text;
  return `${text.slice(0, 500)}...`;
}

export type HrEmployeeMasterExportFormat = 'json' | 'csv';

const DEFAULT_EMPLOYEE_MASTER_EXPORT_LIMIT = 500;
const MAX_EMPLOYEE_MASTER_EXPORT_LIMIT = 2000;
export const DEFAULT_EMPLOYEE_MASTER_EXPORT_LOG_LIMIT = 100;
export const MAX_EMPLOYEE_MASTER_EXPORT_LOG_LIMIT = 1000;
export const MAX_EMPLOYEE_MASTER_EXPORT_OFFSET = 100000;
const HR_EMPLOYEE_MASTER_EXPORT_SCHEMA_VERSION = 'rakuda_employee_master_v1';
const HR_EMPLOYEE_MASTER_EXPORT_HEADERS = [
  'employeeCode',
  'loginId',
  'externalIdentityId',
  'displayName',
  'familyName',
  'givenName',
  'activeFlag',
  'employmentType',
  'joinDate',
  'leaveDate',
  'departmentName',
  'organizationName',
  'managerEmployeeCode',
  'departmentCode',
  'payrollType',
  'closingType',
  'paymentType',
  'titleCode',
  'email',
  'phone',
] as const;

type HrEmployeeMasterExportItem = Record<
  (typeof HR_EMPLOYEE_MASTER_EXPORT_HEADERS)[number],
  string
>;

export type HrEmployeeMasterExportPayload = {
  schemaVersion: typeof HR_EMPLOYEE_MASTER_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  exportedUntil: string;
  updatedSince: string | null;
  limit: number;
  offset: number;
  exportedCount: number;
  headers: string[];
  items: HrEmployeeMasterExportItem[];
};

export class HrEmployeeMasterExportError extends Error {
  code: string;
  details?: Prisma.InputJsonValue;

  constructor(code: string, message: string, details?: Prisma.InputJsonValue) {
    super(message);
    this.name = 'HrEmployeeMasterExportError';
    this.code = code;
    this.details = details;
  }
}

function normalizeHrEmployeeMasterFormat(
  value: unknown,
): HrEmployeeMasterExportFormat {
  return value === 'csv' ? 'csv' : 'json';
}

function formatDateOnly(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : '';
}

function normalizePlainText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function pickPrimaryMultiValue(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) return '';
  const normalized = value
    .map((item) => {
      if (typeof item === 'string') {
        return {
          value: item.trim(),
          primary: false,
        };
      }
      if (
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        typeof item.value === 'string'
      ) {
        return {
          value: item.value.trim(),
          primary: item.primary === true,
        };
      }
      return null;
    })
    .filter((item): item is { value: string; primary: boolean } => !!item)
    .filter((item) => item.value.length > 0);
  if (!normalized.length) return '';
  return normalized.find((item) => item.primary)?.value ?? normalized[0].value;
}

function buildEmployeeMasterDisplayName(input: {
  displayName?: string | null;
  familyName?: string | null;
  givenName?: string | null;
  userName: string;
}) {
  const displayName = normalizePlainText(input.displayName);
  if (displayName) return displayName;
  const familyName = normalizePlainText(input.familyName);
  const givenName = normalizePlainText(input.givenName);
  const joined = [familyName, givenName].filter((item) => item.length > 0);
  if (joined.length > 0) {
    return joined.join(' ');
  }
  return input.userName.trim();
}

export function parseHrEmployeeMasterExportQuery(query: {
  format?: HrEmployeeMasterExportFormat;
  updatedSince?: string;
  limit?: number | string;
  offset?: number | string;
}) {
  const since = parseUpdatedSince(query.updatedSince);
  if (since === null) {
    return { ok: false as const };
  }
  return {
    ok: true as const,
    format: normalizeHrEmployeeMasterFormat(query.format),
    updatedSince: since,
    limit: parseBoundedInteger(
      query.limit,
      DEFAULT_EMPLOYEE_MASTER_EXPORT_LIMIT,
      MAX_EMPLOYEE_MASTER_EXPORT_LIMIT,
    ),
    offset: parseBoundedNonNegativeInteger(
      query.offset,
      0,
      MAX_EMPLOYEE_MASTER_EXPORT_OFFSET,
    ),
  };
}

export function buildHrEmployeeMasterExportRequestHash(input: {
  updatedSince: string | null;
  limit: number;
  offset: number;
  format: 'csv';
}) {
  return createHash('sha256')
    .update(JSON.stringify(input), 'utf8')
    .digest('hex');
}

export async function buildHrEmployeeMasterExportPayload(
  input: {
    updatedSince?: Date;
    exportedUntil?: Date;
    limit: number;
    offset: number;
  },
  deps: IntegrationExportDependencies = {},
): Promise<HrEmployeeMasterExportPayload> {
  const { prisma } = resolveDependencies(deps);
  const exportedUntil = input.exportedUntil ?? new Date();
  const userWhere = input.updatedSince
    ? {
        OR: [
          {
            updatedAt: {
              gt: input.updatedSince,
              lte: exportedUntil,
            },
          },
          {
            payrollProfile: {
              is: {
                updatedAt: {
                  gt: input.updatedSince,
                  lte: exportedUntil,
                },
              },
            },
          },
        ],
      }
    : undefined;
  const users = await prisma.userAccount.findMany({
    where: userWhere,
    select: {
      id: true,
      externalId: true,
      employeeCode: true,
      userName: true,
      displayName: true,
      familyName: true,
      givenName: true,
      active: true,
      employmentType: true,
      joinedAt: true,
      leftAt: true,
      department: true,
      organization: true,
      managerUserId: true,
      emails: true,
      phoneNumbers: true,
      payrollProfile: {
        select: {
          payrollType: true,
          closingType: true,
          paymentType: true,
          titleCode: true,
          departmentCode: true,
        },
      },
    },
    orderBy: [{ employeeCode: 'asc' }, { id: 'asc' }],
    take: input.limit,
    skip: input.offset,
  });
  const managerIds = Array.from(
    new Set(
      users
        .map((user) => normalizePlainText(user.managerUserId))
        .filter((item) => item.length > 0),
    ),
  );
  const managers = managerIds.length
    ? await prisma.userAccount.findMany({
        where: {
          id: {
            in: managerIds,
          },
        },
        select: {
          id: true,
          employeeCode: true,
        },
      })
    : [];
  const managerEmployeeCodeById = new Map(
    managers.map((manager) => [
      manager.id,
      normalizePlainText(manager.employeeCode),
    ]),
  );

  const items = users.map((user) => {
    const employeeCode = normalizePlainText(user.employeeCode);
    if (!employeeCode) {
      throw new HrEmployeeMasterExportError(
        'employee_master_employee_code_missing',
        'employeeCode is required for payroll employee master export',
        {
          userId: user.id,
          userName: user.userName,
        } as Prisma.InputJsonValue,
      );
    }
    const managerUserId = normalizePlainText(user.managerUserId);
    const managerEmployeeCode = managerUserId
      ? (managerEmployeeCodeById.get(managerUserId) ?? '')
      : '';
    if (managerUserId && !managerEmployeeCode) {
      const managerResolutionStatus = managerEmployeeCodeById.has(managerUserId)
        ? 'employee_code_missing'
        : 'manager_not_found';
      throw new HrEmployeeMasterExportError(
        'employee_master_manager_employee_code_missing',
        'managerEmployeeCode could not be resolved when managerUserId is set for payroll employee master export',
        {
          userId: user.id,
          userName: user.userName,
          managerUserId,
          managerResolutionStatus,
        } as Prisma.InputJsonValue,
      );
    }
    return {
      employeeCode,
      loginId: user.userName,
      externalIdentityId: normalizePlainText(user.externalId),
      displayName: buildEmployeeMasterDisplayName({
        displayName: user.displayName,
        familyName: user.familyName,
        givenName: user.givenName,
        userName: user.userName,
      }),
      familyName: normalizePlainText(user.familyName),
      givenName: normalizePlainText(user.givenName),
      activeFlag: user.active ? '1' : '0',
      employmentType: normalizePlainText(user.employmentType),
      joinDate: formatDateOnly(user.joinedAt),
      leaveDate: formatDateOnly(user.leftAt),
      departmentName: normalizePlainText(user.department),
      organizationName: normalizePlainText(user.organization),
      managerEmployeeCode,
      departmentCode: normalizePlainText(user.payrollProfile?.departmentCode),
      payrollType: normalizePlainText(user.payrollProfile?.payrollType),
      closingType: normalizePlainText(user.payrollProfile?.closingType),
      paymentType: normalizePlainText(user.payrollProfile?.paymentType),
      titleCode: normalizePlainText(user.payrollProfile?.titleCode),
      email: pickPrimaryMultiValue(user.emails),
      phone: pickPrimaryMultiValue(user.phoneNumbers),
    } satisfies HrEmployeeMasterExportItem;
  });

  return {
    schemaVersion: HR_EMPLOYEE_MASTER_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    exportedUntil: exportedUntil.toISOString(),
    updatedSince: input.updatedSince?.toISOString() ?? null,
    limit: input.limit,
    offset: input.offset,
    exportedCount: items.length,
    headers: [...HR_EMPLOYEE_MASTER_EXPORT_HEADERS],
    items,
  };
}

export function buildHrEmployeeMasterCsv(
  payload: HrEmployeeMasterExportPayload,
) {
  return toCsv(
    payload.headers,
    payload.items.map((item) =>
      payload.headers.map(
        (header) => item[header as keyof HrEmployeeMasterExportItem] ?? '',
      ),
    ),
  );
}

export function buildHrEmployeeMasterCsvFilename(exportedUntil: string | Date) {
  const iso =
    exportedUntil instanceof Date ? exportedUntil.toISOString() : exportedUntil;
  const compact = iso.replace(/[:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `rakuda-employee-master-${compact}.csv`;
}

export function buildHrEmployeeMasterExportLogResponse(item: {
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
}) {
  return {
    id: item.id,
    idempotencyKey: item.idempotencyKey,
    reexportOfId: item.reexportOfId,
    status: item.status,
    updatedSince: item.updatedSince,
    exportedUntil: item.exportedUntil,
    exportedCount: item.exportedCount,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    message: item.message,
  };
}

export function hrEmployeeMasterExportStatusCode(code: string) {
  switch (code) {
    case 'employee_master_employee_code_missing':
    case 'employee_master_manager_employee_code_missing':
      return 409;
    default:
      return 409;
  }
}

export async function dispatchHrEmployeeMasterExport(
  input: {
    idempotencyKey: string;
    updatedSince?: Date;
    limit: number;
    offset: number;
    actorUserId: string | null;
    auditContext: AuditContext;
  },
  deps: IntegrationExportDependencies = {},
) {
  const { prisma, logAudit } = resolveDependencies(deps);
  const requestHash = buildHrEmployeeMasterExportRequestHash({
    updatedSince: input.updatedSince?.toISOString() ?? null,
    limit: input.limit,
    offset: input.offset,
    format: 'csv',
  });

  const respondWithExisting = async (
    existing: NonNullable<
      Awaited<ReturnType<typeof prisma.hrEmployeeMasterExportLog.findUnique>>
    >,
  ) => {
    if (existing.requestHash !== requestHash) {
      await logAudit({
        ...input.auditContext,
        action: 'integration_hr_employee_master_export_dispatch_conflict',
        targetTable: 'HrEmployeeMasterExportLog',
        targetId: existing.id,
        metadata: {
          idempotencyKey: input.idempotencyKey,
          requestHash,
          existingRequestHash: existing.requestHash,
        } as Prisma.InputJsonValue,
      });
      throw new IntegrationExportDispatchError('idempotency_conflict', {
        error: 'idempotency_conflict',
      });
    }
    if (existing.status === IntegrationRunStatus.running) {
      throw new IntegrationExportDispatchError('dispatch_in_progress', {
        error: 'dispatch_in_progress',
        logId: existing.id,
      });
    }
    await logAudit({
      ...input.auditContext,
      action: 'integration_hr_employee_master_export_dispatch_replayed',
      targetTable: 'HrEmployeeMasterExportLog',
      targetId: existing.id,
      metadata: {
        idempotencyKey: input.idempotencyKey,
        status: existing.status,
        exportedCount: existing.exportedCount,
      } as Prisma.InputJsonValue,
    });
    return {
      replayed: true,
      payload: existing.payload,
      log: buildHrEmployeeMasterExportLogResponse(existing),
    };
  };

  const existing = await prisma.hrEmployeeMasterExportLog.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return respondWithExisting(existing);

  const startedAt = new Date();
  let log: Awaited<ReturnType<typeof prisma.hrEmployeeMasterExportLog.create>>;
  try {
    log = await prisma.hrEmployeeMasterExportLog.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        requestHash,
        updatedSince: input.updatedSince ?? null,
        exportedUntil: startedAt,
        status: IntegrationRunStatus.running,
        startedAt,
        createdBy: input.actorUserId,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const concurrent = await prisma.hrEmployeeMasterExportLog.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (concurrent) return respondWithExisting(concurrent);
    }
    throw error;
  }

  try {
    const payload = await buildHrEmployeeMasterExportPayload(
      {
        updatedSince: input.updatedSince,
        exportedUntil: startedAt,
        limit: input.limit,
        offset: input.offset,
      },
      { prisma },
    );
    const finishedAt = new Date();
    const updated = await prisma.hrEmployeeMasterExportLog.update({
      where: { id: log.id },
      data: {
        status: IntegrationRunStatus.success,
        exportedCount: payload.exportedCount,
        payload: payload as Prisma.InputJsonValue,
        message: payload.exportedCount ? 'exported' : 'no_changes',
        finishedAt,
      },
    });
    await logAudit({
      ...input.auditContext,
      action: 'integration_hr_employee_master_export_dispatched',
      targetTable: 'HrEmployeeMasterExportLog',
      targetId: updated.id,
      metadata: {
        idempotencyKey: input.idempotencyKey,
        exportedCount: payload.exportedCount,
        format: 'csv',
      } as Prisma.InputJsonValue,
    });
    return {
      replayed: false,
      payload,
      log: buildHrEmployeeMasterExportLogResponse(updated),
    };
  } catch (error) {
    const finishedAt = new Date();
    const message = error instanceof Error ? error.message : String(error);
    const failed = await prisma.hrEmployeeMasterExportLog.update({
      where: { id: log.id },
      data: {
        status: IntegrationRunStatus.failed,
        message,
        finishedAt,
      },
    });
    await logAudit({
      ...input.auditContext,
      action: 'integration_hr_employee_master_export_dispatch_failed',
      targetTable: 'HrEmployeeMasterExportLog',
      targetId: failed.id,
      metadata: {
        idempotencyKey: input.idempotencyKey,
        message: truncateForAudit(message),
      } as Prisma.InputJsonValue,
    });
    throw error;
  }
}

export async function listHrEmployeeMasterExportLogs(
  input: { limit: number; offset: number; idempotencyKey?: string },
  deps: IntegrationExportDependencies = {},
) {
  const { prisma } = resolveDependencies(deps);
  const items = await prisma.hrEmployeeMasterExportLog.findMany({
    where: {
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    },
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
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: input.limit,
    skip: input.offset,
  });
  return {
    items: items.map((item) => buildHrEmployeeMasterExportLogResponse(item)),
    limit: input.limit,
    offset: input.offset,
  };
}

export type HrAttendanceExportFormat = 'json' | 'csv';

const HR_ATTENDANCE_EXPORT_SCHEMA_VERSION = 'rakuda_attendance_v1';
export const DEFAULT_ATTENDANCE_EXPORT_LOG_LIMIT = 100;
export const MAX_ATTENDANCE_EXPORT_LOG_LIMIT = 1000;
export const MAX_ATTENDANCE_EXPORT_OFFSET = 100000;
const HR_ATTENDANCE_EXPORT_HEADERS = [
  'employeeCode',
  'closingMonth',
  'closingVersion',
  'workedDayCount',
  'scheduledWorkMinutes',
  'approvedWorkMinutes',
  'overtimeTotalMinutes',
  'overtimeWithinStatutoryMinutes',
  'overtimeOverStatutoryMinutes',
  'holidayWorkMinutes',
  'paidLeaveMinutes',
  'unpaidLeaveMinutes',
  'totalLeaveMinutes',
  'sourceTimeEntryCount',
  'sourceLeaveRequestCount',
] as const;

type HrAttendanceExportItem = Record<
  (typeof HR_ATTENDANCE_EXPORT_HEADERS)[number],
  string
>;

export type HrAttendanceExportPayload = {
  schemaVersion: typeof HR_ATTENDANCE_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  exportedUntil: string;
  periodKey: string;
  closingId: string;
  closingVersion: number;
  closedAt: string;
  exportedCount: number;
  headers: string[];
  items: HrAttendanceExportItem[];
};

export function normalizeHrAttendanceFormat(
  value: unknown,
): HrAttendanceExportFormat {
  return value === 'csv' ? 'csv' : 'json';
}

export function buildHrAttendanceExportRequestHash(input: {
  periodKey: string;
  format: 'csv';
}) {
  return createHash('sha256')
    .update(JSON.stringify(input), 'utf8')
    .digest('hex');
}

export async function buildHrAttendanceExportPayload(
  input: {
    periodKey: string;
    exportedUntil?: Date;
  },
  deps: IntegrationExportDependencies = {},
): Promise<HrAttendanceExportPayload> {
  const { prisma } = resolveDependencies(deps);
  const { periodKey } = parseAttendancePeriodKey(input.periodKey);
  const exportedUntil = input.exportedUntil ?? new Date();
  const closing = await prisma.attendanceClosingPeriod.findFirst({
    where: {
      periodKey,
      status: 'closed',
    },
    orderBy: [{ version: 'desc' }, { closedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      periodKey: true,
      version: true,
      closedAt: true,
    },
  });
  if (!closing) {
    throw new AttendanceClosingError(
      'attendance_closing_not_found',
      'No closed attendance snapshot found for the requested period',
      { periodKey } as Record<string, unknown>,
    );
  }
  const summaries = await prisma.attendanceMonthlySummary.findMany({
    where: { closingPeriodId: closing.id },
    orderBy: [{ employeeCode: 'asc' }, { userId: 'asc' }],
    select: {
      employeeCode: true,
      workedDayCount: true,
      scheduledWorkMinutes: true,
      approvedWorkMinutes: true,
      overtimeTotalMinutes: true,
      overtimeWithinStatutoryMinutes: true,
      overtimeOverStatutoryMinutes: true,
      holidayWorkMinutes: true,
      paidLeaveMinutes: true,
      unpaidLeaveMinutes: true,
      totalLeaveMinutes: true,
      sourceTimeEntryCount: true,
      sourceLeaveRequestCount: true,
    },
  });

  const items = summaries.map((item) => ({
    employeeCode: item.employeeCode,
    closingMonth: closing.periodKey,
    closingVersion: String(closing.version),
    workedDayCount: String(item.workedDayCount),
    scheduledWorkMinutes: String(item.scheduledWorkMinutes),
    approvedWorkMinutes: String(item.approvedWorkMinutes),
    overtimeTotalMinutes: String(item.overtimeTotalMinutes),
    overtimeWithinStatutoryMinutes: String(item.overtimeWithinStatutoryMinutes),
    overtimeOverStatutoryMinutes: String(item.overtimeOverStatutoryMinutes),
    holidayWorkMinutes: String(item.holidayWorkMinutes),
    paidLeaveMinutes: String(item.paidLeaveMinutes),
    unpaidLeaveMinutes: String(item.unpaidLeaveMinutes),
    totalLeaveMinutes: String(item.totalLeaveMinutes),
    sourceTimeEntryCount: String(item.sourceTimeEntryCount),
    sourceLeaveRequestCount: String(item.sourceLeaveRequestCount),
  }));

  return {
    schemaVersion: HR_ATTENDANCE_EXPORT_SCHEMA_VERSION,
    exportedAt: exportedUntil.toISOString(),
    exportedUntil: exportedUntil.toISOString(),
    periodKey: closing.periodKey,
    closingId: closing.id,
    closingVersion: closing.version,
    closedAt: closing.closedAt.toISOString(),
    exportedCount: items.length,
    headers: [...HR_ATTENDANCE_EXPORT_HEADERS],
    items,
  };
}

export function buildHrAttendanceCsv(payload: HrAttendanceExportPayload) {
  return toCsv(
    payload.headers,
    payload.items.map((item) =>
      payload.headers.map(
        (header) => item[header as keyof HrAttendanceExportItem] ?? '',
      ),
    ),
  );
}

export function buildHrAttendanceCsvFilename(
  payload: HrAttendanceExportPayload,
) {
  const compact = payload.exportedUntil
    .replace(/[:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `rakuda-attendance-${payload.periodKey}-v${payload.closingVersion}-${compact}.csv`;
}

export function buildHrAttendanceExportLogResponse(item: {
  id: string;
  idempotencyKey: string;
  reexportOfId: string | null;
  periodKey: string;
  closingPeriodId: string;
  closingVersion: number;
  status: IntegrationRunStatus;
  exportedUntil: Date;
  exportedCount: number;
  startedAt: Date;
  finishedAt: Date | null;
  message: string | null;
}) {
  return {
    id: item.id,
    idempotencyKey: item.idempotencyKey,
    reexportOfId: item.reexportOfId,
    periodKey: item.periodKey,
    closingPeriodId: item.closingPeriodId,
    closingVersion: item.closingVersion,
    status: item.status,
    exportedUntil: item.exportedUntil,
    exportedCount: item.exportedCount,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    message: item.message,
  };
}

export function hrAttendanceExportStatusCode(code: string) {
  switch (code) {
    case 'invalid_period_key':
      return 400;
    case 'attendance_closing_not_found':
      return 404;
    default:
      return 409;
  }
}

export async function dispatchHrAttendanceExport(
  input: {
    periodKey: string;
    idempotencyKey: string;
    actorUserId: string | null;
    auditContext: AuditContext;
  },
  deps: IntegrationExportDependencies = {},
) {
  const { prisma, logAudit } = resolveDependencies(deps);
  const requestHash = buildHrAttendanceExportRequestHash({
    periodKey: input.periodKey,
    format: 'csv',
  });

  const respondWithExisting = async (
    existing: NonNullable<
      Awaited<ReturnType<typeof prisma.hrAttendanceExportLog.findUnique>>
    >,
  ) => {
    if (existing.requestHash !== requestHash) {
      await logAudit({
        ...input.auditContext,
        action: 'integration_hr_attendance_export_dispatch_conflict',
        targetTable: 'HrAttendanceExportLog',
        targetId: existing.id,
        metadata: {
          idempotencyKey: input.idempotencyKey,
          requestHash,
          existingRequestHash: existing.requestHash,
        } as Prisma.InputJsonValue,
      });
      throw new IntegrationExportDispatchError('idempotency_conflict', {
        error: 'idempotency_conflict',
      });
    }
    if (existing.status === IntegrationRunStatus.running) {
      throw new IntegrationExportDispatchError('dispatch_in_progress', {
        error: 'dispatch_in_progress',
        logId: existing.id,
      });
    }
    await logAudit({
      ...input.auditContext,
      action: 'integration_hr_attendance_export_dispatch_replayed',
      targetTable: 'HrAttendanceExportLog',
      targetId: existing.id,
      metadata: {
        idempotencyKey: input.idempotencyKey,
        status: existing.status,
        exportedCount: existing.exportedCount,
      } as Prisma.InputJsonValue,
    });
    return {
      replayed: true,
      payload: existing.payload,
      log: buildHrAttendanceExportLogResponse(existing),
    };
  };

  const existing = await prisma.hrAttendanceExportLog.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return respondWithExisting(existing);

  const startedAt = new Date();
  const payload = await buildHrAttendanceExportPayload(
    {
      periodKey: input.periodKey,
      exportedUntil: startedAt,
    },
    { prisma },
  );

  let log: Awaited<ReturnType<typeof prisma.hrAttendanceExportLog.create>>;
  try {
    log = await prisma.hrAttendanceExportLog.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        requestHash,
        periodKey: payload.periodKey,
        closingPeriodId: payload.closingId,
        closingVersion: payload.closingVersion,
        exportedUntil: startedAt,
        status: IntegrationRunStatus.running,
        startedAt,
        createdBy: input.actorUserId,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const concurrent = await prisma.hrAttendanceExportLog.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (concurrent) return respondWithExisting(concurrent);
    }
    throw error;
  }

  try {
    const finishedAt = new Date();
    const updated = await prisma.hrAttendanceExportLog.update({
      where: { id: log.id },
      data: {
        status: IntegrationRunStatus.success,
        periodKey: payload.periodKey,
        closingPeriodId: payload.closingId,
        closingVersion: payload.closingVersion,
        exportedCount: payload.exportedCount,
        payload: payload as Prisma.InputJsonValue,
        message: payload.exportedCount ? 'exported' : 'no_changes',
        finishedAt,
      },
    });
    await logAudit({
      ...input.auditContext,
      action: 'integration_hr_attendance_export_dispatched',
      targetTable: 'HrAttendanceExportLog',
      targetId: updated.id,
      metadata: {
        idempotencyKey: input.idempotencyKey,
        periodKey: payload.periodKey,
        closingPeriodId: payload.closingId,
        closingVersion: payload.closingVersion,
        exportedCount: payload.exportedCount,
        format: 'csv',
      } as Prisma.InputJsonValue,
    });
    return {
      replayed: false,
      payload,
      log: buildHrAttendanceExportLogResponse(updated),
    };
  } catch (error) {
    const finishedAt = new Date();
    const message = error instanceof Error ? error.message : String(error);
    const failed = await prisma.hrAttendanceExportLog.update({
      where: { id: log.id },
      data: {
        status: IntegrationRunStatus.failed,
        message,
        finishedAt,
      },
    });
    await logAudit({
      ...input.auditContext,
      action: 'integration_hr_attendance_export_dispatch_failed',
      targetTable: 'HrAttendanceExportLog',
      targetId: failed.id,
      metadata: {
        idempotencyKey: input.idempotencyKey,
        message: truncateForAudit(message),
      } as Prisma.InputJsonValue,
    });
    throw error;
  }
}

export async function listHrAttendanceExportLogs(
  input: {
    limit: number;
    offset: number;
    periodKey?: string;
    idempotencyKey?: string;
  },
  deps: IntegrationExportDependencies = {},
) {
  const { prisma } = resolveDependencies(deps);
  const items = await prisma.hrAttendanceExportLog.findMany({
    where: {
      ...(input.periodKey ? { periodKey: input.periodKey } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    },
    select: {
      id: true,
      idempotencyKey: true,
      reexportOfId: true,
      periodKey: true,
      closingPeriodId: true,
      closingVersion: true,
      status: true,
      exportedUntil: true,
      exportedCount: true,
      startedAt: true,
      finishedAt: true,
      message: true,
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: input.limit,
    skip: input.offset,
  });
  return {
    items: items.map((item) => buildHrAttendanceExportLogResponse(item)),
    limit: input.limit,
    offset: input.offset,
  };
}

export type AccountingIcsExportFormat = 'json' | 'csv' | 'ics_template';

const DEFAULT_ACCOUNTING_ICS_EXPORT_LIMIT = 500;
const MAX_ACCOUNTING_ICS_EXPORT_LIMIT = 2000;
export const DEFAULT_ACCOUNTING_ICS_EXPORT_LOG_LIMIT = 100;
export const MAX_ACCOUNTING_ICS_EXPORT_LOG_LIMIT = 1000;
export const MAX_ACCOUNTING_ICS_EXPORT_OFFSET = 100000;

function normalizeAccountingIcsExportFormat(
  value: unknown,
): AccountingIcsExportFormat {
  if (value === 'csv') return 'csv';
  if (value === 'ics_template') return 'ics_template';
  return 'json';
}

export function parseAccountingIcsExportQuery(query: {
  format?: AccountingIcsExportFormat;
  periodKey?: string;
  companyCode?: string;
  companyName?: string;
  fiscalYearStartMonth?: number | string;
  limit?: number | string;
  offset?: number | string;
}) {
  return {
    format: normalizeAccountingIcsExportFormat(query.format),
    periodKey:
      typeof query.periodKey === 'string'
        ? query.periodKey.trim() || null
        : null,
    companyCode:
      typeof query.companyCode === 'string'
        ? query.companyCode.trim() || null
        : null,
    companyName:
      typeof query.companyName === 'string'
        ? query.companyName.trim() || null
        : null,
    fiscalYearStartMonth: parseBoundedInteger(
      query.fiscalYearStartMonth,
      1,
      12,
    ),
    limit: parseBoundedInteger(
      query.limit,
      DEFAULT_ACCOUNTING_ICS_EXPORT_LIMIT,
      MAX_ACCOUNTING_ICS_EXPORT_LIMIT,
    ),
    offset: parseBoundedNonNegativeInteger(
      query.offset,
      0,
      MAX_ACCOUNTING_ICS_EXPORT_OFFSET,
    ),
  };
}

export function resolveAccountingIcsTemplateOptions(input: {
  format: AccountingIcsExportFormat;
  periodKey: string | null;
  companyCode: string | null;
  companyName: string | null;
  fiscalYearStartMonth: number;
}): AccountingIcsTemplateOptions | null {
  if (input.format !== 'ics_template') return null;
  if (!input.periodKey) {
    throw new AccountingIcsExportError(
      'accounting_ics_template_period_key_required',
      'periodKey is required for ICS template export',
    );
  }
  if (!input.companyCode || !input.companyName) {
    throw new AccountingIcsExportError(
      'accounting_ics_template_metadata_required',
      'companyCode and companyName are required for ICS template export',
      {
        companyCode: input.companyCode,
        companyName: input.companyName,
      } as Prisma.InputJsonValue,
    );
  }
  return {
    periodKey: input.periodKey,
    companyCode: input.companyCode,
    companyName: input.companyName,
    fiscalYearStartMonth: input.fiscalYearStartMonth,
  };
}

export function accountingIcsExportStatusCode(code: string) {
  switch (code) {
    case 'invalid_period_key':
    case 'accounting_ics_template_period_key_required':
    case 'accounting_ics_template_metadata_required':
      return 400;
    default:
      return 409;
  }
}

export function buildAccountingIcsExportLogResponse(item: {
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
}) {
  return {
    id: item.id,
    idempotencyKey: item.idempotencyKey,
    reexportOfId: item.reexportOfId,
    periodKey: item.periodKey,
    status: item.status,
    exportedUntil: item.exportedUntil,
    exportedCount: item.exportedCount,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    message: item.message,
  };
}

export async function dispatchAccountingIcsExport(
  input: {
    idempotencyKey: string;
    query: ReturnType<typeof parseAccountingIcsExportQuery>;
    actorUserId: string | null;
    auditContext: AuditContext;
  },
  deps: IntegrationExportDependencies = {},
) {
  const { prisma, logAudit } = resolveDependencies(deps);
  const requestHash = buildAccountingIcsExportRequestHash({
    periodKey: input.query.periodKey,
    limit: input.query.limit,
    offset: input.query.offset,
    format: input.query.format === 'ics_template' ? 'ics_template' : 'csv',
    ...(input.query.format === 'ics_template'
      ? {
          companyCode: input.query.companyCode,
          companyName: input.query.companyName,
          fiscalYearStartMonth: input.query.fiscalYearStartMonth,
        }
      : {}),
  });

  const respondWithExisting = async (
    existing: NonNullable<
      Awaited<ReturnType<typeof prisma.accountingIcsExportLog.findUnique>>
    >,
  ) => {
    if (existing.requestHash !== requestHash) {
      await logAudit({
        ...input.auditContext,
        action: 'integration_accounting_ics_export_dispatch_conflict',
        targetTable: 'AccountingIcsExportLog',
        targetId: existing.id,
        metadata: {
          idempotencyKey: input.idempotencyKey,
          periodKey: input.query.periodKey,
          requestHash,
          existingRequestHash: existing.requestHash,
        } as Prisma.InputJsonValue,
      });
      throw new IntegrationExportDispatchError('idempotency_conflict', {
        error: 'idempotency_conflict',
      });
    }
    if (existing.status === IntegrationRunStatus.running) {
      throw new IntegrationExportDispatchError('dispatch_in_progress', {
        error: 'dispatch_in_progress',
        logId: existing.id,
      });
    }
    if (existing.status === IntegrationRunStatus.failed) {
      await logAudit({
        ...input.auditContext,
        action:
          'integration_accounting_ics_export_dispatch_failed_retry_rejected',
        targetTable: 'AccountingIcsExportLog',
        targetId: existing.id,
        metadata: {
          idempotencyKey: input.idempotencyKey,
          periodKey: existing.periodKey,
          status: existing.status,
          message: truncateForAudit(existing.message),
        } as Prisma.InputJsonValue,
      });
      throw new IntegrationExportDispatchError('dispatch_failed', {
        error: 'dispatch_failed',
        logId: existing.id,
        message: existing.message,
      });
    }
    await logAudit({
      ...input.auditContext,
      action: 'integration_accounting_ics_export_dispatch_replayed',
      targetTable: 'AccountingIcsExportLog',
      targetId: existing.id,
      metadata: {
        idempotencyKey: input.idempotencyKey,
        periodKey: existing.periodKey,
        status: existing.status,
        exportedCount: existing.exportedCount,
      } as Prisma.InputJsonValue,
    });
    return {
      replayed: true,
      payload: existing.payload,
      log: buildAccountingIcsExportLogResponse(existing),
    };
  };

  const existing = await prisma.accountingIcsExportLog.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return respondWithExisting(existing);

  const startedAt = new Date();
  let payload: AccountingIcsExportPayload;
  resolveAccountingIcsTemplateOptions(input.query);
  payload = await buildAccountingIcsExportPayload({
    client: prisma,
    periodKey: input.query.periodKey,
    exportedUntil: startedAt,
    limit: input.query.limit,
    offset: input.query.offset,
  });

  let log: Awaited<ReturnType<typeof prisma.accountingIcsExportLog.create>>;
  try {
    log = await prisma.accountingIcsExportLog.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        requestHash,
        periodKey: input.query.periodKey,
        exportedUntil: startedAt,
        status: IntegrationRunStatus.running,
        startedAt,
        createdBy: input.actorUserId,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const concurrent = await prisma.accountingIcsExportLog.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (concurrent) return respondWithExisting(concurrent);
    }
    throw error;
  }

  try {
    const finishedAt = new Date();
    const updated = await prisma.accountingIcsExportLog.update({
      where: { id: log.id },
      data: {
        status: IntegrationRunStatus.success,
        exportedCount: payload.exportedCount,
        payload: payload as Prisma.InputJsonValue,
        message: payload.exportedCount ? 'exported' : 'no_changes',
        finishedAt,
      },
    });
    await logAudit({
      ...input.auditContext,
      action: 'integration_accounting_ics_export_dispatched',
      targetTable: 'AccountingIcsExportLog',
      targetId: updated.id,
      metadata: {
        idempotencyKey: input.idempotencyKey,
        periodKey: input.query.periodKey,
        exportedCount: payload.exportedCount,
        format: input.query.format === 'ics_template' ? 'ics_template' : 'csv',
      } as Prisma.InputJsonValue,
    });
    return {
      replayed: false,
      payload,
      log: buildAccountingIcsExportLogResponse(updated),
    };
  } catch (error) {
    const finishedAt = new Date();
    const message = error instanceof Error ? error.message : String(error);
    const failed = await prisma.accountingIcsExportLog.update({
      where: { id: log.id },
      data: {
        status: IntegrationRunStatus.failed,
        message,
        finishedAt,
      },
    });
    await logAudit({
      ...input.auditContext,
      action: 'integration_accounting_ics_export_dispatch_failed',
      targetTable: 'AccountingIcsExportLog',
      targetId: failed.id,
      metadata: {
        idempotencyKey: input.idempotencyKey,
        periodKey: input.query.periodKey,
        message: truncateForAudit(message),
      } as Prisma.InputJsonValue,
    });
    throw error;
  }
}

export async function listAccountingIcsExportLogs(
  input: {
    limit: number;
    offset: number;
    periodKey?: string;
    status?: IntegrationRunStatus;
    idempotencyKey?: string;
  },
  deps: IntegrationExportDependencies = {},
) {
  const { prisma } = resolveDependencies(deps);
  const items = await prisma.accountingIcsExportLog.findMany({
    where: {
      ...(input.periodKey ? { periodKey: input.periodKey } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    },
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
    take: input.limit,
    skip: input.offset,
  });
  return {
    items: items.map((item) => buildAccountingIcsExportLogResponse(item)),
    limit: input.limit,
    offset: input.offset,
  };
}
