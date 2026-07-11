import { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { IntegrationRunStatus, Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { ensureLeaveSetting } from '../services/leaveSettings.js';
import { resolveLeaveRequestMinutesWithCalendar } from '../services/leaveEntitlements.js';
import { normalizeLeaveTypeInput } from '../services/leaveTypes.js';
import { resolveUserWorkdayMinutesForDates } from '../services/leaveWorkdayCalendar.js';
import {
  AttendanceClosingError,
  closeAttendancePeriod,
  parseAttendancePeriodKey,
} from '../services/attendanceClosings.js';
import {
  buildIntegrationReconciliationDetails,
  buildIntegrationReconciliationSummary,
} from '../services/integrationReconciliation.js';
import {
  StatutoryAccountingActualImportError,
  importStatutoryAccountingActuals,
  type StatutoryAccountingActualImportPayload,
} from '../services/statutoryAccountingActuals.js';
import {
  AccountingIcsExportError,
  buildAccountingIcsCsv,
  buildAccountingIcsCsvFilename,
  buildAccountingIcsExportPayload,
  buildAccountingIcsTemplateCsv,
} from '../services/accountingIcsExport.js';
import {
  AccountingMappingRuleServiceError,
  createAccountingMappingRule,
  listAccountingMappingRules,
  reapplyAccountingMappingRulesWithAudit,
  updateAccountingMappingRule,
  type AccountingMappingRuleInput,
} from '../services/accountingMappingRules.js';
import {
  IntegrationRunServiceError,
  MAX_RETRY_BASE_MINUTES,
  MAX_RETRY_MAX,
  executeManualIntegrationRun,
  getIntegrationRunMetrics,
  listIntegrationRuns,
  runDueIntegrationJobs,
} from '../services/integrationRuns.js';
import {
  AccountingIcsExportFormat,
  DEFAULT_ACCOUNTING_ICS_EXPORT_LOG_LIMIT,
  DEFAULT_ATTENDANCE_EXPORT_LOG_LIMIT,
  DEFAULT_EMPLOYEE_MASTER_EXPORT_LOG_LIMIT,
  IntegrationExportDispatchError,
  MAX_ACCOUNTING_ICS_EXPORT_LOG_LIMIT,
  MAX_ACCOUNTING_ICS_EXPORT_OFFSET,
  MAX_ATTENDANCE_EXPORT_LOG_LIMIT,
  MAX_ATTENDANCE_EXPORT_OFFSET,
  MAX_EMPLOYEE_MASTER_EXPORT_LOG_LIMIT,
  MAX_EMPLOYEE_MASTER_EXPORT_OFFSET,
  HrAttendanceExportFormat,
  HrEmployeeMasterExportError,
  HrEmployeeMasterExportFormat,
  accountingIcsExportStatusCode,
  buildAccountingIcsExportLogResponse,
  buildHrAttendanceCsv,
  buildHrAttendanceCsvFilename,
  buildHrAttendanceExportLogResponse,
  buildHrAttendanceExportPayload,
  buildHrEmployeeMasterCsv,
  buildHrEmployeeMasterCsvFilename,
  buildHrEmployeeMasterExportLogResponse,
  buildHrEmployeeMasterExportPayload,
  dispatchAccountingIcsExport,
  dispatchHrAttendanceExport,
  dispatchHrEmployeeMasterExport,
  hrAttendanceExportStatusCode,
  hrEmployeeMasterExportStatusCode,
  listAccountingIcsExportLogs,
  listHrAttendanceExportLogs,
  listHrEmployeeMasterExportLogs,
  normalizeHrAttendanceFormat,
  parseAccountingIcsExportQuery,
  parseHrEmployeeMasterExportQuery,
  resolveAccountingIcsTemplateOptions,
} from '../services/integrationExports.js';
import {
  IntegrationExportJobServiceError,
  buildLeaveExportLogResponse,
  listIntegrationExportJobs,
  redispatchIntegrationExportJob,
  type IntegrationExportJobKind,
  type LeaveExportTarget,
} from '../services/integrationExportJobs.js';
import { sendCsv, toCsv } from '../utils/csv.js';
import { toDateOnly } from '../utils/date.js';
import {
  integrationAccountingIcsExportDispatchSchema,
  integrationAccountingIcsExportLogListQuerySchema,
  integrationAccountingMappingRuleCreateSchema,
  integrationAccountingMappingRuleListQuerySchema,
  integrationAccountingMappingRulePatchSchema,
  integrationAccountingMappingRuleReapplySchema,
  integrationAccountingIcsExportQuerySchema,
  integrationExportJobListQuerySchema,
  integrationExportJobRedispatchSchema,
  integrationHrAttendanceExportDispatchSchema,
  integrationHrAttendanceExportLogListQuerySchema,
  integrationHrAttendanceExportQuerySchema,
  integrationHrAttendanceClosingCreateSchema,
  integrationHrAttendanceClosingListQuerySchema,
  integrationHrAttendanceClosingSummaryListSchema,
  integrationHrEmployeeMasterExportDispatchSchema,
  integrationHrEmployeeMasterExportLogListQuerySchema,
  integrationHrEmployeeMasterExportQuerySchema,
  integrationHrLeaveExportDispatchSchema,
  integrationHrLeaveExportLogListQuerySchema,
  integrationHrLeaveExportQuerySchema,
  integrationReconciliationDetailsQuerySchema,
  integrationReconciliationSummaryQuerySchema,
  integrationRunMetricsQuerySchema,
  integrationSettingPatchSchema,
  integrationSettingSchema,
  integrationStatutoryAccountingActualImportSchema,
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

function parseUpdatedSince(raw?: string) {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function statutoryAccountingActualImportStatusCode(code: string) {
  switch (code) {
    case 'invalid_statutory_accounting_actual_import':
      return 400;
    case 'statutory_accounting_actual_import_batch_conflict':
      return 409;
    default:
      return 400;
  }
}

function sanitizeSpreadsheetCsvCell(value: unknown) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

type IntegrationReconciliationDetailsResponse = Awaited<
  ReturnType<typeof buildIntegrationReconciliationDetails>
>;

function buildIntegrationReconciliationDetailsCsv(
  details: IntegrationReconciliationDetailsResponse,
) {
  const headers = [
    'section',
    'key',
    'currency',
    'totalCount',
    'readyCount',
    'pendingMappingCount',
    'blockedCount',
    'invalidReadyCount',
    'readyAmountTotal',
    'statutoryActualAmountTotal',
    'varianceAmount',
  ];
  const rows = [
    ...details.accounting.byProject.map((row) => [
      'project',
      sanitizeSpreadsheetCsvCell(row.key),
      sanitizeSpreadsheetCsvCell(row.currency),
      row.totalCount,
      row.readyCount,
      row.pendingMappingCount,
      row.blockedCount,
      row.invalidReadyCount,
      row.readyAmountTotal,
      row.statutoryActualAmountTotal,
      row.varianceAmount,
    ]),
    ...details.accounting.byDepartment.map((row) => [
      'department',
      sanitizeSpreadsheetCsvCell(row.key),
      sanitizeSpreadsheetCsvCell(row.currency),
      row.totalCount,
      row.readyCount,
      row.pendingMappingCount,
      row.blockedCount,
      row.invalidReadyCount,
      row.readyAmountTotal,
      row.statutoryActualAmountTotal,
      row.varianceAmount,
    ]),
  ];
  return toCsv(headers, rows);
}

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
      try {
        return await executeManualIntegrationRun({
          settingId: id,
          actorUserId: req.user?.userId ?? null,
          auditContext: auditContextFromRequest(req),
        });
      } catch (error) {
        if (error instanceof IntegrationRunServiceError) {
          return reply.code(error.statusCode).send(error.responseBody);
        }
        throw error;
      }
    },
  );

  app.get(
    '/integration-runs',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      return listIntegrationRuns({
        query: req.query as {
          settingId?: string;
          limit?: string;
          offset?: string;
        },
      });
    },
  );

  app.get(
    '/integration-runs/metrics',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationRunMetricsQuerySchema,
    },
    async (req) => {
      return getIntegrationRunMetrics({
        query: req.query as {
          settingId?: string;
          days?: number | string;
          limit?: number | string;
        },
      });
    },
  );

  app.post(
    '/jobs/integrations/run',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      return runDueIntegrationJobs({
        actorUserId: req.user?.userId ?? null,
        auditContext: auditContextFromRequest(req),
      });
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
      try {
        return await dispatchHrEmployeeMasterExport({
          idempotencyKey,
          updatedSince: parsed.updatedSince,
          limit: parsed.limit,
          offset: parsed.offset,
          actorUserId: req.user?.userId ?? null,
          auditContext: auditContextFromRequest(req),
        });
      } catch (error) {
        if (error instanceof IntegrationExportDispatchError) {
          return reply.code(error.statusCode).send(error.responseBody);
        }
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
      return listHrEmployeeMasterExportLogs({
        limit,
        offset,
        idempotencyKey: idempotencyKey || undefined,
      });
    },
  );

  app.get(
    '/integrations/accounting/mapping-rules',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationAccountingMappingRuleListQuerySchema,
    },
    async (req) => {
      return listAccountingMappingRules({
        query: req.query as {
          mappingKey?: string;
          isActive?: boolean | string;
          limit?: number | string;
          offset?: number | string;
        },
      });
    },
  );

  app.post(
    '/integrations/accounting/mapping-rules',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationAccountingMappingRuleCreateSchema,
    },
    async (req, reply) => {
      try {
        const created = await createAccountingMappingRule({
          body: req.body as AccountingMappingRuleInput,
          actorUserId: req.user?.userId ?? null,
          auditContext: auditContextFromRequest(req),
        });
        return reply.code(201).send(created);
      } catch (error) {
        if (error instanceof AccountingMappingRuleServiceError) {
          return reply.code(error.statusCode).send(error.responseBody);
        }
        throw error;
      }
    },
  );

  app.patch(
    '/integrations/accounting/mapping-rules/:id',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationAccountingMappingRulePatchSchema,
    },
    async (req, reply) => {
      const params = req.params as { id: string };
      try {
        return await updateAccountingMappingRule({
          id: params.id,
          body: (req.body ?? {}) as Partial<AccountingMappingRuleInput>,
          actorUserId: req.user?.userId ?? null,
          auditContext: auditContextFromRequest(req),
        });
      } catch (error) {
        if (error instanceof AccountingMappingRuleServiceError) {
          return reply.code(error.statusCode).send(error.responseBody);
        }
        throw error;
      }
    },
  );

  app.post(
    '/integrations/accounting/mapping-rules/reapply',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationAccountingMappingRuleReapplySchema,
    },
    async (req, reply) => {
      try {
        return await reapplyAccountingMappingRulesWithAudit({
          body: (req.body ?? {}) as {
            periodKey?: string;
            mappingKey?: string;
            limit?: number | string;
            offset?: number | string;
          },
          actorUserId: req.user?.userId ?? null,
          auditContext: auditContextFromRequest(req),
        });
      } catch (error) {
        if (error instanceof AccountingMappingRuleServiceError) {
          return reply.code(error.statusCode).send(error.responseBody);
        }
        throw error;
      }
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
          companyCode?: string;
          companyName?: string;
          fiscalYearStartMonth?: number | string;
          limit?: number | string;
          offset?: number | string;
        },
      );
      try {
        const templateOptions = resolveAccountingIcsTemplateOptions(parsed);
        const payload = await buildAccountingIcsExportPayload({
          periodKey: parsed.periodKey,
          limit: parsed.limit,
          offset: parsed.offset,
        });
        if (parsed.format === 'csv' || parsed.format === 'ics_template') {
          return reply
            .header(
              'Content-Disposition',
              `attachment; filename="${buildAccountingIcsCsvFilename({
                exportedUntil: payload.exportedUntil,
                periodKey: payload.periodKey,
                format: parsed.format,
              })}"`,
            )
            .type('text/csv; charset=shift_jis')
            .send(
              parsed.format === 'ics_template' && templateOptions
                ? buildAccountingIcsTemplateCsv(payload, templateOptions)
                : buildAccountingIcsCsv(payload),
            );
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
          companyCode?: string;
          companyName?: string;
          fiscalYearStartMonth?: number | string;
          limit?: number | string;
          offset?: number | string;
        },
      );
      const body = req.body as { idempotencyKey: string };
      const idempotencyKey = body.idempotencyKey.trim();
      if (!idempotencyKey) {
        return reply.code(400).send({ error: 'invalid_idempotencyKey' });
      }
      try {
        return await dispatchAccountingIcsExport({
          idempotencyKey,
          query: parsed,
          actorUserId: req.user?.userId ?? null,
          auditContext: auditContextFromRequest(req),
        });
      } catch (error) {
        if (error instanceof IntegrationExportDispatchError) {
          return reply.code(error.statusCode).send(error.responseBody);
        }
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
      return listAccountingIcsExportLogs({
        limit,
        offset,
        periodKey: periodKey || undefined,
        status,
        idempotencyKey: idempotencyKey || undefined,
      });
    },
  );

  app.get(
    '/integrations/jobs/exports',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationExportJobListQuerySchema,
    },
    async (req) => {
      return listIntegrationExportJobs({
        query: req.query as {
          kind?: IntegrationExportJobKind;
          status?: IntegrationRunStatus;
          limit?: number | string;
          offset?: number | string;
        },
      });
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
      try {
        return await redispatchIntegrationExportJob({
          kind,
          id,
          idempotencyKey: body.idempotencyKey,
          actorUserId: req.user?.userId ?? null,
          auditContext: auditContextFromRequest(req),
        });
      } catch (error) {
        if (error instanceof IntegrationExportJobServiceError) {
          return reply.code(error.statusCode).send(error.responseBody);
        }
        throw error;
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
          overtimeWithinStatutoryMinutesTotal: true,
          overtimeOverStatutoryMinutesTotal: true,
          holidayWorkMinutesTotal: true,
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
      return { closing, items, limit: take, offset: skip };
    },
  );

  app.get(
    '/integrations/hr/exports/attendance',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationHrAttendanceExportQuerySchema,
    },
    async (req, reply) => {
      const query = req.query as {
        format?: HrAttendanceExportFormat;
        periodKey: string;
      };
      try {
        const payload = await buildHrAttendanceExportPayload({
          periodKey: query.periodKey,
        });
        if (normalizeHrAttendanceFormat(query.format) === 'csv') {
          return sendCsv(
            reply,
            buildHrAttendanceCsvFilename(payload),
            buildHrAttendanceCsv(payload),
          );
        }
        return payload;
      } catch (error) {
        if (error instanceof AttendanceClosingError) {
          return reply.code(hrAttendanceExportStatusCode(error.code)).send({
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
    '/integrations/hr/exports/attendance/dispatch',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationHrAttendanceExportDispatchSchema,
    },
    async (req, reply) => {
      const body = req.body as {
        periodKey: string;
        idempotencyKey: string;
      };
      const periodKey = body.periodKey.trim();
      const idempotencyKey = body.idempotencyKey.trim();
      if (!idempotencyKey) {
        return reply.code(400).send({ error: 'invalid_idempotencyKey' });
      }
      try {
        return await dispatchHrAttendanceExport({
          periodKey,
          idempotencyKey,
          actorUserId: req.user?.userId ?? null,
          auditContext: auditContextFromRequest(req),
        });
      } catch (error) {
        if (error instanceof IntegrationExportDispatchError) {
          return reply.code(error.statusCode).send(error.responseBody);
        }
        if (error instanceof AttendanceClosingError) {
          return reply.code(hrAttendanceExportStatusCode(error.code)).send({
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
    '/integrations/hr/exports/attendance/dispatch-logs',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationHrAttendanceExportLogListQuerySchema,
    },
    async (req) => {
      const query = req.query as {
        periodKey?: string;
        limit?: number | string;
        offset?: number | string;
        idempotencyKey?: string;
      };
      const limit = parseBoundedInteger(
        query.limit,
        DEFAULT_ATTENDANCE_EXPORT_LOG_LIMIT,
        MAX_ATTENDANCE_EXPORT_LOG_LIMIT,
      );
      const offset = parseBoundedNonNegativeInteger(
        query.offset,
        0,
        MAX_ATTENDANCE_EXPORT_OFFSET,
      );
      return listHrAttendanceExportLogs({
        limit,
        offset,
        periodKey:
          typeof query.periodKey === 'string' && query.periodKey.trim()
            ? query.periodKey.trim()
            : undefined,
        idempotencyKey:
          typeof query.idempotencyKey === 'string' &&
          query.idempotencyKey.trim()
            ? query.idempotencyKey.trim()
            : undefined,
      });
    },
  );

  app.post(
    '/integrations/accounting/statutory-actuals/import',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationStatutoryAccountingActualImportSchema,
    },
    async (req, reply) => {
      try {
        const result = await importStatutoryAccountingActuals({
          payload: req.body as StatutoryAccountingActualImportPayload,
          actorUserId: req.user?.userId ?? null,
        });
        await logAudit({
          ...auditContextFromRequest(req),
          action: 'integration_statutory_accounting_actual_imported',
          targetTable: 'StatutoryAccountingActual',
          targetId: result.importBatchKey,
          metadata: {
            periodKey: result.periodKey,
            importBatchKey: result.importBatchKey,
            accountingSystem: result.accountingSystem,
            importedCount: result.importedCount,
            importedAt: result.importedAt,
          } as Prisma.InputJsonValue,
        });
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof StatutoryAccountingActualImportError) {
          return reply
            .code(statutoryAccountingActualImportStatusCode(error.code))
            .send({
              error: error.code,
              message: error.message,
              details: error.details,
            });
        }
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
    '/integrations/reconciliation/summary',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationReconciliationSummaryQuerySchema,
    },
    async (req, reply) => {
      const { periodKey } = req.query as {
        periodKey: string;
      };
      try {
        const summary = await buildIntegrationReconciliationSummary({
          periodKey,
        });
        return {
          periodKey: summary.periodKey,
          attendance: {
            latestClosing: summary.attendance.latestClosing,
          },
          payroll: {
            latestEmployeeMasterExport: summary.payroll
              .latestEmployeeMasterExport
              ? buildHrEmployeeMasterExportLogResponse(
                  summary.payroll.latestEmployeeMasterExport,
                )
              : null,
            latestEmployeeMasterFullExport: summary.payroll
              .latestEmployeeMasterFullExport
              ? buildHrEmployeeMasterExportLogResponse(
                  summary.payroll.latestEmployeeMasterFullExport,
                )
              : null,
            comparisonStatus: summary.payroll.comparisonStatus,
            attendanceEmployeeCount: summary.payroll.attendanceEmployeeCount,
            employeeMasterExportCount:
              summary.payroll.employeeMasterExportCount,
            matchedEmployeeCount: summary.payroll.matchedEmployeeCount,
            countsAligned: summary.payroll.countsAligned,
            attendanceOnlyCount: summary.payroll.attendanceOnlyCount,
            attendanceOnlyEmployeeCodes:
              summary.payroll.attendanceOnlyEmployeeCodes,
            employeeMasterOnlyCount: summary.payroll.employeeMasterOnlyCount,
            employeeMasterOnlyEmployeeCodes:
              summary.payroll.employeeMasterOnlyEmployeeCodes,
          },
          accounting: {
            latestIcsExport: summary.accounting.latestIcsExport
              ? buildAccountingIcsExportLogResponse(
                  summary.accounting.latestIcsExport,
                )
              : null,
            comparisonStatus: summary.accounting.comparisonStatus,
            latestExportedCount: summary.accounting.latestExportedCount,
            countsAligned: summary.accounting.countsAligned,
            mappingComplete: summary.accounting.mappingComplete,
            staging: summary.accounting.staging,
            statutoryActuals: summary.accounting.statutoryActuals,
          },
          hasBlockingDifferences: summary.hasBlockingDifferences,
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
    '/integrations/reconciliation/details',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: integrationReconciliationDetailsQuerySchema,
    },
    async (req, reply) => {
      const { periodKey, format } = req.query as {
        periodKey: string;
        format?: 'json' | 'csv';
      };
      try {
        const details = await buildIntegrationReconciliationDetails({
          periodKey,
        });
        if (format === 'csv') {
          return sendCsv(
            reply,
            `integration-reconciliation-details-${details.periodKey}.csv`,
            buildIntegrationReconciliationDetailsCsv(details),
          );
        }
        return details;
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
