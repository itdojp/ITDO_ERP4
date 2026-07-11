import { FastifyInstance } from 'fastify';
import { IntegrationRunStatus, Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import {
  AttendanceClosingError,
  createAttendanceClosing,
  getAttendanceClosingSummaries,
  listAttendanceClosings,
  parseAttendancePeriodKey,
} from '../services/attendanceClosings.js';
import {
  buildIntegrationReconciliationDetails,
  buildIntegrationReconciliationDetailsCsv,
  buildIntegrationReconciliationDetailsCsvFilename,
  getIntegrationReconciliationSummary,
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
  buildHrAttendanceCsv,
  buildHrAttendanceCsvFilename,
  buildHrAttendanceExportLogResponse,
  buildHrAttendanceExportPayload,
  buildHrEmployeeMasterCsv,
  buildHrEmployeeMasterCsvFilename,
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
  listIntegrationExportJobs,
  redispatchIntegrationExportJob,
  type IntegrationExportJobKind,
} from '../services/integrationExportJobs.js';
import {
  IntegrationLeaveExportServiceError,
  buildHrLeaveExportPayload,
  dispatchHrLeaveExport,
  listHrLeaveExportLogs,
  parseHrLeaveExportQuery,
  type HrLeaveExportQuery,
  type LeaveExportTarget,
} from '../services/integrationLeaveExports.js';
import { sendCsv } from '../utils/csv.js';
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
  if (code === 'attendance_closing_not_found') return 404;
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
        return await createAttendanceClosing({
          periodKey: body.periodKey,
          reclose: body.reclose ?? false,
          actorId: req.user?.userId ?? null,
          auditContext: auditContextFromRequest(req),
        });
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
      return listAttendanceClosings(
        req.query as {
          periodKey?: string;
          limit?: number | string;
          offset?: number | string;
        },
      );
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
      try {
        return await getAttendanceClosingSummaries({
          id,
          ...(req.query as {
            limit?: number | string;
            offset?: number | string;
          }),
        });
      } catch (error) {
        if (error instanceof AttendanceClosingError) {
          if (error.code === 'attendance_closing_not_found') {
            return reply.code(404).send({ error: error.code });
          }
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
        return await getIntegrationReconciliationSummary({
          periodKey,
        });
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
            buildIntegrationReconciliationDetailsCsvFilename(details.periodKey),
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
      const parsed = parseHrLeaveExportQuery(req.query as HrLeaveExportQuery);
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
      try {
        return await dispatchHrLeaveExport({
          query: body,
          idempotencyKey: body.idempotencyKey,
          actorUserId: req.user?.userId ?? null,
          auditContext: auditContextFromRequest(req),
        });
      } catch (error) {
        if (error instanceof IntegrationLeaveExportServiceError) {
          return reply.code(error.statusCode).send(error.responseBody);
        }
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
      return await listHrLeaveExportLogs(query);
    },
  );
}
