import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function registerDailyReportRoutes(app: FastifyInstance) {
  app.post('/daily-reports', async (req) => {
    const body = req.body as any;
    const report = await prisma.dailyReport.create({ data: body });
    return report;
  });

  app.get('/daily-reports', async () => {
    const reports = await prisma.dailyReport.findMany({ orderBy: { reportDate: 'desc' }, take: 50 });
    return { items: reports };
  });
}
