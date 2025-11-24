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

  app.get('/approval-instances', { preHandler: requireRole(['admin', 'mgmt']) }, async (req) => {
    const { flowType, status, approverGroupId, projectId, approverUserId, requesterId } = req.query as any;
    const stepsFilter: any = {};
    if (approverGroupId) stepsFilter.approverGroupId = approverGroupId;
    if (approverUserId) stepsFilter.approverUserId = approverUserId;

    const where: any = {
      ...(flowType ? { flowType } : {}),
      ...(status ? { status } : {}),
      ...(projectId ? { targetId: projectId } : {}),
      ...(requesterId ? { createdBy: requesterId } : {}),
      ...(approverGroupId || approverUserId ? { steps: { some: stepsFilter } } : {}),
    };
    const items = await prisma.approvalInstance.findMany({
      where,
      include: { steps: true, rule: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { items };
  });
}
