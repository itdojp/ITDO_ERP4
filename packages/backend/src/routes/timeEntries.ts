import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { timeEntrySchema } from './validators.js';
import { TimeStatusValue } from '../types.js';
import { requireRole } from '../services/rbac.js';

const prisma = new PrismaClient();

export async function registerTimeEntryRoutes(app: FastifyInstance) {
  app.post('/time-entries', { schema: timeEntrySchema, preHandler: requireRole(['admin', 'mgmt', 'user']) }, async (req) => {
    const body = req.body as any;
    const entry = await prisma.timeEntry.create({ data: body });
    return entry;
  });

  app.patch('/time-entries/:id', { schema: timeEntrySchema, preHandler: requireRole(['admin', 'mgmt', 'user']) }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const entry = await prisma.timeEntry.update({ where: { id }, data: body });
    return entry;
  });

  app.get('/time-entries', { preHandler: requireRole(['admin', 'mgmt', 'user']) }, async (req) => {
    const { projectId, userId } = req.query as { projectId?: string; userId?: string };
    const entries = await prisma.timeEntry.findMany({
      where: { projectId, userId },
      orderBy: { workDate: 'desc' },
      take: 200,
    });
    return { items: entries };
  });

  app.post('/time-entries/:id/submit', { preHandler: requireRole(['admin', 'mgmt']) }, async (req) => {
    const { id } = req.params as { id: string };
    const entry = await prisma.timeEntry.update({ where: { id }, data: { status: TimeStatusValue.submitted } });
    return entry;
  });
}
