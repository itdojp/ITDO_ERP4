import { createHash } from 'node:crypto';
import { IntegrationRunStatus, Prisma } from '@prisma/client';
import type { AuditContext } from './audit.js';
import { logAudit as defaultLogAudit } from './audit.js';
import { prisma } from './db.js';
import { resolveLeaveRequestMinutesWithCalendar } from './leaveEntitlements.js';
import { ensureLeaveSetting as defaultEnsureLeaveSetting } from './leaveSettings.js';
import { normalizeLeaveTypeInput } from './leaveTypes.js';
import { resolveUserWorkdayMinutesForDates } from './leaveWorkdayCalendar.js';
import { toDateOnly } from '../utils/date.js';

export type LeaveExportTarget = 'attendance' | 'payroll';

export const DEFAULT_LEAVE_EXPORT_LIMIT = 500;
export const MAX_LEAVE_EXPORT_LIMIT = 2000;
export const DEFAULT_LEAVE_EXPORT_LOG_LIMIT = 100;
export const MAX_LEAVE_EXPORT_LOG_LIMIT = 1000;
export const MAX_LEAVE_EXPORT_OFFSET = 100000;

const MAX_LEAVE_EXPORT_AUDIT_TEXT_LENGTH = 500;
const LEAVE_EXPORT_AUDIT_TEXT_ELLIPSIS = '...';

type IntegrationLeaveExportClient = Prisma.TransactionClient | typeof prisma;

type HrLeaveExportPayloadBuilder = typeof buildHrLeaveExportPayload;

type IntegrationLeaveExportDependencies = {
  client?: IntegrationLeaveExportClient;
  /**
   * Audit persistence is injected separately from the Prisma client because
   * the shared audit service owns metadata normalization and failure handling.
   * Callers that need a custom transaction boundary should inject both.
   */
  logAudit?: typeof defaultLogAudit;
  ensureLeaveSetting?: typeof defaultEnsureLeaveSetting;
  buildPayload?: HrLeaveExportPayloadBuilder;
  now?: () => Date;
};

function resolveIntegrationLeaveExportDependencies(
  dependencies: IntegrationLeaveExportDependencies = {},
) {
  return {
    client: dependencies.client ?? prisma,
    logAudit: dependencies.logAudit ?? defaultLogAudit,
    ensureLeaveSetting:
      dependencies.ensureLeaveSetting ?? defaultEnsureLeaveSetting,
    buildPayload: dependencies.buildPayload ?? buildHrLeaveExportPayload,
    now: dependencies.now ?? (() => new Date()),
  };
}

export class IntegrationLeaveExportServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly responseBody: Record<string, unknown>;

  constructor(
    code: string,
    statusCode: number,
    responseBody: Record<string, unknown> = { error: code },
  ) {
    super(code);
    this.name = 'IntegrationLeaveExportServiceError';
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
  return new IntegrationLeaveExportServiceError(code, statusCode, responseBody);
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function parseUpdatedSince(raw?: string) {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
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

function truncateForLeaveExportAudit(value: unknown) {
  if (typeof value !== 'string') return value;
  if (value.length <= MAX_LEAVE_EXPORT_AUDIT_TEXT_LENGTH) return value;
  return `${value.slice(
    0,
    MAX_LEAVE_EXPORT_AUDIT_TEXT_LENGTH -
      LEAVE_EXPORT_AUDIT_TEXT_ELLIPSIS.length,
  )}${LEAVE_EXPORT_AUDIT_TEXT_ELLIPSIS}`;
}

export function normalizeLeaveExportTarget(value: unknown): LeaveExportTarget {
  return value === 'payroll' ? 'payroll' : 'attendance';
}

export function buildLeaveExportRequestHash(input: {
  target: LeaveExportTarget;
  updatedSince: string | null;
  limit: number;
  offset: number;
}) {
  return createHash('sha256')
    .update(JSON.stringify(input), 'utf8')
    .digest('hex');
}

export type HrLeaveExportQuery = {
  target?: LeaveExportTarget;
  updatedSince?: string;
  limit?: number | string;
  offset?: number | string;
};

export type HrLeaveExportPayload = {
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
  if (leave.startTimeMinutes !== null && leave.endTimeMinutes !== null) {
    return true;
  }
  return leave.minutes !== null || leave.hours !== null;
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
  client: IntegrationLeaveExportClient;
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
      client: options.client,
    });
    const cache = options.cacheByUser.get(userId) ?? new Map<string, number>();
    options.cacheByUser.set(userId, cache);
    for (const [key, row] of resolved.entries()) {
      cache.set(key, row.workMinutes);
    }
  }
}

