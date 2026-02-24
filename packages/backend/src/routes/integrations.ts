import { FastifyInstance } from 'fastify';
import {
  IntegrationRunStatus,
  IntegrationStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { triggerAlert } from '../services/alert.js';
import {
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

function getRetryPolicy(config: unknown) {
  const record =
    config && typeof config === 'object'
      ? (config as Record<string, unknown>)
      : {};
  const retryMaxRaw = record.retryMax;
  const retryBaseRaw = record.retryBaseMinutes;
  const retryMax =
    typeof retryMaxRaw === 'number' && Number.isFinite(retryMaxRaw)
      ? Math.max(0, Math.floor(retryMaxRaw))
      : DEFAULT_RETRY_MAX;
  const retryBaseMinutes =
    typeof retryBaseRaw === 'number' && Number.isFinite(retryBaseRaw)
      ? Math.max(1, Math.floor(retryBaseRaw))
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
    async (req) => {
      const body = req.body as IntegrationSettingBody;
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
      }
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
        where: since ? { updatedAt: { gt: since } } : undefined,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      });
      return { items, limit: take, offset: skip };
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
}
