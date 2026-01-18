import { FastifyInstance } from 'fastify';
import { dailyReportSchema } from './validators.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { parseDateParam } from '../utils/date.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';

export async function registerDailyReportRoutes(app: FastifyInstance) {
  app.post(
    '/daily-reports',
    {
      schema: dailyReportSchema,
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
      const reportDate = parseDateParam(body.reportDate);
      if (!reportDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid reportDate' },
        });
      }
      const actorId = req.user?.userId ?? null;
      const report = await prisma.dailyReport.upsert({
        where: { userId_reportDate: { userId: body.userId, reportDate } },
        create: {
          userId: body.userId,
          reportDate,
          content: body.content,
          linkedProjectIds:
            body.linkedProjectIds?.length > 0
              ? body.linkedProjectIds
              : undefined,
          status: body.status ?? undefined,
          createdBy: actorId,
          updatedBy: actorId,
        },
        update: {
          content: body.content,
          linkedProjectIds:
            body.linkedProjectIds?.length > 0
              ? body.linkedProjectIds
              : undefined,
          status: body.status ?? undefined,
          updatedBy: actorId,
        },
      });

      await logAudit({
        action: 'daily_report_upserted',
        targetTable: 'daily_reports',
        targetId: report.id,
        metadata: { reportDate: reportDate.toISOString().slice(0, 10) },
        ...auditContextFromRequest(req),
      });
      return report;
    },
  );

  app.get(
    '/daily-reports',
    { preHandler: requireRole(['admin', 'mgmt', 'user']) },
    async (req, reply) => {
      const { userId } = req.query as { userId?: string };
      const roles = req.user?.roles || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      const currentUserId = req.user?.userId;
      const where: { userId?: string } = {};
      if (!isPrivileged) {
        if (!currentUserId) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        where.userId = currentUserId;
      } else if (userId) {
        where.userId = userId;
      }
      const reports = await prisma.dailyReport.findMany({
        where,
        orderBy: { reportDate: 'desc' },
        take: 50,
      });
      return { items: reports };
    },
  );
}
