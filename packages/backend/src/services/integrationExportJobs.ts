import { IntegrationRunStatus, Prisma } from '@prisma/client';
import type { AuditContext } from './audit.js';
import { logAudit as defaultLogAudit } from './audit.js';
import { prisma } from './db.js';
import {
  buildAccountingIcsExportLogResponse,
  buildHrAttendanceExportLogResponse,
  buildHrEmployeeMasterExportLogResponse,
} from './integrationExports.js';

export type IntegrationExportJobKind =
  | 'hr_leave_export_attendance'
  | 'hr_leave_export_payroll'
  | 'hr_employee_master_export'
  | 'hr_attendance_export'
  | 'accounting_ics_export';

export type LeaveExportTarget = 'attendance' | 'payroll';

export const DEFAULT_INTEGRATION_EXPORT_JOB_LIMIT = 100;
export const MAX_INTEGRATION_EXPORT_JOB_LIMIT = 500;
export const MAX_INTEGRATION_EXPORT_JOB_OFFSET = 1000;
const MAX_INTEGRATION_EXPORT_JOB_FETCH =
  MAX_INTEGRATION_EXPORT_JOB_LIMIT + MAX_INTEGRATION_EXPORT_JOB_OFFSET;

type IntegrationExportJobClient = Prisma.TransactionClient | typeof prisma;

type IntegrationExportJobDependencies = {
  client?: IntegrationExportJobClient;
  /**
   * Audit persistence is injected separately from the Prisma client because
   * the shared audit service owns metadata normalization and failure handling.
   * Callers that need a custom transaction boundary should inject both.
   */
  logAudit?: typeof defaultLogAudit;
  now?: () => Date;
};

function resolveIntegrationExportJobDependencies(
  dependencies: IntegrationExportJobDependencies,
) {
  return {
    client: dependencies.client ?? prisma,
    logAudit: dependencies.logAudit ?? defaultLogAudit,
    now: dependencies.now ?? (() => new Date()),
  };
}

