import { FastifyInstance } from 'fastify';
import { dailyReportSchema } from './validators.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { parseDateParam } from '../utils/date.js';

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
      const report = await prisma.dailyReport.create({
        data: { ...body, reportDate },
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
