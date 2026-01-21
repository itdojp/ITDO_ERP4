import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { isWebPushEnabled, sendWebPush } from '../services/webPush.js';
import {
  pushSubscriptionDisableSchema,
  pushSubscriptionSchema,
  pushTestSchema,
} from './validators.js';

const allowedRoles = ['admin', 'mgmt', 'exec', 'user', 'hr'];
const DEFAULT_PUSH_ICON = '/icon.svg';

type PushSubscriptionBody = {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
  topics?: string[];
};

type PushTestBody = {
  userId?: string;
  title?: string;
  body?: string;
  url?: string;
};

function resolveExpirationTime(value?: number | null) {
  if (typeof value !== 'number') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

function normalizeTopics(raw?: string[]) {
  if (!raw) return undefined;
  const topics = raw.map((item) => String(item).trim()).filter(Boolean);
  return topics.length ? topics : Prisma.DbNull;
}

function parseLimit(raw: string | undefined, maxValue: number) {
  if (!raw) return maxValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return maxValue;
  return Math.min(parsed, maxValue);
}

function redactEndpoint(raw: string): string {
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}/...`;
  } catch {
    return '<invalid-endpoint>';
  }
}

export async function registerPushRoutes(app: FastifyInstance) {
  app.get(
    '/push-subscriptions',
    { preHandler: requireRole(allowedRoles) },
    async (req, reply) => {
      const roles = req.user?.roles || [];
      const userId = req.user?.userId;
      if (!userId) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      const query = (req.query || {}) as {
        cursor?: string;
        limit?: string;
        userId?: string;
      };
      const take = parseLimit(query.limit, 200);
      const where = isPrivileged
        ? query.userId
          ? { userId: query.userId }
          : undefined
        : { userId };
      const findArgs: {
        where?: { userId?: string };
        orderBy: { updatedAt: 'desc' };
        take: number;
        skip?: number;
        cursor?: { id: string };
      } = {
        where,
        orderBy: { updatedAt: 'desc' },
        take: take + 1,
      };
      if (query.cursor) {
        findArgs.cursor = { id: query.cursor };
        findArgs.skip = 1;
      }
      const items = await prisma.pushSubscription.findMany(findArgs);
      let nextCursor: string | null = null;
      if (items.length > take) {
        const nextItem = items.pop();
        nextCursor = nextItem?.id ?? null;
      }
      return { items, nextCursor };
    },
  );

  app.post(
    '/push-subscriptions',
    { preHandler: requireRole(allowedRoles), schema: pushSubscriptionSchema },
    async (req, reply) => {
      const body = req.body as PushSubscriptionBody;
      const userId = req.user?.userId;
      if (!userId) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const expirationTime = resolveExpirationTime(body.expirationTime);
      const topics = normalizeTopics(body.topics);
      const now = new Date();
      const saved = await prisma.pushSubscription.upsert({
        where: { endpoint: body.endpoint },
        create: {
          userId,
          endpoint: body.endpoint,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          expirationTime,
          userAgent: body.userAgent,
          topics,
          consentAt: now,
          isActive: true,
          lastSeenAt: now,
          createdBy: userId,
          updatedBy: userId,
        },
        update: {
          userId,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          expirationTime,
          userAgent: body.userAgent,
          topics,
          consentAt: now,
          isActive: true,
          lastSeenAt: now,
          updatedBy: userId,
        },
      });
      return saved;
    },
  );

  app.post(
    '/push-subscriptions/unsubscribe',
    {
      preHandler: requireRole(allowedRoles),
      schema: pushSubscriptionDisableSchema,
    },
    async (req, reply) => {
      const body = req.body as { endpoint: string };
      const current = await prisma.pushSubscription.findUnique({
        where: { endpoint: body.endpoint },
      });
      if (!current) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const roles = req.user?.roles || [];
      const userId = req.user?.userId;
      if (!userId) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      if (!isPrivileged && current.userId !== userId) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const updated = await prisma.pushSubscription.update({
        where: { endpoint: body.endpoint },
        data: { isActive: false, lastSeenAt: new Date(), updatedBy: userId },
      });
      return updated;
    },
  );

  app.post(
    '/push-notifications/test',
    { preHandler: requireRole(allowedRoles), schema: pushTestSchema },
    async (req, reply) => {
      const body = req.body as PushTestBody;
      const roles = req.user?.roles || [];
      const requester = req.user?.userId;
      if (!requester) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      const targetUserId = body.userId || requester;
      if (!isPrivileged && targetUserId !== requester) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const subscriptions = await prisma.pushSubscription.findMany({
        where: { userId: targetUserId, isActive: true },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      });
      const payload = {
        title: body.title || 'ERP4',
        body: body.body || 'テスト通知',
        url: body.url || '/',
      };
      const webPushEnabled = isWebPushEnabled();
      if (!webPushEnabled) {
        return {
          stub: true,
          payload,
          count: subscriptions.length,
          targets: subscriptions.map((sub) => ({
            id: sub.id,
            endpoint: redactEndpoint(sub.endpoint),
            userId: sub.userId,
          })),
        };
      }
      const sendResult = await sendWebPush(
        subscriptions.map((sub) => ({
          id: sub.id,
          endpoint: sub.endpoint,
          p256dh: sub.p256dh,
          auth: sub.auth,
        })),
        { ...payload, icon: DEFAULT_PUSH_ICON },
      );
      const disabledIds = sendResult.results
        .filter((result) => result.shouldDisable)
        .map((result) => result.subscriptionId);
      if (disabledIds.length) {
        await prisma.pushSubscription.updateMany({
          where: { id: { in: disabledIds } },
          data: {
            isActive: false,
            lastSeenAt: new Date(),
            updatedBy: requester,
          },
        });
      }
      const delivered = sendResult.results.filter(
        (result) => result.status === 'success',
      ).length;
      const failed = sendResult.results.length - delivered;
      await logAudit({
        ...auditContextFromRequest(req),
        action: 'push_notification_test',
        targetTable: 'UserAccount',
        targetId: targetUserId,
        metadata: {
          delivered,
          failed,
          subscriptionCount: subscriptions.length,
          disabledCount: disabledIds.length,
        } as Prisma.InputJsonValue,
      });
      return {
        stub: false,
        payload,
        count: subscriptions.length,
        delivered,
        failed,
        disabled: disabledIds.length,
        results: sendResult.results,
      };
    },
  );
}
