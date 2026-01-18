import { FastifyInstance } from 'fastify';
import { wellbeingSchema } from './validators.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { endOfDay, parseDateParam } from '../utils/date.js';

function formatMonthKey(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export async function registerWellbeingRoutes(app: FastifyInstance) {
  app.post(
    '/wellbeing-entries',
    {
      schema: wellbeingSchema,
      preHandler: requireRole(['admin', 'mgmt', 'user']),
    },
    async (req, reply) => {
      const body = req.body as any;
      const roles = req.user?.roles || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      const currentUserId = req.user?.userId;
      if (!isPrivileged) {
        if (!currentUserId) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        body.userId = currentUserId;
      }
      const entryDate = parseDateParam(body.entryDate);
      if (!entryDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid entryDate' },
        });
      }
      const actorId = req.user?.userId ?? null;
      const entry = await prisma.wellbeingEntry.upsert({
        where: { userId_entryDate: { userId: body.userId, entryDate } },
        create: {
          ...body,
          entryDate,
          createdBy: actorId,
          updatedBy: actorId,
        },
        update: {
          status: body.status,
          helpRequested: body.helpRequested,
          notes: body.notes ?? undefined,
          visibilityGroupId: body.visibilityGroupId,
          updatedBy: actorId,
        },
      });

      await logAudit({
        action: 'wellbeing_entry_upserted',
        targetTable: 'wellbeing_entries',
        targetId: entry.id,
        metadata: { entryDate: entryDate.toISOString().slice(0, 10) },
        ...auditContextFromRequest(req),
      });
      return entry;
    },
  );

  app.get(
    '/wellbeing-entries',
    { preHandler: requireRole(['hr', 'admin']) },
    async (req) => {
      const items = await prisma.wellbeingEntry.findMany({
        orderBy: { entryDate: 'desc' },
        take: 50,
      });
      await logAudit({
        action: 'wellbeing_view',
        targetTable: 'wellbeing_entries',
        ...auditContextFromRequest(req),
      });
      return { items };
    },
  );

  app.get(
    '/wellbeing-analytics',
    { preHandler: requireRole(['hr', 'admin']) },
    async (req, reply) => {
      const { from, to, minUsers, groupBy, visibilityGroupId } = req.query as {
        from?: string;
        to?: string;
        minUsers?: string;
        groupBy?: string;
        visibilityGroupId?: string;
      };
      const fromDate = parseDateParam(from);
      const toDate = parseDateParam(to);
      if (from && !fromDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid from date' },
        });
      }
      if (to && !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid to date' },
        });
      }
      if (fromDate && toDate && fromDate > toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_RANGE', message: 'from must be before to' },
        });
      }
      const minUsersValue = minUsers ? Number(minUsers) : 5;
      if (!Number.isInteger(minUsersValue) || minUsersValue <= 0) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_MIN_USERS',
            message: 'minUsers must be a positive integer',
          },
        });
      }
      const groupByValue =
        !groupBy || groupBy === 'group'
          ? 'group'
          : groupBy === 'month'
            ? 'month'
            : null;
      if (!groupByValue) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_GROUP_BY',
            message: 'groupBy must be group or month',
          },
        });
      }
      const where: {
        entryDate?: { gte?: Date; lte?: Date };
        visibilityGroupId?: string;
      } = {};
      if (fromDate || toDate) {
        where.entryDate = {};
        if (fromDate) where.entryDate.gte = fromDate;
        if (toDate) where.entryDate.lte = endOfDay(toDate);
      }
      if (visibilityGroupId) {
        where.visibilityGroupId = visibilityGroupId;
      }
      const entries = await prisma.wellbeingEntry.findMany({
        where,
        select: {
          userId: true,
          entryDate: true,
          status: true,
          helpRequested: true,
          visibilityGroupId: true,
        },
      });
      const buckets = new Map<
        string,
        {
          users: Set<string>;
          entries: number;
          notGoodCount: number;
          helpRequestedCount: number;
        }
      >();
      for (const entry of entries) {
        const bucketKey =
          groupByValue === 'month'
            ? formatMonthKey(entry.entryDate)
            : entry.visibilityGroupId;
        if (!bucketKey) continue;
        const current = buckets.get(bucketKey) || {
          users: new Set<string>(),
          entries: 0,
          notGoodCount: 0,
          helpRequestedCount: 0,
        };
        current.entries += 1;
        if (entry.status === 'not_good') current.notGoodCount += 1;
        if (entry.helpRequested) current.helpRequestedCount += 1;
        current.users.add(entry.userId);
        buckets.set(bucketKey, current);
      }
      const items = Array.from(buckets.entries())
        .map(([bucket, stats]) => ({
          bucket,
          users: stats.users.size,
          entries: stats.entries,
          notGoodCount: stats.notGoodCount,
          notGoodRate: stats.entries ? stats.notGoodCount / stats.entries : 0,
          helpRequestedCount: stats.helpRequestedCount,
        }))
        .filter((item) => item.users >= minUsersValue)
        .sort((a, b) => a.bucket.localeCompare(b.bucket));

      await logAudit({
        action: 'wellbeing_analytics_view',
        targetTable: 'wellbeing_entries',
        metadata: {
          groupBy: groupByValue,
          minUsers: minUsersValue,
          from: from || null,
          to: to || null,
          visibilityGroupId: visibilityGroupId || null,
        },
        ...auditContextFromRequest(req),
      });

      return {
        items,
        meta: {
          groupBy: groupByValue,
          minUsers: minUsersValue,
          from: from || null,
          to: to || null,
          visibilityGroupId: visibilityGroupId || null,
        },
      };
    },
  );
}
