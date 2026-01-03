import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import {
  reportSubscriptionPatchSchema,
  reportSubscriptionRunSchema,
  reportSubscriptionSchema,
} from './validators.js';

const allowedRoles = ['admin', 'mgmt'];

type ReportSubscriptionBody = {
  name?: string;
  reportKey: string;
  format?: string;
  schedule?: string;
  params?: unknown;
  recipients?: Record<string, unknown>;
  channels?: string[];
  isEnabled?: boolean;
};

type RunBody = {
  dryRun?: boolean;
};

type Recipients = {
  emails?: string[];
  roles?: string[];
  users?: string[];
};

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function normalizeRecipients(value: unknown): Recipients {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  return {
    emails: normalizeStringArray(raw.emails),
    roles: normalizeStringArray(raw.roles),
    users: normalizeStringArray(raw.users),
  };
}

function normalizeChannels(value: unknown) {
  const channels = normalizeStringArray(value);
  return channels.length ? channels : ['dashboard'];
}

function resolveTarget(channel: string, recipients: Recipients) {
  if (channel === 'email') {
    return recipients.emails?.join(',') || '-';
  }
  if (channel === 'dashboard') {
    const users = recipients.users?.join(',');
    if (users) return users;
    const roles = recipients.roles?.join(',');
    return roles || '-';
  }
  return '-';
}

async function runSubscriptionStub(
  subscription: {
    id: string;
    reportKey: string;
    format: string;
    params: unknown;
    recipients: unknown;
    channels: unknown;
  },
  actorId: string | undefined,
  dryRun: boolean,
) {
  const recipients = normalizeRecipients(subscription.recipients);
  const channels = normalizeChannels(subscription.channels);
  const payload = {
    reportKey: subscription.reportKey,
    format: subscription.format,
    params: subscription.params,
    generatedAt: new Date().toISOString(),
  };
  if (dryRun) {
    return {
      payload,
      channels,
      recipients,
      deliveries: [],
    };
  }
  const deliveries = channels.map((channel) => ({
    subscriptionId: subscription.id,
    channel,
    status: 'stubbed',
    target: resolveTarget(channel, recipients),
    payload,
    sentAt: new Date(),
    createdBy: actorId,
  }));
  if (deliveries.length) {
    await prisma.reportDelivery.createMany({ data: deliveries });
  }
  await prisma.reportSubscription.update({
    where: { id: subscription.id },
    data: {
      lastRunAt: new Date(),
      lastRunStatus: 'success',
      updatedBy: actorId,
    },
  });
  return {
    payload,
    channels,
    recipients,
    deliveries,
  };
}

export async function registerReportSubscriptionRoutes(app: FastifyInstance) {
  app.get(
    '/report-subscriptions',
    { preHandler: requireRole(allowedRoles) },
    async () => {
      const items = await prisma.reportSubscription.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return { items };
    },
  );

  app.get(
    '/report-deliveries',
    { preHandler: requireRole(allowedRoles) },
    async (req) => {
      const { subscriptionId } = req.query as { subscriptionId?: string };
      const items = await prisma.reportDelivery.findMany({
        where: subscriptionId ? { subscriptionId } : undefined,
        orderBy: { sentAt: 'desc' },
        take: 200,
      });
      return { items };
    },
  );

  app.post(
    '/report-subscriptions',
    {
      preHandler: requireRole(allowedRoles),
      schema: reportSubscriptionSchema,
    },
    async (req) => {
      const body = req.body as ReportSubscriptionBody;
      const actorId = req.user?.userId;
      const created = await prisma.reportSubscription.create({
        data: {
          name: body.name?.trim() || undefined,
          reportKey: body.reportKey,
          format: body.format || 'csv',
          schedule: body.schedule?.trim() || undefined,
          params: body.params ?? undefined,
          recipients: body.recipients ?? undefined,
          channels: body.channels ?? ['dashboard'],
          isEnabled: body.isEnabled ?? true,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      return created;
    },
  );

  app.patch(
    '/report-subscriptions/:id',
    {
      preHandler: requireRole(allowedRoles),
      schema: reportSubscriptionPatchSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as ReportSubscriptionBody;
      const existing = await prisma.reportSubscription.findUnique({
        where: { id },
      });
      if (!existing) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const actorId = req.user?.userId;
      const updated = await prisma.reportSubscription.update({
        where: { id },
        data: {
          name: body.name?.trim() || undefined,
          reportKey: body.reportKey ?? existing.reportKey,
          format: body.format ?? existing.format,
          schedule: body.schedule?.trim() || undefined,
          params: body.params ?? existing.params,
          recipients: body.recipients ?? existing.recipients,
          channels: body.channels ?? existing.channels,
          isEnabled: body.isEnabled ?? existing.isEnabled,
          updatedBy: actorId,
        },
      });
      return updated;
    },
  );

  app.post(
    '/report-subscriptions/:id/run',
    {
      preHandler: requireRole(allowedRoles),
      schema: reportSubscriptionRunSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as RunBody;
      const subscription = await prisma.reportSubscription.findUnique({
        where: { id },
      });
      if (!subscription) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const result = await runSubscriptionStub(
        subscription,
        req.user?.userId,
        Boolean(body.dryRun),
      );
      return result;
    },
  );

  app.post(
    '/jobs/report-subscriptions/run',
    { preHandler: requireRole(allowedRoles) },
    async (req) => {
      const { dryRun } = (req.body || {}) as RunBody;
      const items = await prisma.reportSubscription.findMany({
        where: { isEnabled: true },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      const results = [];
      for (const item of items) {
        const result = await runSubscriptionStub(
          item,
          req.user?.userId,
          Boolean(dryRun),
        );
        results.push({
          id: item.id,
          reportKey: item.reportKey,
          deliveries: result.deliveries.length,
        });
      }
      return { ok: true, count: results.length, items: results };
    },
  );
}
