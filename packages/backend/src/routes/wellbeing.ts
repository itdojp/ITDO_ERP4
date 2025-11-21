import { FastifyInstance } from 'fastify';
import { wellbeingSchema } from './validators.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';

export async function registerWellbeingRoutes(app: FastifyInstance) {
  app.post('/wellbeing-entries', { schema: wellbeingSchema, preHandler: requireRole(['admin', 'mgmt', 'user']) }, async (req) => {
    const body = req.body as any;
    const entry = await prisma.wellbeingEntry.create({ data: body });
    return entry;
  });

  app.get('/wellbeing-entries', { preHandler: requireRole(['hr', 'admin']) }, async () => {
    const items = await prisma.wellbeingEntry.findMany({ orderBy: { entryDate: 'desc' }, take: 50 });
    return { items };
  });
}
