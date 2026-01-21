import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { requireUserContext } from '../services/authContext.js';

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
      const { userId } = requireUserContext(req);
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
      const { userId } = requireUserContext(req);
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
      const { userId } = requireUserContext(req);
      const current = await prisma.appNotification.findUnique({
        where: { id },
        select: { id: true, userId: true, readAt: true },
      });
      if (!current) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (current.userId !== userId) {
        return reply.code(403).send({ error: 'forbidden' });
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
}