export class IntegrationExportJobServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly responseBody: Record<string, unknown>;

  constructor(
    code: string,
    statusCode: number,
    responseBody: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'IntegrationExportJobServiceError';
    this.code = code;
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

function serviceError(
  code: string,
  statusCode: number,
  responseBody: Record<string, unknown> = { error: code },
) {
  return new IntegrationExportJobServiceError(code, statusCode, responseBody);
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

export function normalizeIntegrationExportJobKind(
  value: unknown,
): IntegrationExportJobKind | undefined {
  switch (value) {
    case 'hr_leave_export_attendance':
    case 'hr_leave_export_payroll':
    case 'hr_employee_master_export':
    case 'hr_attendance_export':
    case 'accounting_ics_export':
      return value;
    default:
      return undefined;
  }
}

function normalizeIntegrationRunStatus(value: unknown) {
  return value === IntegrationRunStatus.running ||
    value === IntegrationRunStatus.success ||
    value === IntegrationRunStatus.failed
    ? value
    : undefined;
}

function compareStartedAtDesc(
  left: { startedAt: Date; id: string },
  right: { startedAt: Date; id: string },
) {
  const startedAtDiff = right.startedAt.getTime() - left.startedAt.getTime();
  if (startedAtDiff !== 0) return startedAtDiff;
  return right.id.localeCompare(left.id);
}

export function buildLeaveExportLogResponse(item: {
  id: string;
  target: string;
  idempotencyKey: string;
  reexportOfId: string | null;
  status: IntegrationRunStatus | string;
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

export function buildIntegrationExportJobResponse(
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
        kind: 'hr_attendance_export';
      } & ReturnType<typeof buildHrAttendanceExportLogResponse>)
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
        : item.kind === 'hr_attendance_export'
          ? {
              periodKey: item.periodKey,
              closingPeriodId: item.closingPeriodId,
              closingVersion: item.closingVersion,
            }
          : item.kind === 'hr_employee_master_export'
            ? { updatedSince: item.updatedSince }
            : {
                target: item.target,
                updatedSince: item.updatedSince,
              },
  };
}

export async function listIntegrationExportJobs(
  options: {
    query?: {
      kind?: IntegrationExportJobKind | string;
      status?: IntegrationRunStatus | string;
      limit?: number | string;
      offset?: number | string;
    };
  },
  dependencies: IntegrationExportJobDependencies = {},
) {
  const { client } = resolveIntegrationExportJobDependencies(dependencies);
  const query = options.query ?? {};
  const kind = normalizeIntegrationExportJobKind(query.kind);
  const status = normalizeIntegrationRunStatus(query.status);
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
  const shouldLoadHrAttendance = !kind || kind === 'hr_attendance_export';
  const shouldLoadAccounting = !kind || kind === 'accounting_ics_export';

  const [leaveLogs, employeeMasterLogs, hrAttendanceLogs, accountingLogs] =
    await Promise.all([
      shouldLoadLeave
        ? client.leaveIntegrationExportLog.findMany({
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
        ? client.hrEmployeeMasterExportLog.findMany({
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
      shouldLoadHrAttendance
        ? client.hrAttendanceExportLog.findMany({
            where: status ? { status } : undefined,
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
            take,
          })
        : Promise.resolve([]),
      shouldLoadAccounting
        ? client.accountingIcsExportLog.findMany({
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
    ]);

  const items = [
    ...leaveLogs.map((item) =>
      buildIntegrationExportJobResponse({
        kind:
          item.target === 'payroll'
            ? 'hr_leave_export_payroll'
            : 'hr_leave_export_attendance',
        ...buildLeaveExportLogResponse(item),
      }),
    ),
    ...employeeMasterLogs.map((item) =>
      buildIntegrationExportJobResponse({
        kind: 'hr_employee_master_export',
        ...buildHrEmployeeMasterExportLogResponse(item),
      }),
    ),
    ...hrAttendanceLogs.map((item) =>
      buildIntegrationExportJobResponse({
        kind: 'hr_attendance_export',
        ...buildHrAttendanceExportLogResponse(item),
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

  return { items, limit, offset };
}

function redispatchSourceNotFound() {
  return serviceError('integration_export_log_not_found', 404);
}

function dispatchInProgress(logId: string) {
  return serviceError('dispatch_in_progress', 409, {
    error: 'dispatch_in_progress',
    logId,
  });
}

function redispatchSourceNotExported(logId: string) {
  return serviceError('redispatch_source_not_exported', 409, {
    error: 'redispatch_source_not_exported',
    logId,
  });
}

function idempotencyConflict() {
  return serviceError('idempotency_conflict', 409);
}

async function logRedispatchAudit(
  dependencies: ReturnType<typeof resolveIntegrationExportJobDependencies>,
  auditContext: AuditContext | undefined,
  input: {
    action: string;
    targetTable: string;
    targetId: string;
    metadata: Prisma.InputJsonValue;
  },
) {
  await dependencies.logAudit({
    ...(auditContext ?? {}),
    action: input.action,
    targetTable: input.targetTable,
    targetId: input.targetId,
    metadata: input.metadata,
  });
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

export async function redispatchIntegrationExportJob(
  options: {
    kind: IntegrationExportJobKind | string;
    id: string;
    idempotencyKey: string;
    actorUserId?: string | null;
    auditContext?: AuditContext;
  },
  dependencies: IntegrationExportJobDependencies = {},
) {
  const resolved = resolveIntegrationExportJobDependencies(dependencies);
  const { client, now: nowFactory } = resolved;
  const kind = normalizeIntegrationExportJobKind(options.kind);
  const idempotencyKey =
    typeof options.idempotencyKey === 'string'
      ? options.idempotencyKey.trim()
      : '';
  if (!idempotencyKey) {
    throw serviceError('invalid_idempotencyKey', 400);
  }
  if (!kind) {
    throw redispatchSourceNotFound();
  }
  const actorId = options.actorUserId ?? null;
  const now = nowFactory();

  switch (kind) {
    case 'hr_leave_export_attendance':
    case 'hr_leave_export_payroll': {
      const target =
        kind === 'hr_leave_export_payroll' ? 'payroll' : 'attendance';
      const source = await client.leaveIntegrationExportLog.findUnique({
        where: { id: options.id },
      });
      if (!source || source.target !== target) throw redispatchSourceNotFound();
      if (source.status === IntegrationRunStatus.running) {
        throw dispatchInProgress(source.id);
      }
      if (!source.payload || source.status !== IntegrationRunStatus.success) {
        throw redispatchSourceNotExported(source.id);
      }

      const respondWithExisting = async (existing: typeof source) => {
        if (
          existing.requestHash !== source.requestHash ||
          existing.reexportOfId !== source.id
        ) {
          await logRedispatchAudit(resolved, options.auditContext, {
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
          throw idempotencyConflict();
        }
        if (existing.status === IntegrationRunStatus.running) {
          throw dispatchInProgress(existing.id);
        }
        await logRedispatchAudit(resolved, options.auditContext, {
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
      };

      const existing = await client.leaveIntegrationExportLog.findUnique({
        where: {
          target_idempotencyKey: { target, idempotencyKey },
        },
      });
      if (existing) return respondWithExisting(existing);

      let created: Awaited<
        ReturnType<typeof client.leaveIntegrationExportLog.create>
      >;
      try {
        created = await client.leaveIntegrationExportLog.create({
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
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const concurrent = await client.leaveIntegrationExportLog.findUnique({
            where: {
              target_idempotencyKey: { target, idempotencyKey },
            },
          });
          if (concurrent) return respondWithExisting(concurrent);
        }
        throw error;
      }
      await logRedispatchAudit(resolved, options.auditContext, {
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
      const source = await client.hrEmployeeMasterExportLog.findUnique({
        where: { id: options.id },
      });
      if (!source) throw redispatchSourceNotFound();
      if (source.status === IntegrationRunStatus.running) {
        throw dispatchInProgress(source.id);
      }
      if (!source.payload || source.status !== IntegrationRunStatus.success) {
        throw redispatchSourceNotExported(source.id);
      }

      const respondWithExisting = async (existing: typeof source) => {
        if (
          existing.requestHash !== source.requestHash ||
          existing.reexportOfId !== source.id
        ) {
          await logRedispatchAudit(resolved, options.auditContext, {
            action: 'integration_hr_employee_master_export_redispatch_conflict',
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
          throw idempotencyConflict();
        }
        if (existing.status === IntegrationRunStatus.running) {
          throw dispatchInProgress(existing.id);
        }
        await logRedispatchAudit(resolved, options.auditContext, {
          action: 'integration_hr_employee_master_export_redispatch_replayed',
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
      };

      const existing = await client.hrEmployeeMasterExportLog.findUnique({
        where: { idempotencyKey },
      });
      if (existing) return respondWithExisting(existing);

      let created: Awaited<
        ReturnType<typeof client.hrEmployeeMasterExportLog.create>
      >;
      try {
        created = await client.hrEmployeeMasterExportLog.create({
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
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const concurrent = await client.hrEmployeeMasterExportLog.findUnique({
            where: { idempotencyKey },
          });
          if (concurrent) return respondWithExisting(concurrent);
        }
        throw error;
      }
      await logRedispatchAudit(resolved, options.auditContext, {
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
    case 'hr_attendance_export': {
      const source = await client.hrAttendanceExportLog.findUnique({
        where: { id: options.id },
      });
      if (!source) throw redispatchSourceNotFound();
      if (source.status === IntegrationRunStatus.running) {
        throw dispatchInProgress(source.id);
      }
      if (!source.payload || source.status !== IntegrationRunStatus.success) {
        throw redispatchSourceNotExported(source.id);
      }

      const respondWithExisting = async (existing: typeof source) => {
        if (
          existing.requestHash !== source.requestHash ||
          existing.reexportOfId !== source.id
        ) {
          await logRedispatchAudit(resolved, options.auditContext, {
            action: 'integration_hr_attendance_export_redispatch_conflict',
            targetTable: 'HrAttendanceExportLog',
            targetId: existing.id,
            metadata: {
              sourceLogId: source.id,
              idempotencyKey,
              requestHash: source.requestHash,
              existingRequestHash: existing.requestHash,
              existingReexportOfId: existing.reexportOfId,
            } as Prisma.InputJsonValue,
          });
          throw idempotencyConflict();
        }
        if (existing.status === IntegrationRunStatus.running) {
          throw dispatchInProgress(existing.id);
        }
        await logRedispatchAudit(resolved, options.auditContext, {
          action: 'integration_hr_attendance_export_redispatch_replayed',
          targetTable: 'HrAttendanceExportLog',
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
          log: buildHrAttendanceExportLogResponse(existing),
        };
      };

      const existing = await client.hrAttendanceExportLog.findUnique({
        where: { idempotencyKey },
      });
      if (existing) return respondWithExisting(existing);

      let created: Awaited<
        ReturnType<typeof client.hrAttendanceExportLog.create>
      >;
      try {
        created = await client.hrAttendanceExportLog.create({
          data: {
            idempotencyKey,
            requestHash: source.requestHash,
            reexportOfId: source.id,
            periodKey: source.periodKey,
            closingPeriodId: source.closingPeriodId,
            closingVersion: source.closingVersion,
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
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const concurrent = await client.hrAttendanceExportLog.findUnique({
            where: { idempotencyKey },
          });
          if (concurrent) return respondWithExisting(concurrent);
        }
        throw error;
      }
      await logRedispatchAudit(resolved, options.auditContext, {
        action: 'integration_hr_attendance_export_redispatched',
        targetTable: 'HrAttendanceExportLog',
        targetId: created.id,
        metadata: {
          sourceLogId: source.id,
          idempotencyKey,
          periodKey: created.periodKey,
          closingPeriodId: created.closingPeriodId,
          closingVersion: created.closingVersion,
          exportedCount: created.exportedCount,
        } as Prisma.InputJsonValue,
      });
      return {
        replayed: false,
        payload: created.payload,
        log: buildHrAttendanceExportLogResponse(created),
      };
    }
    case 'accounting_ics_export': {
      const source = await client.accountingIcsExportLog.findUnique({
        where: { id: options.id },
      });
      if (!source) throw redispatchSourceNotFound();
      if (source.status === IntegrationRunStatus.running) {
        throw dispatchInProgress(source.id);
      }
      if (!source.payload || source.status !== IntegrationRunStatus.success) {
        throw redispatchSourceNotExported(source.id);
      }

      const respondWithExisting = async (existing: typeof source) => {
        if (
          existing.requestHash !== source.requestHash ||
          existing.reexportOfId !== source.id
        ) {
          await logRedispatchAudit(resolved, options.auditContext, {
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
          throw idempotencyConflict();
        }
        if (existing.status === IntegrationRunStatus.running) {
          throw dispatchInProgress(existing.id);
        }
        await logRedispatchAudit(resolved, options.auditContext, {
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
      };

      const existing = await client.accountingIcsExportLog.findUnique({
        where: { idempotencyKey },
      });
      if (existing) return respondWithExisting(existing);

      let created: Awaited<
        ReturnType<typeof client.accountingIcsExportLog.create>
      >;
      try {
        created = await client.accountingIcsExportLog.create({
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
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const concurrent = await client.accountingIcsExportLog.findUnique({
            where: { idempotencyKey },
          });
          if (concurrent) return respondWithExisting(concurrent);
        }
        throw error;
      }
      await logRedispatchAudit(resolved, options.auditContext, {
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
  }
}
