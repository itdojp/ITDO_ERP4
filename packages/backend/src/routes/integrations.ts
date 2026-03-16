import { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import {
  IntegrationRunStatus,
  IntegrationStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { triggerAlert } from '../services/alert.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { ensureLeaveSetting } from '../services/leaveSettings.js';
import { resolveLeaveRequestMinutesWithCalendar } from '../services/leaveEntitlements.js';
import { normalizeLeaveTypeInput } from '../services/leaveTypes.js';
import { resolveUserWorkdayMinutesForDates } from '../services/leaveWorkdayCalendar.js';
import {
  AttendanceClosingError,
  closeAttendancePeriod,
} from '../services/attendanceClosings.js';
import {
  AccountingIcsExportError,
  type AccountingIcsExportPayload,
  buildAccountingIcsCsv,
  buildAccountingIcsCsvFilename,
  buildAccountingIcsExportPayload,
  buildAccountingIcsExportRequestHash,
} from '../services/accountingIcsExport.js';
import { sendCsv, toCsv } from '../utils/csv.js';
import { toDateOnly } from '../utils/date.js';
import {
  integrationAccountingIcsExportDispatchSchema,
  integrationAccountingIcsExportLogListQuerySchema,
  integrationAccountingIcsExportQuerySchema,
  integrationExportJobListQuerySchema,
  integrationExportJobRedispatchSchema,
  integrationHrAttendanceClosingCreateSchema,
  integrationHrAttendanceClosingListQuerySchema,
  integrationHrAttendanceClosingSummaryListSchema,
  integrationHrEmployeeMasterExportDispatchSchema,
  integrationHrEmployeeMasterExportLogListQuerySchema,
  integrationHrEmployeeMasterExportQuerySchema,
  integrationHrLeaveExportDispatchSchema,
  integrationHrLeaveExportLogListQuerySchema,
  integrationHrLeaveExportQuerySchema,
  integrationRunMetricsQuerySchema,
  integrationSettingPatchSchema,
  integrationSettingSchema,
} from './validators.js';

type IntegrationSettingBody = {
  type: 'hr' | 'crm';
  name?: string;
  provider?: string;
  status?: 'active' | 'disabled';
  schedule?: string;
  config?: unknown;
};

function normalizeConfig(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function parseLimit(
  raw: string | undefined,
  defaultValue: number,
  maxValue: number,
) {
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.min(parsed, maxValue);
}

function parseOffset(raw: string | undefined) {
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
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

function attendanceClosingStatusCode(code: string) {
  if (code === 'invalid_period_key') return 400;
  return 409;
}

function calculateDurationMetrics(durations: number[]) {
  if (!durations.length) {
    return { avgDurationMs: null, p95DurationMs: null };
  }
  const sorted = [...durations].sort((left, right) => left - right);
  const avgDurationMs = Math.round(
    sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  );
  const p95Index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * 0.95) - 1),
  );
  const p95DurationMs = Math.round(sorted[p95Index]);
  return { avgDurationMs, p95DurationMs };
}

const DEFAULT_RETRY_MAX = 3;
const DEFAULT_RETRY_BASE_MINUTES = 60;
const MAX_RETRY_MAX = 10;
const MAX_RETRY_BASE_MINUTES = 1440;

function getRetryPolicy(config: unknown) {
  const record =
    config && typeof config === 'object'
      ? (config as Record<string, unknown>)
      : {};
  const retryMaxRaw = record.retryMax;
  const retryBaseRaw = record.retryBaseMinutes;
  const retryMax =
    typeof retryMaxRaw === 'number' && Number.isFinite(retryMaxRaw)
      ? Math.min(MAX_RETRY_MAX, Math.max(0, Math.floor(retryMaxRaw)))
      : DEFAULT_RETRY_MAX;
  const retryBaseMinutes =
    typeof retryBaseRaw === 'number' && Number.isFinite(retryBaseRaw)
      ? Math.min(MAX_RETRY_BASE_MINUTES, Math.max(1, Math.floor(retryBaseRaw)))
      : DEFAULT_RETRY_BASE_MINUTES;
  return { retryMax, retryBaseMinutes };
}

function computeNextRetryAt(
  now: Date,
  retryCount: number,
  retryBaseMinutes: number,
) {
  if (retryCount <= 0) return null;
  const multiplier = Math.pow(2, retryCount - 1);
  return new Date(now.getTime() + retryBaseMinutes * 60 * 1000 * multiplier);
}

function parseUpdatedSince(raw?: string) {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

type HrEmployeeMasterExportFormat = 'json' | 'csv';

const DEFAULT_EMPLOYEE_MASTER_EXPORT_LIMIT = 500;
const MAX_EMPLOYEE_MASTER_EXPORT_LIMIT = 2000;
const DEFAULT_EMPLOYEE_MASTER_EXPORT_LOG_LIMIT = 100;
const MAX_EMPLOYEE_MASTER_EXPORT_LOG_LIMIT = 1000;
const MAX_EMPLOYEE_MASTER_EXPORT_OFFSET = 100000;
const HR_EMPLOYEE_MASTER_EXPORT_SCHEMA_VERSION = 'rakuda_employee_master_v0';
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

type HrEmployeeMasterExportPayload = {
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

class HrEmployeeMasterExportError extends Error {
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

function parseHrEmployeeMasterExportQuery(query: {
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

function buildHrEmployeeMasterExportRequestHash(input: {
  updatedSince: string | null;
  limit: number;
  offset: number;
  format: 'csv';
}) {
  return createHash('sha256')
    .update(JSON.stringify(input), 'utf8')
    .digest('hex');
}

async function buildHrEmployeeMasterExportPayload(input: {
  updatedSince?: Date;
  exportedUntil?: Date;
  limit: number;
  offset: number;
}): Promise<HrEmployeeMasterExportPayload> {
  const exportedUntil = input.exportedUntil ?? new Date();
  const users = await prisma.userAccount.findMany({
    where: input.updatedSince
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
      : undefined,
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

function buildHrEmployeeMasterCsv(payload: HrEmployeeMasterExportPayload) {
  return toCsv(
    payload.headers,
    payload.items.map((item) =>
      payload.headers.map(
        (header) => item[header as keyof HrEmployeeMasterExportItem] ?? '',
      ),
    ),
  );
}

function buildHrEmployeeMasterCsvFilename(exportedUntil: string | Date) {
  const iso =
    exportedUntil instanceof Date ? exportedUntil.toISOString() : exportedUntil;
  const compact = iso.replace(/[:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `rakuda-employee-master-${compact}.csv`;
}

function buildHrEmployeeMasterExportLogResponse(item: {
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

function hrEmployeeMasterExportStatusCode(code: string) {
  switch (code) {
    case 'employee_master_employee_code_missing':
      return 409;
    default:
      return 409;
  }
}

type AccountingIcsExportFormat = 'json' | 'csv';

const DEFAULT_ACCOUNTING_ICS_EXPORT_LIMIT = 500;
const MAX_ACCOUNTING_ICS_EXPORT_LIMIT = 2000;
const DEFAULT_ACCOUNTING_ICS_EXPORT_LOG_LIMIT = 100;
const MAX_ACCOUNTING_ICS_EXPORT_LOG_LIMIT = 1000;
const MAX_ACCOUNTING_ICS_EXPORT_OFFSET = 100000;
const DEFAULT_INTEGRATION_EXPORT_JOB_LIMIT = 100;
const MAX_INTEGRATION_EXPORT_JOB_LIMIT = 500;
const MAX_INTEGRATION_EXPORT_JOB_OFFSET = 1000;
const MAX_INTEGRATION_EXPORT_JOB_FETCH =
  MAX_INTEGRATION_EXPORT_JOB_LIMIT + MAX_INTEGRATION_EXPORT_JOB_OFFSET;

type IntegrationExportJobKind =
  | 'hr_leave_export_attendance'
  | 'hr_leave_export_payroll'
  | 'hr_employee_master_export'
  | 'accounting_ics_export';

function normalizeIntegrationExportJobKind(
  value: unknown,
): IntegrationExportJobKind | undefined {
  switch (value) {
    case 'hr_leave_export_attendance':
    case 'hr_leave_export_payroll':
    case 'hr_employee_master_export':
    case 'accounting_ics_export':
      return value;
    default:
      return undefined;
  }
}

function compareStartedAtDesc(
  left: { startedAt: Date; id: string },
  right: { startedAt: Date; id: string },
) {
  const startedAtDiff = right.startedAt.getTime() - left.startedAt.getTime();
  if (startedAtDiff !== 0) return startedAtDiff;
  return right.id.localeCompare(left.id);
}

function normalizeAccountingIcsExportFormat(
  value: unknown,
): AccountingIcsExportFormat {
  return value === 'csv' ? 'csv' : 'json';
}

function parseAccountingIcsExportQuery(query: {
  format?: AccountingIcsExportFormat;
  periodKey?: string;
  limit?: number | string;
  offset?: number | string;
}) {
  return {
    format: normalizeAccountingIcsExportFormat(query.format),
    periodKey:
      typeof query.periodKey === 'string'
        ? query.periodKey.trim() || null
        : null,
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

function accountingIcsExportStatusCode(code: string) {
  switch (code) {
    case 'invalid_period_key':
      return 400;
    default:
      return 409;
  }
}

function buildAccountingIcsExportLogResponse(item: {
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

function buildIntegrationExportJobResponse(
  item:
    | ({
        kind: 'hr_leave_export_attendance' | 'hr_leave_export_payroll';
        target: string;
        updatedSince: Date | null;
      } & ReturnType<typeof buildLeaveExportLogResponse>)
    | ({
        kind: 'hr_employee_master_export';
      } & ReturnType<typeof buildHrEmployeeMasterExportLogResponse>)
    | ({
        kind: 'accounting_ics_export';
      } & ReturnType<typeof buildAccountingIcsExportLogResponse>),
) {
  return {
    kind: item.kind,
    id: item.id,
    idempotencyKey: item.idempotencyKey,
    reexportOfId: item.reexportOfId,
    status: item.status,
    exportedCount: item.exportedCount,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    message: item.message,
    scope:
      item.kind === 'accounting_ics_export'
        ? { periodKey: item.periodKey }
        : item.kind === 'hr_employee_master_export'
          ? { updatedSince: item.updatedSince }
          : {
              target: item.target,
              updatedSince: item.updatedSince,
            },
  };
}

function integrationExportRedispatchStatusCode(error: string) {
  switch (error) {
    case 'integration_export_log_not_found':
      return 404;
    case 'invalid_idempotencyKey':
      return 400;
    default:
      return 409;
  }
}

type LeaveExportTarget = 'attendance' | 'payroll';

const DEFAULT_LEAVE_EXPORT_LIMIT = 500;
const MAX_LEAVE_EXPORT_LIMIT = 2000;
const DEFAULT_LEAVE_EXPORT_LOG_LIMIT = 100;
const MAX_LEAVE_EXPORT_LOG_LIMIT = 1000;
const MAX_LEAVE_EXPORT_OFFSET = 100000;

function normalizeLeaveExportTarget(value: unknown): LeaveExportTarget {
  return value === 'payroll' ? 'payroll' : 'attendance';
}

function buildLeaveExportRequestHash(input: {
  target: LeaveExportTarget;
  updatedSince: string | null;
  limit: number;
  offset: number;
}) {
  return createHash('sha256')
    .update(JSON.stringify(input), 'utf8')
    .digest('hex');
}

type HrLeaveExportQuery = {
  target?: LeaveExportTarget;
  updatedSince?: string;
  limit?: number | string;
  offset?: number | string;
};

type HrLeaveExportPayload = {
  target: LeaveExportTarget;
  exportedAt: string;
  exportedUntil: string;
  updatedSince: string | null;
  limit: number;
  offset: number;
  exportedCount: number;
  items: Array<{
    id: string;
    userId: string;
    leaveType: string;
    leaveTypeName: string | null;
    leaveTypeUnit: string | null;
    leaveTypeIsPaid: boolean | null;
    status: 'approved';
    startDate: string;
    endDate: string;
    startTimeMinutes: number | null;
    endTimeMinutes: number | null;
    requestedMinutes: number;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
};

type LeaveRequestForExport = {
  id: string;
  userId: string;
  leaveType: string;
  startDate: Date;
  endDate: Date;
  hours: number | null;
  minutes: number | null;
  startTimeMinutes: number | null;
  endTimeMinutes: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function isLeaveMinutesExplicitForExport(leave: LeaveRequestForExport) {
  if (
    leave.startTimeMinutes !== null &&
    leave.startTimeMinutes !== undefined &&
    leave.endTimeMinutes !== null &&
    leave.endTimeMinutes !== undefined
  ) {
    return true;
  }
  return (
    (leave.minutes !== null && leave.minutes !== undefined) ||
    (leave.hours !== null && leave.hours !== undefined)
  );
}

function collectLeaveDateKeys(leave: LeaveRequestForExport) {
  const keys = new Map<string, Date>();
  const start = toDateOnly(leave.startDate);
  const end = toDateOnly(leave.endDate);
  for (
    let current = start.getTime();
    current <= end.getTime();
    current += 24 * 60 * 60 * 1000
  ) {
    const workDate = new Date(current);
    keys.set(workDate.toISOString().slice(0, 10), workDate);
  }
  return keys;
}

async function prefillLeaveWorkdayMinutesCache(options: {
  leaves: LeaveRequestForExport[];
  defaultWorkdayMinutes: number;
  cacheByUser: Map<string, Map<string, number>>;
}) {
  const datesByUser = new Map<string, Map<string, Date>>();
  for (const leave of options.leaves) {
    if (isLeaveMinutesExplicitForExport(leave)) continue;
    const dateBucket = datesByUser.get(leave.userId) ?? new Map<string, Date>();
    datesByUser.set(leave.userId, dateBucket);
    for (const [key, date] of collectLeaveDateKeys(leave).entries()) {
      dateBucket.set(key, date);
    }
  }
  for (const [userId, dates] of datesByUser.entries()) {
    const targetDates = Array.from(dates.values());
    if (!targetDates.length) continue;
    const resolved = await resolveUserWorkdayMinutesForDates({
      userId,
      targetDates,
      defaultWorkdayMinutes: options.defaultWorkdayMinutes,
    });
    const cache = options.cacheByUser.get(userId) ?? new Map<string, number>();
    options.cacheByUser.set(userId, cache);
    for (const [key, row] of resolved.entries()) {
      cache.set(key, row.workMinutes);
    }
  }
}

function parseLeaveExportQuery(query: HrLeaveExportQuery) {
  const target = normalizeLeaveExportTarget(query.target);
  const since = parseUpdatedSince(query.updatedSince);
  if (since === null) {
    return { ok: false as const };
  }
  const limit = parseBoundedInteger(
    query.limit,
    DEFAULT_LEAVE_EXPORT_LIMIT,
    MAX_LEAVE_EXPORT_LIMIT,
  );
  const offset = parseBoundedNonNegativeInteger(
    query.offset,
    0,
    MAX_LEAVE_EXPORT_OFFSET,
  );
  return {
    ok: true as const,
    target,
    updatedSince: since,
    limit,
    offset,
  };
}

async function buildHrLeaveExportPayload(input: {
  target: LeaveExportTarget;
  updatedSince?: Date;
  exportedUntil?: Date;
  limit: number;
  offset: number;
  actorId?: string | null;
}): Promise<HrLeaveExportPayload> {
  const leaveSetting = await ensureLeaveSetting({
    actorId: input.actorId ?? null,
  });
  const exportedUntil = input.exportedUntil ?? new Date();
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      status: 'approved',
      updatedAt: {
        ...(input.updatedSince ? { gt: input.updatedSince } : {}),
        lte: exportedUntil,
      },
    },
    select: {
      id: true,
      userId: true,
      leaveType: true,
      startDate: true,
      endDate: true,
      hours: true,
      minutes: true,
      startTimeMinutes: true,
      endTimeMinutes: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: input.limit,
    skip: input.offset,
  });
  const leaveTypeCodes = Array.from(
    new Set(
      leaves
        .map((item) => normalizeLeaveTypeInput(item.leaveType))
        .filter((item) => item.length > 0),
    ),
  );
  const leaveTypes = leaveTypeCodes.length
    ? await prisma.leaveType.findMany({
        where: { code: { in: leaveTypeCodes } },
        select: {
          code: true,
          name: true,
          unit: true,
          isPaid: true,
        },
      })
    : [];
  const leaveTypeByCode = new Map(
    leaveTypes.map((item) => [item.code, item] as const),
  );
  const workdayMinutesCacheByUser = new Map<string, Map<string, number>>();
  await prefillLeaveWorkdayMinutesCache({
    leaves,
    defaultWorkdayMinutes: leaveSetting.defaultWorkdayMinutes,
    cacheByUser: workdayMinutesCacheByUser,
  });
  const items: HrLeaveExportPayload['items'] = [];
  for (const leave of leaves) {
    const normalizedLeaveType = normalizeLeaveTypeInput(leave.leaveType);
    const leaveType = leaveTypeByCode.get(normalizedLeaveType);
    const cache =
      workdayMinutesCacheByUser.get(leave.userId) ?? new Map<string, number>();
    workdayMinutesCacheByUser.set(leave.userId, cache);
    const requestedMinutes = await resolveLeaveRequestMinutesWithCalendar({
      leave,
      userId: leave.userId,
      defaultWorkdayMinutes: leaveSetting.defaultWorkdayMinutes,
      workdayMinutesCache: cache,
    });
    items.push({
      id: leave.id,
      userId: leave.userId,
      leaveType: normalizedLeaveType || leave.leaveType,
      leaveTypeName: leaveType?.name ?? null,
      leaveTypeUnit: leaveType?.unit ?? null,
      leaveTypeIsPaid: leaveType?.isPaid ?? null,
      status: 'approved',
      startDate: leave.startDate.toISOString(),
      endDate: leave.endDate.toISOString(),
      startTimeMinutes: leave.startTimeMinutes,
      endTimeMinutes: leave.endTimeMinutes,
      requestedMinutes,
      notes: leave.notes ?? null,
      createdAt: leave.createdAt.toISOString(),
      updatedAt: leave.updatedAt.toISOString(),
    });
  }
  return {
    target: input.target,
    exportedAt: new Date().toISOString(),
    exportedUntil: exportedUntil.toISOString(),
    updatedSince: input.updatedSince?.toISOString() ?? null,
    limit: input.limit,
    offset: input.offset,
    exportedCount: items.length,
    items,
  };
}

function buildLeaveExportLogResponse(item: {
  id: string;
  target: string;
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
    target: item.target,
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

const MAX_INTEGRATION_CONFIG_KEYS = 100;
const MAX_INTEGRATION_CONFIG_BYTES = 32768;
const MAX_INTEGRATION_SCHEDULE_LENGTH = 200;
const MAX_INTEGRATION_AUDIT_TEXT_LENGTH = 500;
const MAX_INTEGRATION_AUDIT_ARRAY_ITEMS = 20;
const SENSITIVE_CONFIG_KEY_PATTERN =
  /(token|secret|password|api[_-]?key|private[_-]?key|access[_-]?key)/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function truncateForAudit(value: unknown) {
  if (typeof value !== 'string') return value;
  if (value.length <= MAX_INTEGRATION_AUDIT_TEXT_LENGTH) return value;
  return `${value.slice(0, MAX_INTEGRATION_AUDIT_TEXT_LENGTH)}...`;
}

function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (depth >= 4) return '[depth_truncated]';
  if (typeof value === 'string') return truncateForAudit(value);
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  ) {
    return value ?? null;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_INTEGRATION_AUDIT_ARRAY_ITEMS)
      .map((item) => sanitizeAuditValue(item, depth + 1));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = sanitizeAuditValue(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

function sanitizeConfigForAudit(value: unknown, depth = 0): unknown {
  if (depth >= 4) return '[depth_truncated]';
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_INTEGRATION_AUDIT_ARRAY_ITEMS)
      .map((item) => sanitizeConfigForAudit(item, depth + 1));
  }
  if (!isPlainObject(value)) {
    return sanitizeAuditValue(value, depth + 1);
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_CONFIG_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    out[key] = sanitizeConfigForAudit(item, depth + 1);
  }
  return out;
}

function validateIntegrationSchedule(
  raw: unknown,
): { ok: true } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true };
  if (typeof raw !== 'string') {
    return { ok: false, message: 'schedule must be a string' };
  }
  if (raw.length > MAX_INTEGRATION_SCHEDULE_LENGTH) {
    return {
      ok: false,
      message: `schedule must be <= ${MAX_INTEGRATION_SCHEDULE_LENGTH} chars`,
    };
  }
  return { ok: true };
}

function validateIntegrationConfig(
  raw: unknown,
): { ok: true } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true };
  if (!isPlainObject(raw)) {
    return { ok: false, message: 'config must be an object or null' };
  }
  const keys = Object.keys(raw);
  if (keys.length > MAX_INTEGRATION_CONFIG_KEYS) {
    return {
      ok: false,
      message: `config key count must be <= ${MAX_INTEGRATION_CONFIG_KEYS}`,
    };
  }

  try {
    const bytes = Buffer.byteLength(JSON.stringify(raw), 'utf8');
    if (bytes > MAX_INTEGRATION_CONFIG_BYTES) {
      return {
        ok: false,
        message: `config payload must be <= ${MAX_INTEGRATION_CONFIG_BYTES} bytes`,
      };
    }
  } catch {
    return { ok: false, message: 'config must be JSON serializable' };
  }

  const retryMax = raw.retryMax;
  if (
    retryMax !== undefined &&
    (typeof retryMax !== 'number' ||
      !Number.isInteger(retryMax) ||
      retryMax < 0 ||
      retryMax > MAX_RETRY_MAX)
  ) {
    return {
      ok: false,
      message: `retryMax must be an integer in range 0..${MAX_RETRY_MAX}`,
    };
  }

  const retryBaseMinutes = raw.retryBaseMinutes;
  if (
    retryBaseMinutes !== undefined &&
    (typeof retryBaseMinutes !== 'number' ||
      !Number.isInteger(retryBaseMinutes) ||
      retryBaseMinutes < 1 ||
      retryBaseMinutes > MAX_RETRY_BASE_MINUTES)
  ) {
    return {
      ok: false,
      message: `retryBaseMinutes must be an integer in range 1..${MAX_RETRY_BASE_MINUTES}`,
    };
  }

  const simulateFailure = raw.simulateFailure;
  if (simulateFailure !== undefined && typeof simulateFailure !== 'boolean') {
    return { ok: false, message: 'simulateFailure must be a boolean' };
  }

  const updatedSince = raw.updatedSince;
  if (updatedSince !== undefined) {
    if (typeof updatedSince !== 'string') {
      return { ok: false, message: 'updatedSince must be an ISO date-time' };
    }
    if (parseUpdatedSince(updatedSince) === null) {
      return { ok: false, message: 'updatedSince must be an ISO date-time' };
    }
  }
  return { ok: true };
}

async function closeIntegrationFailureAlerts(settingId: string) {
  const settings = await prisma.alertSetting.findMany({
    where: { type: 'integration_failure' },
    select: { id: true },
  });
  if (!settings.length) return;
  const targetRef = `integration:${settingId}`;
  await prisma.alert.updateMany({
    where: {
      status: 'open',
      targetRef,
      settingId: { in: settings.map((s) => s.id) },
    },
    data: { status: 'closed' },
  });
}

async function triggerIntegrationFailureAlerts(settingId: string) {
  const settings = await prisma.alertSetting.findMany({
    where: { type: 'integration_failure', isEnabled: true },
  });
  if (!settings.length) return;
  const targetRef = `integration:${settingId}`;
  for (const setting of settings) {
    await triggerAlert(
      {
        id: setting.id,
        recipients: setting.recipients,
        channels: setting.channels,
        remindAfterHours: setting.remindAfterHours,
        remindMaxCount: setting.remindMaxCount,
      },
      1,
      0,
      targetRef,
    );
  }
}

async function executeIntegration(setting: {
  id: string;
  type: string;
  config: unknown;
}) {
  const config =
    setting.config && typeof setting.config === 'object'
      ? (setting.config as Record<string, unknown>)
      : null;
  if (config?.simulateFailure === true) {
    throw new Error('simulate_failure');
  }
  const updatedSinceRaw =
    typeof config?.updatedSince === 'string' ? config.updatedSince : undefined;
  const updatedSince = parseUpdatedSince(updatedSinceRaw);
  if (updatedSince === null) {
    throw new Error('invalid_updatedSince');
  }
  if (setting.type === 'crm') {
    const where = updatedSince
      ? { updatedAt: { gt: updatedSince } }
      : undefined;
    const [customers, vendors, contacts] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.vendor.count({ where }),
      prisma.contact.count({ where }),
    ]);
    const metrics: Record<string, unknown> = {
      customers,
      vendors,
      contacts,
    };
    if (updatedSince) {
      metrics.updatedSince = updatedSince.toISOString();
    }
    return {
      message: updatedSince ? 'exported_delta' : 'exported',
      metrics,
    };
  }
  if (setting.type === 'hr') {
    const where = updatedSince
      ? { updatedAt: { gt: updatedSince } }
      : undefined;
    const [users, wellbeing] = await Promise.all([
      prisma.userAccount.count({ where }),
      prisma.wellbeingEntry.count({ where }),
    ]);
    const metrics: Record<string, unknown> = { users, wellbeing };
    if (updatedSince) {
      metrics.updatedSince = updatedSince.toISOString();
    }
    return {
      message: updatedSince ? 'exported_delta' : 'exported',
      metrics,
    };
  }
  return { message: 'noop', metrics: {} };
}

async function runIntegrationSetting(
  setting: {
    id: string;
    type: string;
    config: unknown;
  },
  userId?: string,
  existingRun?: { id: string; retryCount?: number | null },
) {
  const now = new Date();
  const run = existingRun
    ? await prisma.integrationRun.update({
        where: { id: existingRun.id },
        data: {
          status: IntegrationRunStatus.running,
          startedAt: now,
          finishedAt: null,
          message: null,
          metrics: Prisma.DbNull,
          nextRetryAt: null,
        },
      })
    : await prisma.integrationRun.create({
        data: {
          settingId: setting.id,
          status: IntegrationRunStatus.running,
          startedAt: now,
          createdBy: userId,
        },
      });
  try {
    const result = await executeIntegration(setting);
    const finishedAt = new Date();
    const updated = await prisma.integrationRun.update({
      where: { id: run.id },
      data: {
        status: IntegrationRunStatus.success,
        finishedAt,
        message: result.message,
        metrics: result.metrics as Prisma.InputJsonValue,
        nextRetryAt: null,
      },
    });
    await prisma.integrationSetting.update({
      where: { id: setting.id },
      data: {
        lastRunAt: finishedAt,
        lastRunStatus: IntegrationRunStatus.success,
        updatedBy: userId,
      },
    });
    await closeIntegrationFailureAlerts(setting.id);
    return updated;
  } catch (err) {
    const finishedAt = new Date();
    const { retryMax, retryBaseMinutes } = getRetryPolicy(setting.config);
    const currentRetry = existingRun?.retryCount ?? run.retryCount ?? 0;
    const retryCount = currentRetry + 1;
    const shouldRetry = retryCount <= retryMax;
    const nextRetryAt = shouldRetry
      ? computeNextRetryAt(finishedAt, retryCount, retryBaseMinutes)
      : null;
    const message = err instanceof Error ? err.message : String(err);
    const updated = await prisma.integrationRun.update({
      where: { id: run.id },
      data: {
        status: IntegrationRunStatus.failed,
        finishedAt,
        message,
        retryCount,
        nextRetryAt,
      },
    });
    await prisma.integrationSetting.update({
      where: { id: setting.id },
      data: {
        lastRunAt: finishedAt,
        lastRunStatus: IntegrationRunStatus.failed,
        updatedBy: userId,
      },
    });
    await triggerIntegrationFailureAlerts(setting.id);
    return updated;
  }
}

function buildIntegrationRunAuditMetadata(input: {
  trigger: 'manual' | 'retry' | 'scheduled';
  settingId: string;
  settingType: string;
  run: {
    id: string;
    status: string;
    retryCount: number | null;
    nextRetryAt: Date | null;
    message: string | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
  };
}) {
  return {
    trigger: input.trigger,
    settingId: input.settingId,
    settingType: input.settingType,
    status: input.run.status,
    retryCount: input.run.retryCount ?? 0,
    nextRetryAt: input.run.nextRetryAt?.toISOString() ?? null,
    startedAt: input.run.startedAt?.toISOString() ?? null,
    finishedAt: input.run.finishedAt?.toISOString() ?? null,
    message: truncateForAudit(input.run.message ?? null),
  };
}

export async function registerIntegrationRoutes(app: FastifyInstance) {
  app.get(
    '/integration-settings',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async () => {
      const items = await prisma.integrationSetting.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return { items };
    },
  );

  app.post(
    '/integration-settings',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationSettingSchema,
    },
    async (req, reply) => {
      const body = req.body as IntegrationSettingBody;
      const scheduleValidation = validateIntegrationSchedule(body.schedule);
      if (!scheduleValidation.ok) {
        return reply.code(400).send({
          error: 'invalid_schedule',
          message: scheduleValidation.message,
        });
      }
      const configValidation = validateIntegrationConfig(body.config);
      if (!configValidation.ok) {
        return reply.code(400).send({
          error: 'invalid_config',
          message: configValidation.message,
        });
      }
      const userId = req.user?.userId;
      const config = normalizeConfig(body.config);
      const created = await prisma.integrationSetting.create({
        data: {
          type: body.type,
          name: body.name,
          provider: body.provider,
          status: body.status,
          schedule: body.schedule,
          config,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await logAudit({
        ...auditContextFromRequest(req),
        action: 'integration_setting_created',
        targetTable: 'integration_settings',
        targetId: created.id,
        metadata: {
          type: created.type,
          name: truncateForAudit(created.name ?? null),
          provider: truncateForAudit(created.provider ?? null),
          status: created.status,
          schedule: truncateForAudit(created.schedule ?? null),
          config: sanitizeConfigForAudit(created.config),
        } as Prisma.InputJsonValue,
      });
      return created;
    },
  );

  app.patch(
    '/integration-settings/:id',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationSettingPatchSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as Partial<IntegrationSettingBody>;
      const current = await prisma.integrationSetting.findUnique({
        where: { id },
      });
      if (!current) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const scheduleValidation = validateIntegrationSchedule(body.schedule);
      if (!scheduleValidation.ok) {
        return reply.code(400).send({
          error: 'invalid_schedule',
          message: scheduleValidation.message,
        });
      }
      const configValidation = validateIntegrationConfig(body.config);
      if (!configValidation.ok) {
        return reply.code(400).send({
          error: 'invalid_config',
          message: configValidation.message,
        });
      }
      const userId = req.user?.userId;
      const config =
        body.config !== undefined ? normalizeConfig(body.config) : undefined;
      const updated = await prisma.integrationSetting.update({
        where: { id },
        data: {
          type: body.type,
          name: body.name,
          provider: body.provider,
          status: body.status,
          schedule: body.schedule,
          config,
          updatedBy: userId,
        },
      });
      await logAudit({
        ...auditContextFromRequest(req),
        action: 'integration_setting_updated',
        targetTable: 'integration_settings',
        targetId: updated.id,
        metadata: {
          before: {
            type: current.type,
            name: truncateForAudit(current.name ?? null),
            provider: truncateForAudit(current.provider ?? null),
            status: current.status,
            schedule: truncateForAudit(current.schedule ?? null),
            config: sanitizeConfigForAudit(current.config),
          },
          after: {
            type: updated.type,
            name: truncateForAudit(updated.name ?? null),
            provider: truncateForAudit(updated.provider ?? null),
            status: updated.status,
            schedule: truncateForAudit(updated.schedule ?? null),
            config: sanitizeConfigForAudit(updated.config),
          },
        } as Prisma.InputJsonValue,
      });
      return updated;
    },
  );

  app.post(
    '/integration-settings/:id/run',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const setting = await prisma.integrationSetting.findUnique({
        where: { id },
      });
      if (!setting) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (setting.status === IntegrationStatus.disabled) {
        return reply.code(409).send({ error: 'disabled' });
      }
      const userId = req.user?.userId;
      const run = await runIntegrationSetting(setting, userId);
      await logAudit({
        ...auditContextFromRequest(req),
        action: 'integration_run_executed',
        targetTable: 'integration_runs',
        targetId: run.id,
        metadata: buildIntegrationRunAuditMetadata({
          trigger: 'manual',
          settingId: setting.id,
          settingType: setting.type,
          run,
        }) as Prisma.InputJsonValue,
      });
      return run;
    },
  );

  app.get(
    '/integration-runs',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { settingId, limit, offset } = req.query as {
        settingId?: string;
        limit?: string;
        offset?: string;
      };
      const take = parseLimit(limit, 200, 1000);
      const skip = parseOffset(offset);
      const items = await prisma.integrationRun.findMany({
        where: settingId ? { settingId } : undefined,
        orderBy: { startedAt: 'desc' },
        take,
        skip,
      });
      return { items, limit: take, offset: skip };
    },
  );

  app.get(
    '/integration-runs/metrics',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationRunMetricsQuerySchema,
    },
    async (req) => {
      const query = req.query as {
        settingId?: string;
        days?: number | string;
        limit?: number | string;
      };
      const days = parseBoundedInteger(query.days, 14, 90);
      const limit = parseBoundedInteger(query.limit, 2000, 5000);
      const now = new Date();
      const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const where = {
        startedAt: { gte: from, lte: now },
        ...(query.settingId ? { settingId: query.settingId } : {}),
      };
      const runs = await prisma.integrationRun.findMany({
        where,
        include: {
          setting: {
            select: { id: true, type: true, name: true },
          },
        },
        orderBy: { startedAt: 'desc' },
        take: limit,
      });

      let successRuns = 0;
      let failedRuns = 0;
      let runningRuns = 0;
      let retryScheduledRuns = 0;
      const durations: number[] = [];
      const failureReasonCounts = new Map<string, number>();
      const byType = new Map<
        string,
        {
          type: string;
          totalRuns: number;
          successRuns: number;
          failedRuns: number;
          runningRuns: number;
        }
      >();

      for (const run of runs) {
        const typeKey = run.setting?.type ?? 'unknown';
        const typeSummary = byType.get(typeKey) ?? {
          type: typeKey,
          totalRuns: 0,
          successRuns: 0,
          failedRuns: 0,
          runningRuns: 0,
        };
        typeSummary.totalRuns += 1;

        if (run.status === IntegrationRunStatus.success) {
          successRuns += 1;
          typeSummary.successRuns += 1;
        } else if (run.status === IntegrationRunStatus.failed) {
          failedRuns += 1;
          typeSummary.failedRuns += 1;
          if (run.nextRetryAt) {
            retryScheduledRuns += 1;
          }
          const reason = String(run.message || 'unknown_error').trim();
          failureReasonCounts.set(
            reason,
            (failureReasonCounts.get(reason) ?? 0) + 1,
          );
        } else {
          runningRuns += 1;
          typeSummary.runningRuns += 1;
        }

        if (run.finishedAt instanceof Date && run.startedAt instanceof Date) {
          const durationMs = run.finishedAt.getTime() - run.startedAt.getTime();
          if (Number.isFinite(durationMs) && durationMs >= 0) {
            durations.push(durationMs);
          }
        }
        byType.set(typeKey, typeSummary);
      }

      const totalRuns = runs.length;
      const successRate = totalRuns
        ? Number(((successRuns / totalRuns) * 100).toFixed(2))
        : null;
      const durationMetrics = calculateDurationMetrics(durations);

      const failureReasons = Array.from(failureReasonCounts.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((left, right) =>
          left.count === right.count
            ? left.reason.localeCompare(right.reason)
            : right.count - left.count,
        )
        .slice(0, 10);

      const byTypeItems = Array.from(byType.values())
        .map((item) => ({
          ...item,
          successRate:
            item.totalRuns > 0
              ? Number(((item.successRuns / item.totalRuns) * 100).toFixed(2))
              : null,
        }))
        .sort((left, right) =>
          left.totalRuns === right.totalRuns
            ? left.type.localeCompare(right.type)
            : right.totalRuns - left.totalRuns,
        );

      return {
        window: {
          from: from.toISOString(),
          to: now.toISOString(),
          days,
          limit,
        },
        summary: {
          totalRuns,
          successRuns,
          failedRuns,
          runningRuns,
          retryScheduledRuns,
          successRate,
          avgDurationMs: durationMetrics.avgDurationMs,
          p95DurationMs: durationMetrics.p95DurationMs,
        },
        failureReasons,
        byType: byTypeItems,
      };
    },
  );

  app.post(
    '/jobs/integrations/run',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const userId = req.user?.userId;
      const auditContext = auditContextFromRequest(req);
      const auditTasks: Array<Promise<unknown>> = [];
      const now = new Date();
      const retryRuns = await prisma.integrationRun.findMany({
        where: {
          status: IntegrationRunStatus.failed,
          nextRetryAt: { lte: now },
        },
        include: { setting: true },
        orderBy: { nextRetryAt: 'asc' },
        take: 100,
      });
      const retryResults = [];
      for (const run of retryRuns) {
        const { retryMax } = getRetryPolicy(run.setting.config);
        if (run.retryCount >= retryMax) {
          continue;
        }
        const updated = await runIntegrationSetting(run.setting, userId, {
          id: run.id,
          retryCount: run.retryCount,
        });
        retryResults.push({ id: updated.id, status: updated.status });
        auditTasks.push(
          logAudit({
            ...auditContext,
            action: 'integration_run_executed',
            targetTable: 'integration_runs',
            targetId: updated.id,
            metadata: buildIntegrationRunAuditMetadata({
              trigger: 'retry',
              settingId: run.setting.id,
              settingType: run.setting.type,
              run: updated,
            }) as Prisma.InputJsonValue,
          }),
        );
      }

      const scheduledSettings = await prisma.integrationSetting.findMany({
        where: { status: IntegrationStatus.active, schedule: { not: null } },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      const scheduledResults = [];
      for (const setting of scheduledSettings) {
        if (!setting.schedule || setting.schedule.trim().length === 0) {
          continue;
        }
        const run = await runIntegrationSetting(setting, userId);
        scheduledResults.push({ id: run.id, status: run.status });
        auditTasks.push(
          logAudit({
            ...auditContext,
            action: 'integration_run_executed',
            targetTable: 'integration_runs',
            targetId: run.id,
            metadata: buildIntegrationRunAuditMetadata({
              trigger: 'scheduled',
              settingId: setting.id,
              settingType: setting.type,
              run,
            }) as Prisma.InputJsonValue,
          }),
        );
      }
      auditTasks.push(
        logAudit({
          ...auditContext,
          action: 'integration_jobs_run_executed',
          targetTable: 'integration_runs',
          metadata: {
            retryCount: retryResults.length,
            scheduledCount: scheduledResults.length,
          } as Prisma.InputJsonValue,
        }),
      );
      await Promise.allSettled(auditTasks);
      return {
        ok: true,
        retryCount: retryResults.length,
        scheduledCount: scheduledResults.length,
        retries: retryResults,
        scheduled: scheduledResults,
      };
    },
  );

  app.get(
    '/integrations/crm/exports/customers',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { limit, offset, updatedSince } = req.query as {
        limit?: string;
        offset?: string;
        updatedSince?: string;
      };
      const since = parseUpdatedSince(updatedSince);
      if (since === null) {
        return reply.code(400).send({ error: 'invalid_updatedSince' });
      }
      const take = parseLimit(limit, 500, 2000);
      const skip = parseOffset(offset);
      const items = await prisma.customer.findMany({
        where: since ? { updatedAt: { gt: since } } : undefined,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      });
      return { items, limit: take, offset: skip };
    },
  );

  app.get(
    '/integrations/crm/exports/vendors',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { limit, offset, updatedSince } = req.query as {
        limit?: string;
        offset?: string;
        updatedSince?: string;
      };
      const since = parseUpdatedSince(updatedSince);
      if (since === null) {
        return reply.code(400).send({ error: 'invalid_updatedSince' });
      }
      const take = parseLimit(limit, 500, 2000);
      const skip = parseOffset(offset);
      const items = await prisma.vendor.findMany({
        where: since ? { updatedAt: { gt: since } } : undefined,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      });
      return { items, limit: take, offset: skip };
    },
  );

  app.get(
    '/integrations/crm/exports/contacts',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { limit, offset, updatedSince } = req.query as {
        limit?: string;
        offset?: string;
        updatedSince?: string;
      };
      const since = parseUpdatedSince(updatedSince);
      if (since === null) {
        return reply.code(400).send({ error: 'invalid_updatedSince' });
      }
      const take = parseLimit(limit, 500, 2000);
      const skip = parseOffset(offset);
      const items = await prisma.contact.findMany({
        where: since ? { updatedAt: { gt: since } } : undefined,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      });
      return { items, limit: take, offset: skip };
    },
  );

  app.get(
    '/integrations/hr/exports/users',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { limit, offset, updatedSince } = req.query as {
        limit?: string;
        offset?: string;
        updatedSince?: string;
      };
      const since = parseUpdatedSince(updatedSince);
      if (since === null) {
        return reply.code(400).send({ error: 'invalid_updatedSince' });
      }
      const take = parseLimit(limit, 500, 2000);
      const skip = parseOffset(offset);
      const items = await prisma.userAccount.findMany({
        where: since
          ? {
              OR: [
                { updatedAt: { gt: since } },
                { payrollProfile: { is: { updatedAt: { gt: since } } } },
              ],
            }
          : undefined,
        include: {
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
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      });
      return { items, limit: take, offset: skip };
    },
  );

  app.get(
    '/integrations/hr/exports/users/employee-master',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationHrEmployeeMasterExportQuerySchema,
    },
    async (req, reply) => {
      const parsed = parseHrEmployeeMasterExportQuery(
        req.query as {
          format?: HrEmployeeMasterExportFormat;
          updatedSince?: string;
          limit?: number | string;
          offset?: number | string;
        },
      );
      if (!parsed.ok) {
        return reply.code(400).send({ error: 'invalid_updatedSince' });
      }
      try {
        const payload = await buildHrEmployeeMasterExportPayload({
          updatedSince: parsed.updatedSince,
          limit: parsed.limit,
          offset: parsed.offset,
        });
        if (parsed.format === 'csv') {
          return sendCsv(
            reply,
            buildHrEmployeeMasterCsvFilename(payload.exportedUntil),
            buildHrEmployeeMasterCsv(payload),
          );
        }
        return payload;
      } catch (error) {
        if (error instanceof HrEmployeeMasterExportError) {
          return reply.code(hrEmployeeMasterExportStatusCode(error.code)).send({
            error: error.code,
            message: error.message,
            details: error.details,
          });
        }
        throw error;
      }
    },
  );

  app.post(
    '/integrations/hr/exports/users/employee-master/dispatch',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationHrEmployeeMasterExportDispatchSchema,
    },
    async (req, reply) => {
      const parsed = parseHrEmployeeMasterExportQuery(
        req.body as {
          format?: HrEmployeeMasterExportFormat;
          updatedSince?: string;
          limit?: number | string;
          offset?: number | string;
        },
      );
      if (!parsed.ok) {
        return reply.code(400).send({ error: 'invalid_updatedSince' });
      }
      const body = req.body as {
        idempotencyKey: string;
      };
      const idempotencyKey = body.idempotencyKey.trim();
      if (!idempotencyKey) {
        return reply.code(400).send({ error: 'invalid_idempotencyKey' });
      }
      const requestHash = buildHrEmployeeMasterExportRequestHash({
        updatedSince: parsed.updatedSince?.toISOString() ?? null,
        limit: parsed.limit,
        offset: parsed.offset,
        format: 'csv',
      });
      const respondWithExistingEmployeeMasterDispatch = async (
        existing: NonNullable<
          Awaited<
            ReturnType<typeof prisma.hrEmployeeMasterExportLog.findUnique>
          >
        >,
      ) => {
        if (existing.requestHash !== requestHash) {
          await logAudit({
            ...auditContextFromRequest(req),
            action: 'integration_hr_employee_master_export_dispatch_conflict',
            targetTable: 'HrEmployeeMasterExportLog',
            targetId: existing.id,
            metadata: {
              idempotencyKey,
              requestHash,
              existingRequestHash: existing.requestHash,
            } as Prisma.InputJsonValue,
          });
          return reply.code(409).send({ error: 'idempotency_conflict' });
        }
        if (existing.status === IntegrationRunStatus.running) {
          return reply.code(409).send({
            error: 'dispatch_in_progress',
            logId: existing.id,
          });
        }
        await logAudit({
          ...auditContextFromRequest(req),
          action: 'integration_hr_employee_master_export_dispatch_replayed',
          targetTable: 'HrEmployeeMasterExportLog',
          targetId: existing.id,
          metadata: {
            idempotencyKey,
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
        where: { idempotencyKey },
      });
      if (existing) {
        return respondWithExistingEmployeeMasterDispatch(existing);
      }

      const startedAt = new Date();
      let log: Awaited<
        ReturnType<typeof prisma.hrEmployeeMasterExportLog.create>
      >;
      try {
        log = await prisma.hrEmployeeMasterExportLog.create({
          data: {
            idempotencyKey,
            requestHash,
            updatedSince: parsed.updatedSince ?? null,
            exportedUntil: startedAt,
            status: IntegrationRunStatus.running,
            startedAt,
            createdBy: req.user?.userId ?? null,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const concurrent = await prisma.hrEmployeeMasterExportLog.findUnique({
            where: { idempotencyKey },
          });
          if (concurrent) {
            return respondWithExistingEmployeeMasterDispatch(concurrent);
          }
        }
        throw error;
      }

      try {
        const payload = await buildHrEmployeeMasterExportPayload({
          updatedSince: parsed.updatedSince,
          exportedUntil: startedAt,
          limit: parsed.limit,
          offset: parsed.offset,
        });
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
          ...auditContextFromRequest(req),
          action: 'integration_hr_employee_master_export_dispatched',
          targetTable: 'HrEmployeeMasterExportLog',
          targetId: updated.id,
          metadata: {
            idempotencyKey,
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
          ...auditContextFromRequest(req),
          action: 'integration_hr_employee_master_export_dispatch_failed',
          targetTable: 'HrEmployeeMasterExportLog',
          targetId: failed.id,
          metadata: {
            idempotencyKey,
            message: truncateForAudit(message),
          } as Prisma.InputJsonValue,
        });
        if (error instanceof HrEmployeeMasterExportError) {
          return reply.code(hrEmployeeMasterExportStatusCode(error.code)).send({
            error: error.code,
            message: error.message,
            details: error.details,
          });
        }
        throw error;
      }
    },
  );

  app.get(
    '/integrations/hr/exports/users/employee-master/dispatch-logs',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationHrEmployeeMasterExportLogListQuerySchema,
    },
    async (req) => {
      const query = req.query as {
        limit?: number | string;
        offset?: number | string;
        idempotencyKey?: string;
      };
      const limit = parseBoundedInteger(
        query.limit,
        DEFAULT_EMPLOYEE_MASTER_EXPORT_LOG_LIMIT,
        MAX_EMPLOYEE_MASTER_EXPORT_LOG_LIMIT,
      );
      const offset = parseBoundedNonNegativeInteger(
        query.offset,
        0,
        MAX_EMPLOYEE_MASTER_EXPORT_OFFSET,
      );
      const idempotencyKey =
        typeof query.idempotencyKey === 'string'
          ? query.idempotencyKey.trim()
          : '';
      const items = await prisma.hrEmployeeMasterExportLog.findMany({
        where: {
          ...(idempotencyKey ? { idempotencyKey } : {}),
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
        take: limit,
        skip: offset,
      });
      return {
        items: items.map((item) =>
          buildHrEmployeeMasterExportLogResponse(item),
        ),
        limit,
        offset,
      };
    },
  );

  app.get(
    '/integrations/accounting/exports/journals',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationAccountingIcsExportQuerySchema,
    },
    async (req, reply) => {
      const parsed = parseAccountingIcsExportQuery(
        req.query as {
          format?: AccountingIcsExportFormat;
          periodKey?: string;
          limit?: number | string;
          offset?: number | string;
        },
      );
      try {
        const payload = await buildAccountingIcsExportPayload({
          periodKey: parsed.periodKey,
          limit: parsed.limit,
          offset: parsed.offset,
        });
        if (parsed.format === 'csv') {
          return reply
            .header(
              'Content-Disposition',
              `attachment; filename="${buildAccountingIcsCsvFilename({
                exportedUntil: payload.exportedUntil,
                periodKey: payload.periodKey,
              })}"`,
            )
            .type('text/csv; charset=shift_jis')
            .send(buildAccountingIcsCsv(payload));
        }
        return payload;
      } catch (error) {
        if (error instanceof AccountingIcsExportError) {
          return reply.code(accountingIcsExportStatusCode(error.code)).send({
            error: error.code,
            message: error.message,
            details: error.details,
          });
        }
        throw error;
      }
    },
  );

  app.post(
    '/integrations/accounting/exports/journals/dispatch',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationAccountingIcsExportDispatchSchema,
    },
    async (req, reply) => {
      const parsed = parseAccountingIcsExportQuery(
        req.body as {
          format?: AccountingIcsExportFormat;
          periodKey?: string;
          limit?: number | string;
          offset?: number | string;
        },
      );
      const body = req.body as { idempotencyKey: string };
      const idempotencyKey = body.idempotencyKey.trim();
      if (!idempotencyKey) {
        return reply.code(400).send({ error: 'invalid_idempotencyKey' });
      }
      const requestHash = buildAccountingIcsExportRequestHash({
        periodKey: parsed.periodKey,
        limit: parsed.limit,
        offset: parsed.offset,
        format: 'csv',
      });
      const respondWithExistingAccountingIcsDispatch = async (
        existing: NonNullable<
          Awaited<ReturnType<typeof prisma.accountingIcsExportLog.findUnique>>
        >,
      ) => {
        if (existing.requestHash !== requestHash) {
          await logAudit({
            ...auditContextFromRequest(req),
            action: 'integration_accounting_ics_export_dispatch_conflict',
            targetTable: 'AccountingIcsExportLog',
            targetId: existing.id,
            metadata: {
              idempotencyKey,
              periodKey: parsed.periodKey,
              requestHash,
              existingRequestHash: existing.requestHash,
            } as Prisma.InputJsonValue,
          });
          return reply.code(409).send({ error: 'idempotency_conflict' });
        }
        if (existing.status === IntegrationRunStatus.running) {
          return reply.code(409).send({
            error: 'dispatch_in_progress',
            logId: existing.id,
          });
        }
        if (existing.status === IntegrationRunStatus.failed) {
          await logAudit({
            ...auditContextFromRequest(req),
            action:
              'integration_accounting_ics_export_dispatch_failed_retry_rejected',
            targetTable: 'AccountingIcsExportLog',
            targetId: existing.id,
            metadata: {
              idempotencyKey,
              periodKey: existing.periodKey,
              status: existing.status,
              message: truncateForAudit(existing.message),
            } as Prisma.InputJsonValue,
          });
          return reply.code(409).send({
            error: 'dispatch_failed',
            logId: existing.id,
            message: existing.message,
          });
        }
        await logAudit({
          ...auditContextFromRequest(req),
          action: 'integration_accounting_ics_export_dispatch_replayed',
          targetTable: 'AccountingIcsExportLog',
          targetId: existing.id,
          metadata: {
            idempotencyKey,
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
        where: { idempotencyKey },
      });
      if (existing) {
        return respondWithExistingAccountingIcsDispatch(existing);
      }

      const startedAt = new Date();
      let payload: AccountingIcsExportPayload;
      try {
        payload = await buildAccountingIcsExportPayload({
          periodKey: parsed.periodKey,
          exportedUntil: startedAt,
          limit: parsed.limit,
          offset: parsed.offset,
        });
      } catch (error) {
        if (error instanceof AccountingIcsExportError) {
          return reply.code(accountingIcsExportStatusCode(error.code)).send({
            error: error.code,
            message: error.message,
            details: error.details,
          });
        }
        throw error;
      }

      let log: Awaited<ReturnType<typeof prisma.accountingIcsExportLog.create>>;
      try {
        log = await prisma.accountingIcsExportLog.create({
          data: {
            idempotencyKey,
            requestHash,
            periodKey: parsed.periodKey,
            exportedUntil: startedAt,
            status: IntegrationRunStatus.running,
            startedAt,
            createdBy: req.user?.userId ?? null,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const concurrent = await prisma.accountingIcsExportLog.findUnique({
            where: { idempotencyKey },
          });
          if (concurrent) {
            return respondWithExistingAccountingIcsDispatch(concurrent);
          }
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
          ...auditContextFromRequest(req),
          action: 'integration_accounting_ics_export_dispatched',
          targetTable: 'AccountingIcsExportLog',
          targetId: updated.id,
          metadata: {
            idempotencyKey,
            periodKey: parsed.periodKey,
            exportedCount: payload.exportedCount,
            format: 'csv',
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
          ...auditContextFromRequest(req),
          action: 'integration_accounting_ics_export_dispatch_failed',
          targetTable: 'AccountingIcsExportLog',
          targetId: failed.id,
          metadata: {
            idempotencyKey,
            periodKey: parsed.periodKey,
            message: truncateForAudit(message),
          } as Prisma.InputJsonValue,
        });
        if (error instanceof AccountingIcsExportError) {
          return reply.code(accountingIcsExportStatusCode(error.code)).send({
            error: error.code,
            message: error.message,
            details: error.details,
          });
        }
        throw error;
      }
    },
  );

  app.get(
    '/integrations/accounting/exports/journals/dispatch-logs',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationAccountingIcsExportLogListQuerySchema,
    },
    async (req) => {
      const query = req.query as {
        periodKey?: string;
        status?: IntegrationRunStatus;
        limit?: number | string;
        offset?: number | string;
        idempotencyKey?: string;
      };
      const limit = parseBoundedInteger(
        query.limit,
        DEFAULT_ACCOUNTING_ICS_EXPORT_LOG_LIMIT,
        MAX_ACCOUNTING_ICS_EXPORT_LOG_LIMIT,
      );
      const offset = parseBoundedNonNegativeInteger(
        query.offset,
        0,
        MAX_ACCOUNTING_ICS_EXPORT_OFFSET,
      );
      const idempotencyKey =
        typeof query.idempotencyKey === 'string'
          ? query.idempotencyKey.trim()
          : '';
      const periodKey =
        typeof query.periodKey === 'string' ? query.periodKey.trim() : '';
      const status =
        query.status === IntegrationRunStatus.running ||
        query.status === IntegrationRunStatus.success ||
        query.status === IntegrationRunStatus.failed
          ? query.status
          : undefined;
      const items = await prisma.accountingIcsExportLog.findMany({
        where: {
          ...(periodKey ? { periodKey } : {}),
          ...(status ? { status } : {}),
          ...(idempotencyKey ? { idempotencyKey } : {}),
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
        take: limit,
        skip: offset,
      });
      return {
        items: items.map((item) => buildAccountingIcsExportLogResponse(item)),
        limit,
        offset,
      };
    },
  );

  app.get(
    '/integrations/jobs/exports',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationExportJobListQuerySchema,
    },
    async (req) => {
      const query = req.query as {
        kind?: IntegrationExportJobKind;
        status?: IntegrationRunStatus;
        limit?: number | string;
        offset?: number | string;
      };
      const kind = normalizeIntegrationExportJobKind(query.kind);
      const status =
        query.status === IntegrationRunStatus.running ||
        query.status === IntegrationRunStatus.success ||
        query.status === IntegrationRunStatus.failed
          ? query.status
          : undefined;
      const limit = parseBoundedInteger(
        query.limit,
        DEFAULT_INTEGRATION_EXPORT_JOB_LIMIT,
        MAX_INTEGRATION_EXPORT_JOB_LIMIT,
      );
      const offset = parseBoundedNonNegativeInteger(
        query.offset,
        0,
        MAX_INTEGRATION_EXPORT_JOB_OFFSET,
      );
      const take = Math.min(limit + offset, MAX_INTEGRATION_EXPORT_JOB_FETCH);

      const shouldLoadLeave =
        !kind ||
        kind === 'hr_leave_export_attendance' ||
        kind === 'hr_leave_export_payroll';
      const shouldLoadEmployeeMaster =
        !kind || kind === 'hr_employee_master_export';
      const shouldLoadAccounting = !kind || kind === 'accounting_ics_export';

      const [leaveLogs, employeeMasterLogs, accountingLogs] = await Promise.all(
        [
          shouldLoadLeave
            ? prisma.leaveIntegrationExportLog.findMany({
                where: {
                  ...(status ? { status } : {}),
                  ...(kind === 'hr_leave_export_attendance'
                    ? { target: 'attendance' }
                    : {}),
                  ...(kind === 'hr_leave_export_payroll'
                    ? { target: 'payroll' }
                    : {}),
                },
                select: {
                  id: true,
                  target: true,
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
                take,
              })
            : Promise.resolve([]),
          shouldLoadEmployeeMaster
            ? prisma.hrEmployeeMasterExportLog.findMany({
                where: status ? { status } : undefined,
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
                take,
              })
            : Promise.resolve([]),
          shouldLoadAccounting
            ? prisma.accountingIcsExportLog.findMany({
                where: status ? { status } : undefined,
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
                take,
              })
            : Promise.resolve([]),
        ],
      );

      const items = [
        ...leaveLogs.map((item) =>
          buildIntegrationExportJobResponse({
            kind:
              item.target === 'payroll'
                ? 'hr_leave_export_payroll'
                : 'hr_leave_export_attendance',
            ...buildLeaveExportLogResponse(item),
            target: item.target,
            updatedSince: item.updatedSince,
          }),
        ),
        ...employeeMasterLogs.map((item) =>
          buildIntegrationExportJobResponse({
            kind: 'hr_employee_master_export',
            ...buildHrEmployeeMasterExportLogResponse(item),
          }),
        ),
        ...accountingLogs.map((item) =>
          buildIntegrationExportJobResponse({
            kind: 'accounting_ics_export',
            ...buildAccountingIcsExportLogResponse(item),
          }),
        ),
      ]
        .sort(compareStartedAtDesc)
        .slice(offset, offset + limit);

      return {
        items,
        limit,
        offset,
      };
    },
  );

  app.post(
    '/integrations/jobs/exports/:kind/:id/redispatch',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationExportJobRedispatchSchema,
    },
    async (req, reply) => {
      const { kind, id } = req.params as {
        kind: IntegrationExportJobKind;
        id: string;
      };
      const body = req.body as { idempotencyKey: string };
      const idempotencyKey = body.idempotencyKey.trim();
      if (!idempotencyKey) {
        return reply.code(400).send({ error: 'invalid_idempotencyKey' });
      }
      const actorId = req.user?.userId ?? null;
      const now = new Date();

      switch (kind) {
        case 'hr_leave_export_attendance':
        case 'hr_leave_export_payroll': {
          const target =
            kind === 'hr_leave_export_payroll' ? 'payroll' : 'attendance';
          const source = await prisma.leaveIntegrationExportLog.findUnique({
            where: { id },
          });
          if (!source || source.target !== target) {
            return reply
              .code(
                integrationExportRedispatchStatusCode(
                  'integration_export_log_not_found',
                ),
              )
              .send({ error: 'integration_export_log_not_found' });
          }
          if (source.status === IntegrationRunStatus.running) {
            return reply.code(409).send({
              error: 'dispatch_in_progress',
              logId: source.id,
            });
          }
          if (
            !source.payload ||
            source.status !== IntegrationRunStatus.success
          ) {
            return reply.code(409).send({
              error: 'redispatch_source_not_exported',
              logId: source.id,
            });
          }
          const existing = await prisma.leaveIntegrationExportLog.findUnique({
            where: {
              target_idempotencyKey: {
                target,
                idempotencyKey,
              },
            },
          });
          if (existing) {
            if (
              existing.requestHash !== source.requestHash ||
              existing.reexportOfId !== source.id
            ) {
              await logAudit({
                ...auditContextFromRequest(req),
                action: 'integration_hr_leave_export_redispatch_conflict',
                targetTable: 'LeaveIntegrationExportLog',
                targetId: existing.id,
                metadata: {
                  kind,
                  sourceLogId: source.id,
                  idempotencyKey,
                  requestHash: source.requestHash,
                  existingRequestHash: existing.requestHash,
                  existingReexportOfId: existing.reexportOfId,
                } as Prisma.InputJsonValue,
              });
              return reply.code(409).send({ error: 'idempotency_conflict' });
            }
            if (existing.status === IntegrationRunStatus.running) {
              return reply.code(409).send({
                error: 'dispatch_in_progress',
                logId: existing.id,
              });
            }
            await logAudit({
              ...auditContextFromRequest(req),
              action: 'integration_hr_leave_export_redispatch_replayed',
              targetTable: 'LeaveIntegrationExportLog',
              targetId: existing.id,
              metadata: {
                kind,
                sourceLogId: source.id,
                idempotencyKey,
                status: existing.status,
              } as Prisma.InputJsonValue,
            });
            return {
              replayed: true,
              payload: existing.payload,
              log: buildLeaveExportLogResponse(existing),
            };
          }
          const created = await prisma.leaveIntegrationExportLog.create({
            data: {
              target,
              idempotencyKey,
              requestHash: source.requestHash,
              reexportOfId: source.id,
              updatedSince: source.updatedSince,
              exportedUntil: source.exportedUntil,
              status: IntegrationRunStatus.success,
              exportedCount: source.exportedCount,
              payload: source.payload,
              message: 'redispatched',
              startedAt: now,
              finishedAt: now,
              createdBy: actorId,
            },
          });
          await logAudit({
            ...auditContextFromRequest(req),
            action: 'integration_hr_leave_export_redispatched',
            targetTable: 'LeaveIntegrationExportLog',
            targetId: created.id,
            metadata: {
              kind,
              sourceLogId: source.id,
              idempotencyKey,
              exportedCount: created.exportedCount,
            } as Prisma.InputJsonValue,
          });
          return {
            replayed: false,
            payload: created.payload,
            log: buildLeaveExportLogResponse(created),
          };
        }
        case 'hr_employee_master_export': {
          const source = await prisma.hrEmployeeMasterExportLog.findUnique({
            where: { id },
          });
          if (!source) {
            return reply
              .code(
                integrationExportRedispatchStatusCode(
                  'integration_export_log_not_found',
                ),
              )
              .send({ error: 'integration_export_log_not_found' });
          }
          if (source.status === IntegrationRunStatus.running) {
            return reply.code(409).send({
              error: 'dispatch_in_progress',
              logId: source.id,
            });
          }
          if (
            !source.payload ||
            source.status !== IntegrationRunStatus.success
          ) {
            return reply.code(409).send({
              error: 'redispatch_source_not_exported',
              logId: source.id,
            });
          }
          const existing = await prisma.hrEmployeeMasterExportLog.findUnique({
            where: { idempotencyKey },
          });
          if (existing) {
            if (
              existing.requestHash !== source.requestHash ||
              existing.reexportOfId !== source.id
            ) {
              await logAudit({
                ...auditContextFromRequest(req),
                action:
                  'integration_hr_employee_master_export_redispatch_conflict',
                targetTable: 'HrEmployeeMasterExportLog',
                targetId: existing.id,
                metadata: {
                  sourceLogId: source.id,
                  idempotencyKey,
                  requestHash: source.requestHash,
                  existingRequestHash: existing.requestHash,
                  existingReexportOfId: existing.reexportOfId,
                } as Prisma.InputJsonValue,
              });
              return reply.code(409).send({ error: 'idempotency_conflict' });
            }
            if (existing.status === IntegrationRunStatus.running) {
              return reply.code(409).send({
                error: 'dispatch_in_progress',
                logId: existing.id,
              });
            }
            await logAudit({
              ...auditContextFromRequest(req),
              action:
                'integration_hr_employee_master_export_redispatch_replayed',
              targetTable: 'HrEmployeeMasterExportLog',
              targetId: existing.id,
              metadata: {
                sourceLogId: source.id,
                idempotencyKey,
                status: existing.status,
              } as Prisma.InputJsonValue,
            });
            return {
              replayed: true,
              payload: existing.payload,
              log: buildHrEmployeeMasterExportLogResponse(existing),
            };
          }
          const created = await prisma.hrEmployeeMasterExportLog.create({
            data: {
              idempotencyKey,
              requestHash: source.requestHash,
              reexportOfId: source.id,
              updatedSince: source.updatedSince,
              exportedUntil: source.exportedUntil,
              status: IntegrationRunStatus.success,
              exportedCount: source.exportedCount,
              payload: source.payload,
              message: 'redispatched',
              startedAt: now,
              finishedAt: now,
              createdBy: actorId,
            },
          });
          await logAudit({
            ...auditContextFromRequest(req),
            action: 'integration_hr_employee_master_export_redispatched',
            targetTable: 'HrEmployeeMasterExportLog',
            targetId: created.id,
            metadata: {
              sourceLogId: source.id,
              idempotencyKey,
              exportedCount: created.exportedCount,
            } as Prisma.InputJsonValue,
          });
          return {
            replayed: false,
            payload: created.payload,
            log: buildHrEmployeeMasterExportLogResponse(created),
          };
        }
        case 'accounting_ics_export': {
          const source = await prisma.accountingIcsExportLog.findUnique({
            where: { id },
          });
          if (!source) {
            return reply
              .code(
                integrationExportRedispatchStatusCode(
                  'integration_export_log_not_found',
                ),
              )
              .send({ error: 'integration_export_log_not_found' });
          }
          if (source.status === IntegrationRunStatus.running) {
            return reply.code(409).send({
              error: 'dispatch_in_progress',
              logId: source.id,
            });
          }
          if (
            !source.payload ||
            source.status !== IntegrationRunStatus.success
          ) {
            return reply.code(409).send({
              error: 'redispatch_source_not_exported',
              logId: source.id,
            });
          }
          const existing = await prisma.accountingIcsExportLog.findUnique({
            where: { idempotencyKey },
          });
          if (existing) {
            if (
              existing.requestHash !== source.requestHash ||
              existing.reexportOfId !== source.id
            ) {
              await logAudit({
                ...auditContextFromRequest(req),
                action: 'integration_accounting_ics_export_redispatch_conflict',
                targetTable: 'AccountingIcsExportLog',
                targetId: existing.id,
                metadata: {
                  sourceLogId: source.id,
                  idempotencyKey,
                  requestHash: source.requestHash,
                  existingRequestHash: existing.requestHash,
                  existingReexportOfId: existing.reexportOfId,
                } as Prisma.InputJsonValue,
              });
              return reply.code(409).send({ error: 'idempotency_conflict' });
            }
            if (existing.status === IntegrationRunStatus.running) {
              return reply.code(409).send({
                error: 'dispatch_in_progress',
                logId: existing.id,
              });
            }
            await logAudit({
              ...auditContextFromRequest(req),
              action: 'integration_accounting_ics_export_redispatch_replayed',
              targetTable: 'AccountingIcsExportLog',
              targetId: existing.id,
              metadata: {
                sourceLogId: source.id,
                idempotencyKey,
                status: existing.status,
                periodKey: existing.periodKey,
              } as Prisma.InputJsonValue,
            });
            return {
              replayed: true,
              payload: existing.payload,
              log: buildAccountingIcsExportLogResponse(existing),
            };
          }
          const created = await prisma.accountingIcsExportLog.create({
            data: {
              idempotencyKey,
              requestHash: source.requestHash,
              reexportOfId: source.id,
              periodKey: source.periodKey,
              exportedUntil: source.exportedUntil,
              status: IntegrationRunStatus.success,
              exportedCount: source.exportedCount,
              payload: source.payload,
              message: 'redispatched',
              startedAt: now,
              finishedAt: now,
              createdBy: actorId,
            },
          });
          await logAudit({
            ...auditContextFromRequest(req),
            action: 'integration_accounting_ics_export_redispatched',
            targetTable: 'AccountingIcsExportLog',
            targetId: created.id,
            metadata: {
              sourceLogId: source.id,
              idempotencyKey,
              periodKey: created.periodKey,
              exportedCount: created.exportedCount,
            } as Prisma.InputJsonValue,
          });
          return {
            replayed: false,
            payload: created.payload,
            log: buildAccountingIcsExportLogResponse(created),
          };
        }
        default:
          return reply
            .code(
              integrationExportRedispatchStatusCode(
                'integration_export_log_not_found',
              ),
            )
            .send({ error: 'integration_export_log_not_found' });
      }
    },
  );

  app.post(
    '/integrations/hr/attendance/closings',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationHrAttendanceClosingCreateSchema,
    },
    async (req, reply) => {
      const body = req.body as {
        periodKey: string;
        reclose?: boolean;
      };
      try {
        const result = await closeAttendancePeriod({
          periodKey: body.periodKey,
          reclose: body.reclose ?? false,
          actorId: req.user?.userId ?? null,
        });
        await logAudit({
          ...auditContextFromRequest(req),
          action: body.reclose
            ? 'attendance_closing_reclosed'
            : 'attendance_closing_created',
          targetTable: 'AttendanceClosingPeriod',
          targetId: result.closing.id,
          metadata: {
            periodKey: result.closing.periodKey,
            version: result.closing.version,
            summaryCount: result.closing.summaryCount,
          },
        });
        return {
          closing: result.closing,
          summaries: result.summaries,
        };
      } catch (error) {
        if (error instanceof AttendanceClosingError) {
          return reply.code(attendanceClosingStatusCode(error.code)).send({
            error: error.code,
            message: error.message,
            details: error.details,
          });
        }
        throw error;
      }
    },
  );

  app.get(
    '/integrations/hr/attendance/closings',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationHrAttendanceClosingListQuerySchema,
    },
    async (req) => {
      const { periodKey, limit, offset } = req.query as {
        periodKey?: string;
        limit?: number;
        offset?: number;
      };
      const take = parseBoundedInteger(limit, 50, 200);
      const skip = parseBoundedNonNegativeInteger(offset, 0, 100000);
      const items = await prisma.attendanceClosingPeriod.findMany({
        where: periodKey ? { periodKey } : undefined,
        orderBy: [{ periodKey: 'desc' }, { version: 'desc' }],
        take,
        skip,
        select: {
          id: true,
          periodKey: true,
          version: true,
          status: true,
          closedAt: true,
          closedBy: true,
          supersededAt: true,
          supersededBy: true,
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
      });
      return { items, limit: take, offset: skip };
    },
  );

  app.get(
    '/integrations/hr/attendance/closings/:id/summaries',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationHrAttendanceClosingSummaryListSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { limit, offset } = req.query as {
        limit?: number;
        offset?: number;
      };
      const take = parseBoundedInteger(limit, 200, 1000);
      const skip = parseBoundedNonNegativeInteger(offset, 0, 100000);
      const closing = await prisma.attendanceClosingPeriod.findUnique({
        where: { id },
        select: {
          id: true,
          periodKey: true,
          version: true,
          status: true,
          closedAt: true,
          summaryCount: true,
        },
      });
      if (!closing) {
        return reply.code(404).send({ error: 'attendance_closing_not_found' });
      }
      const items = await prisma.attendanceMonthlySummary.findMany({
        where: { closingPeriodId: id },
        orderBy: [{ employeeCode: 'asc' }, { userId: 'asc' }],
        take,
        skip,
        select: {
          id: true,
          userId: true,
          employeeCode: true,
          workedDayCount: true,
          scheduledWorkMinutes: true,
          approvedWorkMinutes: true,
          overtimeTotalMinutes: true,
          paidLeaveMinutes: true,
          unpaidLeaveMinutes: true,
          totalLeaveMinutes: true,
          sourceTimeEntryCount: true,
          sourceLeaveRequestCount: true,
        },
      });
      return { closing, items, limit: take, offset: skip };
    },
  );

  app.get(
    '/integrations/hr/exports/wellbeing',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { limit, offset, updatedSince } = req.query as {
        limit?: string;
        offset?: string;
        updatedSince?: string;
      };
      const since = parseUpdatedSince(updatedSince);
      if (since === null) {
        return reply.code(400).send({ error: 'invalid_updatedSince' });
      }
      const take = parseLimit(limit, 500, 2000);
      const skip = parseOffset(offset);
      const items = await prisma.wellbeingEntry.findMany({
        where: since ? { updatedAt: { gt: since } } : undefined,
        orderBy: { entryDate: 'desc' },
        take,
        skip,
      });
      return { items, limit: take, offset: skip };
    },
  );

  app.get(
    '/integrations/hr/exports/leaves',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationHrLeaveExportQuerySchema,
    },
    async (req, reply) => {
      const parsed = parseLeaveExportQuery(req.query as HrLeaveExportQuery);
      if (!parsed.ok) {
        return reply.code(400).send({ error: 'invalid_updatedSince' });
      }
      const payload = await buildHrLeaveExportPayload({
        target: parsed.target,
        updatedSince: parsed.updatedSince,
        limit: parsed.limit,
        offset: parsed.offset,
        actorId: req.user?.userId ?? null,
      });
      return payload;
    },
  );

  app.post(
    '/integrations/hr/exports/leaves/dispatch',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationHrLeaveExportDispatchSchema,
    },
    async (req, reply) => {
      const body = req.body as HrLeaveExportQuery & { idempotencyKey: string };
      const parsed = parseLeaveExportQuery(body);
      if (!parsed.ok) {
        return reply.code(400).send({ error: 'invalid_updatedSince' });
      }
      const idempotencyKey = body.idempotencyKey.trim();
      if (!idempotencyKey) {
        return reply.code(400).send({ error: 'invalid_idempotencyKey' });
      }
      const requestHash = buildLeaveExportRequestHash({
        target: parsed.target,
        updatedSince: parsed.updatedSince?.toISOString() ?? null,
        limit: parsed.limit,
        offset: parsed.offset,
      });
      const existing = await prisma.leaveIntegrationExportLog.findUnique({
        where: {
          target_idempotencyKey: {
            target: parsed.target,
            idempotencyKey,
          },
        },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          await logAudit({
            ...auditContextFromRequest(req),
            action: 'integration_hr_leave_export_dispatch_conflict',
            targetTable: 'leave_integration_export_logs',
            targetId: existing.id,
            metadata: {
              target: parsed.target,
              idempotencyKey,
              requestHash,
              existingRequestHash: existing.requestHash,
            } as Prisma.InputJsonValue,
          });
          return reply.code(409).send({ error: 'idempotency_conflict' });
        }
        if (existing.status === IntegrationRunStatus.running) {
          return reply.code(409).send({
            error: 'dispatch_in_progress',
            logId: existing.id,
          });
        }
        await logAudit({
          ...auditContextFromRequest(req),
          action: 'integration_hr_leave_export_dispatch_replayed',
          targetTable: 'leave_integration_export_logs',
          targetId: existing.id,
          metadata: {
            target: parsed.target,
            idempotencyKey,
            status: existing.status,
            exportedCount: existing.exportedCount,
          } as Prisma.InputJsonValue,
        });
        return {
          replayed: true,
          payload: existing.payload,
          log: buildLeaveExportLogResponse(existing),
        };
      }

      const startedAt = new Date();
      const log = await prisma.leaveIntegrationExportLog.create({
        data: {
          target: parsed.target,
          idempotencyKey,
          requestHash,
          updatedSince: parsed.updatedSince ?? null,
          exportedUntil: startedAt,
          status: IntegrationRunStatus.running,
          startedAt,
          createdBy: req.user?.userId ?? null,
        },
      });

      try {
        const payload = await buildHrLeaveExportPayload({
          target: parsed.target,
          updatedSince: parsed.updatedSince,
          exportedUntil: startedAt,
          limit: parsed.limit,
          offset: parsed.offset,
          actorId: req.user?.userId ?? null,
        });
        const finishedAt = new Date();
        const updated = await prisma.leaveIntegrationExportLog.update({
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
          ...auditContextFromRequest(req),
          action: 'integration_hr_leave_export_dispatched',
          targetTable: 'leave_integration_export_logs',
          targetId: updated.id,
          metadata: {
            target: parsed.target,
            idempotencyKey,
            exportedCount: payload.exportedCount,
          } as Prisma.InputJsonValue,
        });
        return {
          replayed: false,
          payload,
          log: buildLeaveExportLogResponse(updated),
        };
      } catch (error) {
        const finishedAt = new Date();
        const message = error instanceof Error ? error.message : String(error);
        const failed = await prisma.leaveIntegrationExportLog.update({
          where: { id: log.id },
          data: {
            status: IntegrationRunStatus.failed,
            message,
            finishedAt,
          },
        });
        await logAudit({
          ...auditContextFromRequest(req),
          action: 'integration_hr_leave_export_dispatch_failed',
          targetTable: 'leave_integration_export_logs',
          targetId: failed.id,
          metadata: {
            target: parsed.target,
            idempotencyKey,
            message: truncateForAudit(message),
          } as Prisma.InputJsonValue,
        });
        throw error;
      }
    },
  );

  app.get(
    '/integrations/hr/exports/leaves/dispatch-logs',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationHrLeaveExportLogListQuerySchema,
    },
    async (req) => {
      const query = req.query as {
        target?: LeaveExportTarget;
        limit?: number | string;
        offset?: number | string;
        idempotencyKey?: string;
      };
      const limit = parseBoundedInteger(
        query.limit,
        DEFAULT_LEAVE_EXPORT_LOG_LIMIT,
        MAX_LEAVE_EXPORT_LOG_LIMIT,
      );
      const offset = parseBoundedNonNegativeInteger(
        query.offset,
        0,
        MAX_LEAVE_EXPORT_OFFSET,
      );
      const idempotencyKey =
        typeof query.idempotencyKey === 'string'
          ? query.idempotencyKey.trim()
          : '';
      const target =
        typeof query.target === 'string'
          ? normalizeLeaveExportTarget(query.target)
          : undefined;
      const items = await prisma.leaveIntegrationExportLog.findMany({
        where: {
          ...(target ? { target } : {}),
          ...(idempotencyKey ? { idempotencyKey } : {}),
        },
        select: {
          id: true,
          target: true,
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
        take: limit,
        skip: offset,
      });
      return {
        items: items.map((item) => buildLeaveExportLogResponse(item)),
        limit,
        offset,
      };
    },
  );
}
