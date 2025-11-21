import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function registerWellbeingRoutes(app: FastifyInstance) {
  app.post('/wellbeing-entries', async (req) => {
    const body = req.body as any;
    const entry = await prisma.wellbeingEntry.create({ data: body });
    return entry;
  });

  app.get('/wellbeing-entries', async () => {
    const items = await prisma.wellbeingEntry.findMany({ orderBy: { entryDate: 'desc' }, take: 50 });
    return { items };
  });
}
