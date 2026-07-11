import {
  IntegrationRunStatus,
  IntegrationStatus,
  Prisma,
} from '@prisma/client';
import type { AuditContext } from './audit.js';
import { logAudit as defaultLogAudit } from './audit.js';
import { triggerAlert as defaultTriggerAlert } from './alert.js';
import { prisma } from './db.js';

export const DEFAULT_RETRY_MAX = 3;
export const DEFAULT_RETRY_BASE_MINUTES = 60;
export const MAX_RETRY_MAX = 10;
export const MAX_RETRY_BASE_MINUTES = 1440;

const MAX_INTEGRATION_RUN_AUDIT_TEXT_LENGTH = 500;

type IntegrationRunClient = Prisma.TransactionClient | typeof prisma;

type IntegrationRunSetting = {
  id: string;
  type: string;
  status?: string | null;
  schedule?: string | null;
  config: unknown;
};

type ExistingIntegrationRun = {
  id: string;
  retryCount?: number | null;
};

type IntegrationRunResult = {
  id: string;
  status: string;
  retryCount: number | null;
  nextRetryAt: Date | null;
  message: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

type IntegrationRunDependencies = {
  client?: IntegrationRunClient;
  /**
   * Audit persistence is injected separately from the Prisma client because
   * the shared audit service owns metadata normalization and failure handling.
   * Callers that need a custom transaction boundary should inject both.
   */
  logAudit?: typeof defaultLogAudit;
  triggerAlert?: typeof defaultTriggerAlert;
  now?: () => Date;
};

export type IntegrationRunServiceErrorCode = 'not_found' | 'disabled';

export class IntegrationRunServiceError extends Error {
  readonly code: IntegrationRunServiceErrorCode;
  readonly statusCode: number;
  readonly responseBody: Record<string, unknown>;

  constructor(
    code: IntegrationRunServiceErrorCode,
    statusCode: number,
    responseBody: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'IntegrationRunServiceError';
    this.code = code;
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

function resolveIntegrationRunDependencies(
  dependencies: IntegrationRunDependencies,
) {
  return {
    client: dependencies.client ?? prisma,
    logAudit: dependencies.logAudit ?? defaultLogAudit,
    triggerAlert: dependencies.triggerAlert ?? defaultTriggerAlert,
    now: dependencies.now ?? (() => new Date()),
  };
}

function parseLimit(
  raw: string | number | undefined,
  defaultValue: number,
  maxValue: number,
) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.min(maxValue, Math.max(1, Math.floor(raw)));
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.min(maxValue, Math.max(1, Math.floor(parsed)));
    }
  }
  return defaultValue;
}

function parseOffset(raw: string | number | undefined) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return 0;
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

