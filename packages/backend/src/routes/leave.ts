import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRoleOrSelf } from '../services/rbac.js';

export async function registerLeaveRoutes(app: FastifyInstance) {
  app.post('/leave-requests', { preHandler: requireRoleOrSelf(['admin', 'mgmt'], (req) => (req.body as any)?.userId) }, async (req) => {
    const body = req.body as any;
    const leave = await prisma.leaveRequest.create({ data: body });
    return leave;
  });

  app.get('/leave-requests', { preHandler: requireRoleOrSelf(['admin', 'mgmt'], (req) => (req.query as any)?.userId) }, async (req) => {
    const { userId } = req.query as { userId?: string };
    const items = await prisma.leaveRequest.findMany({ where: { userId }, orderBy: { startDate: 'desc' }, take: 100 });
    return { items };
  });
}
