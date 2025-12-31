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
    async () => {
      const reports = await prisma.dailyReport.findMany({
        orderBy: { reportDate: 'desc' },
        take: 50,
      });
      return { items: reports };
    },
  );
}