function parseUpdatedSince(raw?: string) {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function truncateForAudit(value: unknown) {
  if (typeof value !== 'string') return value;
  if (value.length <= MAX_INTEGRATION_RUN_AUDIT_TEXT_LENGTH) return value;
  return `${value.slice(0, MAX_INTEGRATION_RUN_AUDIT_TEXT_LENGTH)}...`;
}

export function calculateDurationMetrics(durations: number[]) {
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

export function getRetryPolicy(config: unknown) {
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

export function computeNextRetryAt(
  now: Date,
  retryCount: number,
  retryBaseMinutes: number,
) {
  if (retryCount <= 0) return null;
  const multiplier = Math.pow(2, retryCount - 1);
  return new Date(now.getTime() + retryBaseMinutes * 60 * 1000 * multiplier);
}

async function closeIntegrationFailureAlerts(
  settingId: string,
  dependencies: ReturnType<typeof resolveIntegrationRunDependencies>,
) {
  const settings = await dependencies.client.alertSetting.findMany({
    where: { type: 'integration_failure' },
    select: { id: true },
  });
  if (!settings.length) return;
  const targetRef = `integration:${settingId}`;
  await dependencies.client.alert.updateMany({
    where: {
      status: 'open',
      targetRef,
      settingId: { in: settings.map((s) => s.id) },
    },
    data: { status: 'closed' },
  });
}

async function triggerIntegrationFailureAlerts(
  settingId: string,
  dependencies: ReturnType<typeof resolveIntegrationRunDependencies>,
) {
  const settings = await dependencies.client.alertSetting.findMany({
    where: { type: 'integration_failure', isEnabled: true },
  });
  if (!settings.length) return;
  const targetRef = `integration:${settingId}`;
  for (const setting of settings) {
    await dependencies.triggerAlert(
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

export async function executeIntegration(
  setting: {
    id: string;
    type: string;
    config: unknown;
  },
  dependencies: IntegrationRunDependencies = {},
) {
  const { client } = resolveIntegrationRunDependencies(dependencies);
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
      client.customer.count({ where }),
      client.vendor.count({ where }),
      client.contact.count({ where }),
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
      client.userAccount.count({ where }),
      client.wellbeingEntry.count({ where }),
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

export async function runIntegrationSetting(
  setting: IntegrationRunSetting,
  options: {
    actorUserId?: string | null;
    existingRun?: ExistingIntegrationRun;
  } = {},
  dependencies: IntegrationRunDependencies = {},
) {
  const resolved = resolveIntegrationRunDependencies(dependencies);
  const { client, now } = resolved;
  const startedAt = now();
  const run = options.existingRun
    ? await client.integrationRun.update({
        where: { id: options.existingRun.id },
        data: {
          status: IntegrationRunStatus.running,
          startedAt,
          finishedAt: null,
          message: null,
          metrics: Prisma.DbNull,
          nextRetryAt: null,
        },
      })
    : await client.integrationRun.create({
        data: {
          settingId: setting.id,
          status: IntegrationRunStatus.running,
          startedAt,
          createdBy: options.actorUserId ?? null,
        },
      });
  try {
    const result = await executeIntegration(setting, dependencies);
    const finishedAt = now();
    const updated = await client.integrationRun.update({
      where: { id: run.id },
      data: {
        status: IntegrationRunStatus.success,
        finishedAt,
        message: result.message,
        metrics: result.metrics as Prisma.InputJsonValue,
        nextRetryAt: null,
      },
    });
    await client.integrationSetting.update({
      where: { id: setting.id },
      data: {
        lastRunAt: finishedAt,
        lastRunStatus: IntegrationRunStatus.success,
        updatedBy: options.actorUserId ?? null,
      },
    });
    await closeIntegrationFailureAlerts(setting.id, resolved);
    return updated as IntegrationRunResult;
  } catch (err) {
    const finishedAt = now();
    const { retryMax, retryBaseMinutes } = getRetryPolicy(setting.config);
    const currentRetry = options.existingRun?.retryCount ?? run.retryCount ?? 0;
    const retryCount = currentRetry + 1;
    const shouldRetry = retryCount <= retryMax;
    const nextRetryAt = shouldRetry
      ? computeNextRetryAt(finishedAt, retryCount, retryBaseMinutes)
      : null;
    const message = err instanceof Error ? err.message : String(err);
    const updated = await client.integrationRun.update({
      where: { id: run.id },
      data: {
        status: IntegrationRunStatus.failed,
        finishedAt,
        message,
        retryCount,
        nextRetryAt,
      },
    });
    await client.integrationSetting.update({
      where: { id: setting.id },
      data: {
        lastRunAt: finishedAt,
        lastRunStatus: IntegrationRunStatus.failed,
        updatedBy: options.actorUserId ?? null,
      },
    });
    await triggerIntegrationFailureAlerts(setting.id, resolved);
    return updated as IntegrationRunResult;
  }
}

export function buildIntegrationRunAuditMetadata(input: {
  trigger: 'manual' | 'retry' | 'scheduled';
  settingId: string;
  settingType: string;
  run: IntegrationRunResult;
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

export async function executeManualIntegrationRun(
  options: {
    settingId: string;
    actorUserId?: string | null;
    auditContext?: AuditContext;
  },
  dependencies: IntegrationRunDependencies = {},
) {
  const resolved = resolveIntegrationRunDependencies(dependencies);
  const setting = await resolved.client.integrationSetting.findUnique({
    where: { id: options.settingId },
  });
  if (!setting) {
    throw new IntegrationRunServiceError('not_found', 404, {
      error: 'not_found',
    });
  }
  if (setting.status === IntegrationStatus.disabled) {
    throw new IntegrationRunServiceError('disabled', 409, {
      error: 'disabled',
    });
  }
  const run = await runIntegrationSetting(
    setting,
    { actorUserId: options.actorUserId ?? null },
    dependencies,
  );
  await resolved.logAudit({
    ...(options.auditContext ?? {}),
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
}

export async function listIntegrationRuns(
  options: {
    query?: {
      settingId?: string;
      limit?: string | number;
      offset?: string | number;
    };
  },
  dependencies: IntegrationRunDependencies = {},
) {
  const { client } = resolveIntegrationRunDependencies(dependencies);
  const query = options.query ?? {};
  const take = parseLimit(query.limit, 200, 1000);
  const skip = parseOffset(query.offset);
  const items = await client.integrationRun.findMany({
    where: query.settingId ? { settingId: query.settingId } : undefined,
    orderBy: { startedAt: 'desc' },
    take,
    skip,
  });
  return { items, limit: take, offset: skip };
}

export function buildIntegrationRunMetricsResponse(input: {
  runs: Array<{
    status: IntegrationRunStatus | string;
    startedAt: Date | null;
    finishedAt: Date | null;
    nextRetryAt: Date | null;
    message: string | null;
    setting?: { id: string; type: string; name: string | null } | null;
  }>;
  from: Date;
  to: Date;
  days: number;
  limit: number;
}) {
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

  for (const run of input.runs) {
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

  const totalRuns = input.runs.length;
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
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      days: input.days,
      limit: input.limit,
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
}

export async function getIntegrationRunMetrics(
  options: {
    query?: {
      settingId?: string;
      days?: number | string;
      limit?: number | string;
    };
  },
  dependencies: IntegrationRunDependencies = {},
) {
  const { client, now: nowFactory } =
    resolveIntegrationRunDependencies(dependencies);
  const query = options.query ?? {};
  const days = parseBoundedInteger(query.days, 14, 90);
  const limit = parseBoundedInteger(query.limit, 2000, 5000);
  const now = nowFactory();
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const where = {
    startedAt: { gte: from, lte: now },
    ...(query.settingId ? { settingId: query.settingId } : {}),
  };
  const runs = await client.integrationRun.findMany({
    where,
    include: {
      setting: {
        select: { id: true, type: true, name: true },
      },
    },
    orderBy: { startedAt: 'desc' },
    take: limit,
  });
  return buildIntegrationRunMetricsResponse({
    runs,
    from,
    to: now,
    days,
    limit,
  });
}

export async function runDueIntegrationJobs(
  options: {
    actorUserId?: string | null;
    auditContext?: AuditContext;
  },
  dependencies: IntegrationRunDependencies = {},
) {
  const resolved = resolveIntegrationRunDependencies(dependencies);
  const { client, logAudit, now: nowFactory } = resolved;
  const auditTasks: Array<Promise<unknown>> = [];
  const now = nowFactory();
  const retryRuns = await client.integrationRun.findMany({
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
    const updated = await runIntegrationSetting(
      run.setting,
      {
        actorUserId: options.actorUserId ?? null,
        existingRun: {
          id: run.id,
          retryCount: run.retryCount,
        },
      },
      dependencies,
    );
    retryResults.push({ id: updated.id, status: updated.status });
    auditTasks.push(
      logAudit({
        ...(options.auditContext ?? {}),
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

  const scheduledSettings = await client.integrationSetting.findMany({
    where: { status: IntegrationStatus.active, schedule: { not: null } },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  const scheduledResults = [];
  for (const setting of scheduledSettings) {
    if (!setting.schedule || setting.schedule.trim().length === 0) {
      continue;
    }
    const run = await runIntegrationSetting(
      setting,
      { actorUserId: options.actorUserId ?? null },
      dependencies,
    );
    scheduledResults.push({ id: run.id, status: run.status });
    auditTasks.push(
      logAudit({
        ...(options.auditContext ?? {}),
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
      ...(options.auditContext ?? {}),
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
}
