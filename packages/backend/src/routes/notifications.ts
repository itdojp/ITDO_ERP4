import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { parseDateParam } from '../utils/date.js';
import { notificationPreferencePatchSchema } from './validators.js';

function parseLimit(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 200);
}

function parseUnreadFlag(value: unknown) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  return Boolean(value);
}

export async function registerNotificationRoutes(app: FastifyInstance) {
  const allowedRoles = ['admin', 'mgmt', 'exec', 'user', 'hr', 'external_chat'];

  app.get(
    '/notifications/unread-count',
    { preHandler: requireRole(allowedRoles) },
    async (req, reply) => {
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'unauthorized' },
        });
      }
      const unreadCount = await prisma.appNotification.count({
        where: { userId, readAt: null },
      });
      return { unreadCount };
    },
  );

  app.get(
    '/notifications',
    { preHandler: requireRole(allowedRoles) },
    async (req, reply) => {
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'unauthorized' },
        });
      }
      const query = (req.query || {}) as {
        unread?: string;
        limit?: string;
      };
      const unreadOnly = parseUnreadFlag(query.unread);
      const take = parseLimit(query.limit, 50);
      const items = await prisma.appNotification.findMany({
        where: {
          userId,
          ...(unreadOnly ? { readAt: null } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take,
        include: {
          project: {
            select: {
              id: true,
              code: true,
              name: true,
              deletedAt: true,
            },
          },
        },
      });
      return { items };
    },
  );

  app.post(
    '/notifications/:id/read',
    { preHandler: requireRole(allowedRoles) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'unauthorized' },
        });
      }
      const current = await prisma.appNotification.findUnique({
        where: { id },
        select: { id: true, userId: true, readAt: true },
      });
      if (!current) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'not_found' },
        });
      }
      if (current.userId !== userId) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'forbidden' },
        });
      }
      if (current.readAt) {
        return { ok: true, readAt: current.readAt.toISOString() };
      }
      const updated = await prisma.appNotification.update({
        where: { id },
        data: { readAt: new Date(), updatedBy: userId },
        select: { readAt: true },
      });
      return { ok: true, readAt: updated.readAt?.toISOString() ?? null };
    },
  );

  app.get(
    '/notification-preferences',
    { preHandler: requireRole(allowedRoles) },
    async (req, reply) => {
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'unauthorized' },
        });
      }
      const pref = await prisma.userNotificationPreference.findUnique({
        where: { userId },
        select: {
          userId: true,
          emailMode: true,
          emailDigestIntervalMinutes: true,
          muteAllUntil: true,
        },
      });
      if (pref) {
        return {
          ...pref,
          muteAllUntil: pref.muteAllUntil
            ? pref.muteAllUntil.toISOString()
            : null,
        };
      }
      return {
        userId,
        emailMode: 'digest',
        emailDigestIntervalMinutes: 10,
        muteAllUntil: null,
      };
    },
  );

  app.patch(
    '/notification-preferences',
    {
      preHandler: requireRole(allowedRoles),
      schema: notificationPreferencePatchSchema,
    },
    async (req, reply) => {
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'unauthorized' },
        });
      }
      const body = req.body as {
        emailMode?: 'realtime' | 'digest';
        emailDigestIntervalMinutes?: number;
        muteAllUntil?: string | null;
      };

      if (
        body.emailMode === undefined &&
        body.emailDigestIntervalMinutes === undefined &&
        body.muteAllUntil === undefined
      ) {
        const current = await prisma.userNotificationPreference.findUnique({
          where: { userId },
          select: {
            userId: true,
            emailMode: true,
            emailDigestIntervalMinutes: true,
            muteAllUntil: true,
          },
        });
        return current
          ? {
              ...current,
              muteAllUntil: current.muteAllUntil
                ? current.muteAllUntil.toISOString()
                : null,
            }
          : {
              userId,
              emailMode: 'digest',
              emailDigestIntervalMinutes: 10,
              muteAllUntil: null,
            };
      }

      const update: Prisma.UserNotificationPreferenceUpdateInput = {
        updatedBy: userId,
      };
      const create: Prisma.UserNotificationPreferenceCreateInput = {
        userId,
        emailMode: 'digest',
        emailDigestIntervalMinutes: 10,
        createdBy: userId,
        updatedBy: userId,
      };

      if (body.emailMode !== undefined) {
        update.emailMode = body.emailMode;
        create.emailMode = body.emailMode;
      }
      if (body.emailDigestIntervalMinutes !== undefined) {
        update.emailDigestIntervalMinutes = body.emailDigestIntervalMinutes;
        create.emailDigestIntervalMinutes = body.emailDigestIntervalMinutes;
      }
      if (body.muteAllUntil !== undefined) {
        if (body.muteAllUntil === null) {
          update.muteAllUntil = null;
          create.muteAllUntil = null;
        } else {
          const parsed =
            typeof body.muteAllUntil === 'string'
              ? parseDateParam(body.muteAllUntil)
              : null;
          if (!parsed) {
            return reply.status(400).send({
              error: { code: 'INVALID_DATE', message: 'Invalid muteAllUntil' },
            });
          }
          update.muteAllUntil = parsed;
          create.muteAllUntil = parsed;
        }
      }

      const updated = await prisma.userNotificationPreference.upsert({
        where: { userId },
        update,
        create,
        select: {
          userId: true,
          emailMode: true,
          emailDigestIntervalMinutes: true,
          muteAllUntil: true,
        },
      });
      return {
        ...updated,
        muteAllUntil: updated.muteAllUntil
          ? updated.muteAllUntil.toISOString()
          : null,
      };
    },
  );
}
