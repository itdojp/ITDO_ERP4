import { FastifyInstance } from 'fastify';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';

export async function registerApprovalRuleRoutes(app: FastifyInstance) {
  app.get('/approval-rules', { preHandler: requireRole(['admin', 'mgmt']) }, async () => {
    const items = await prisma.approvalRule.findMany({ orderBy: { createdAt: 'desc' } });
    return { items };
  });

  app.post('/approval-rules', { preHandler: requireRole(['admin', 'mgmt']) }, async (req) => {
    const body = req.body as any;
    const created = await prisma.approvalRule.create({ data: body });
    return created;
  });

  app.patch('/approval-rules/:id', { preHandler: requireRole(['admin', 'mgmt']) }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const updated = await prisma.approvalRule.update({ where: { id }, data: body });
    return updated;
  });
}
