import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';

export async function registerAlertRoutes(app: FastifyInstance) {
  app.get('/alerts', async (req) => {
    const { projectId, status } = req.query as {
      projectId?: string;
      status?: string;
    };
    const alerts = await prisma.alert.findMany({
      where: {
        ...(projectId ? { targetRef: projectId } : {}),
        ...(status ? { status } : {}),
      } as any,
      orderBy: { triggeredAt: 'desc' },
      take: 50,
    });
    return { items: alerts };
  });
}