export function parseHrLeaveExportQuery(query: HrLeaveExportQuery) {
  const target = normalizeLeaveExportTarget(query.target);
  const since = parseUpdatedSince(query.updatedSince);
  if (since === null) {
    return { ok: false as const, code: 'invalid_updatedSince' };
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

export async function buildHrLeaveExportPayload(
  input: {
    target: LeaveExportTarget;
    updatedSince?: Date;
    exportedUntil?: Date;
    limit: number;
    offset: number;
    actorId?: string | null;
  },
  dependencies: Pick<
    IntegrationLeaveExportDependencies,
    'client' | 'ensureLeaveSetting' | 'now'
  > = {},
): Promise<HrLeaveExportPayload> {
  const { client, ensureLeaveSetting, now } =
    resolveIntegrationLeaveExportDependencies(dependencies);
  const leaveSetting = await ensureLeaveSetting({
    actorId: input.actorId ?? null,
    client,
  });
  const exportedUntil = input.exportedUntil ?? now();
  const leaves = await client.leaveRequest.findMany({
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
    ? await client.leaveType.findMany({
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
    client,
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
      client,
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
    exportedAt: now().toISOString(),
    exportedUntil: exportedUntil.toISOString(),
    updatedSince: input.updatedSince?.toISOString() ?? null,
    limit: input.limit,
    offset: input.offset,
    exportedCount: items.length,
    items,
  };
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

export async function dispatchHrLeaveExport(
  input: {
    query: HrLeaveExportQuery;
    idempotencyKey: string;
    actorUserId?: string | null;
    auditContext: AuditContext;
  },
  dependencies: IntegrationLeaveExportDependencies = {},
) {
  const { client, logAudit, ensureLeaveSetting, buildPayload, now } =
    resolveIntegrationLeaveExportDependencies(dependencies);
  const parsed = parseHrLeaveExportQuery(input.query);
  if (!parsed.ok) throw serviceError('invalid_updatedSince', 400);
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) throw serviceError('invalid_idempotencyKey', 400);
  const requestHash = buildLeaveExportRequestHash({
    target: parsed.target,
    updatedSince: parsed.updatedSince?.toISOString() ?? null,
    limit: parsed.limit,
    offset: parsed.offset,
  });
  const existing = await client.leaveIntegrationExportLog.findUnique({
    where: {
      target_idempotencyKey: {
        target: parsed.target,
        idempotencyKey,
      },
    },
  });

  const handleExisting = async (rec: NonNullable<typeof existing>) => {
    if (rec.requestHash !== requestHash) {
      await logAudit({
        ...input.auditContext,
        action: 'integration_hr_leave_export_dispatch_conflict',
        targetTable: 'leave_integration_export_logs',
        targetId: rec.id,
        metadata: {
          target: parsed.target,
          idempotencyKey,
          requestHash,
          existingRequestHash: rec.requestHash,
        } as Prisma.InputJsonValue,
      });
      throw serviceError('idempotency_conflict', 409);
    }
    if (rec.status === IntegrationRunStatus.running) {
      // A duplicate request for the same running export does not mutate state,
      // so it intentionally returns the in-flight log without writing audit.
      throw serviceError('dispatch_in_progress', 409, {
        error: 'dispatch_in_progress',
        logId: rec.id,
      });
    }
    await logAudit({
      ...input.auditContext,
      action: 'integration_hr_leave_export_dispatch_replayed',
      targetTable: 'leave_integration_export_logs',
      targetId: rec.id,
      metadata: {
        target: parsed.target,
        idempotencyKey,
        status: rec.status,
        exportedCount: rec.exportedCount,
      } as Prisma.InputJsonValue,
    });
    return {
      replayed: true,
      payload: rec.payload,
      log: buildLeaveExportLogResponse(rec),
    };
  };

  if (existing) return handleExisting(existing);

  const startedAt = now();
  let log: Awaited<ReturnType<typeof client.leaveIntegrationExportLog.create>>;
  try {
    log = await client.leaveIntegrationExportLog.create({
      data: {
        target: parsed.target,
        idempotencyKey,
        requestHash,
        updatedSince: parsed.updatedSince ?? null,
        exportedUntil: startedAt,
        status: IntegrationRunStatus.running,
        startedAt,
        createdBy: input.actorUserId ?? null,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const concurrent = await client.leaveIntegrationExportLog.findUnique({
        where: {
          target_idempotencyKey: {
            target: parsed.target,
            idempotencyKey,
          },
        },
      });
      if (concurrent) return handleExisting(concurrent);
    }
    throw error;
  }

  try {
    const payload = await buildPayload(
      {
        target: parsed.target,
        updatedSince: parsed.updatedSince,
        exportedUntil: startedAt,
        limit: parsed.limit,
        offset: parsed.offset,
        actorId: input.actorUserId ?? null,
      },
      { client, ensureLeaveSetting, now },
    );
    const finishedAt = now();
    const updated = await client.leaveIntegrationExportLog.update({
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
    const finishedAt = now();
    const message = error instanceof Error ? error.message : String(error);
    const failed = await client.leaveIntegrationExportLog.update({
      where: { id: log.id },
      data: {
        status: IntegrationRunStatus.failed,
        message,
        finishedAt,
      },
    });
    await logAudit({
      ...input.auditContext,
      action: 'integration_hr_leave_export_dispatch_failed',
      targetTable: 'leave_integration_export_logs',
      targetId: failed.id,
      metadata: {
        target: parsed.target,
        idempotencyKey,
        message: truncateForLeaveExportAudit(message),
      } as Prisma.InputJsonValue,
    });
    throw error;
  }
}

export async function listHrLeaveExportLogs(
  query: {
    target?: LeaveExportTarget;
    limit?: number | string;
    offset?: number | string;
    idempotencyKey?: string;
  },
  dependencies: Pick<IntegrationLeaveExportDependencies, 'client'> = {},
) {
  const { client } = resolveIntegrationLeaveExportDependencies(dependencies);
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
    typeof query.idempotencyKey === 'string' ? query.idempotencyKey.trim() : '';
  const target =
    typeof query.target === 'string'
      ? normalizeLeaveExportTarget(query.target)
      : undefined;
  const items = await client.leaveIntegrationExportLog.findMany({
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
}
