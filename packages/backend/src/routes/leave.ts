import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function registerLeaveRoutes(app: FastifyInstance) {
  app.post('/leave-requests', async (req) => {
    const body = req.body as any;
    const leave = await prisma.leaveRequest.create({ data: body });
    return leave;
  });

  app.get('/leave-requests', async (req) => {
    const { userId } = req.query as { userId?: string };
    const items = await prisma.leaveRequest.findMany({ where: { userId }, orderBy: { startDate: 'desc' }, take: 100 });
    return { items };
  });
}
