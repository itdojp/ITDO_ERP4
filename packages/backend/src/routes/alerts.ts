import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';

export async function registerAlertRoutes(app: FastifyInstance) {
  app.get('/alerts', async () => {
    const alerts = await prisma.alert.findMany({
      orderBy: { triggeredAt: 'desc' },
      take: 50,
    });
    return { items: alerts };
  });
}
