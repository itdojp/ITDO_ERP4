import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import {
  pushSubscriptionDisableSchema,
  pushSubscriptionSchema,
  pushTestSchema,
} from './validators.js';

const allowedRoles = ['admin', 'mgmt', 'exec', 'user', 'hr'];

type PushSubscriptionBody = {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
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

export async function registerPushRoutes(app: FastifyInstance) {
  app.get(
    '/push-subscriptions',
    { preHandler: requireRole(allowedRoles) },
    async (req) => {
      const roles = req.user?.roles || [];
      const userId = req.user?.userId || 'demo-user';
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      const items = await prisma.pushSubscription.findMany({
        where: isPrivileged ? undefined : { userId },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      });
      return { items };
    },
  );

  app.post(
    '/push-subscriptions',
    { preHandler: requireRole(allowedRoles), schema: pushSubscriptionSchema },
    async (req) => {
      const body = req.body as PushSubscriptionBody;
      const userId = req.user?.userId || 'demo-user';
      const expirationTime = resolveExpirationTime(body.expirationTime);
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
    { preHandler: requireRole(allowedRoles), schema: pushSubscriptionDisableSchema },
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
      const requester = req.user?.userId || 'demo-user';
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
      return {
        payload,
        count: subscriptions.length,
        targets: subscriptions.map((sub) => ({
          id: sub.id,
          endpoint: sub.endpoint,
          userId: sub.userId,
        })),
      };
    },
  );
}
