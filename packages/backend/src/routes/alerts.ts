import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function registerAlertRoutes(app: FastifyInstance) {
  app.get('/alerts', async () => {
    const alerts = await prisma.alert.findMany({
      orderBy: { triggeredAt: 'desc' },
      take: 50,
    });
    return { items: alerts };
  });
}
