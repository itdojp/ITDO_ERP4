import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { createApprovalFor } from '../services/approval.js';
import { FlowTypeValue } from '../types.js';
import { requireRole, requireRoleOrSelf } from '../services/rbac.js';

export async function registerLeaveRoutes(app: FastifyInstance) {
  app.post('/leave-requests', { preHandler: requireRoleOrSelf(['admin', 'mgmt'], (req) => (req.body as any)?.userId) }, async (req) => {
    const body = req.body as any;
    const leave = await prisma.leaveRequest.create({ data: body });
    return leave;
  });

  app.post('/leave-requests/:id/submit', { preHandler: requireRole(['admin', 'mgmt', 'user']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const leave = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const roles = req.user?.roles || [];
    const userId = req.user?.userId;
    if (!roles.includes('admin') && !roles.includes('mgmt') && leave.userId !== userId) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const updated = await prisma.leaveRequest.update({ where: { id }, data: { status: 'pending_manager' } });
    await createApprovalFor(FlowTypeValue.leave, 'leave_requests', id, { hours: leave.hours || 0 });
    return updated;
  });

  app.get('/leave-requests', { preHandler: requireRoleOrSelf(['admin', 'mgmt'], (req) => (req.query as any)?.userId) }, async (req) => {
    const { userId } = req.query as { userId?: string };
    const items = await prisma.leaveRequest.findMany({ where: { userId }, orderBy: { startDate: 'desc' }, take: 100 });
    return { items };
  });
}
