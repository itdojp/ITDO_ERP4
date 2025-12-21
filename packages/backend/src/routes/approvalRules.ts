import { FastifyInstance } from 'fastify';
import { act } from '../services/approval.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { approvalActionSchema } from './validators.js';

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

  app.post(
    '/approval-instances/:id/act',
    { preHandler: requireRole(['admin', 'mgmt', 'exec']), schema: approvalActionSchema },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { action: 'approve' | 'reject'; reason?: string };
      const userId = req.user?.userId || 'system';
      try {
        const result = await act(id, userId, body.action);
        return result;
      } catch (err: any) {
        return reply.code(400).send({ error: 'approval_action_failed', message: err?.message || 'failed' });
      }
    },
  );
}
