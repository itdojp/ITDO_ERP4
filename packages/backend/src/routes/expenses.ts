import { FastifyInstance } from 'fastify';
import { submitApprovalWithUpdate } from '../services/approval.js';
import { expenseSchema } from './validators.js';
import { DocStatusValue, FlowTypeValue } from '../types.js';
import { requireProjectAccess, requireRole, requireRoleOrSelf } from '../services/rbac.js';
import { prisma } from '../services/db.js';

export async function registerExpenseRoutes(app: FastifyInstance) {
  app.post(
    '/expenses',
    {
      schema: expenseSchema,
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        requireProjectAccess((req) => (req.body as any)?.projectId),
      ],
    },
    async (req) => {
      const body = req.body as any;
      const expense = await prisma.expense.create({ data: body });
      return expense;
    },
  );

  app.get(
    '/expenses',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        requireProjectAccess((req) => (req.query as any)?.projectId),
      ],
    },
    async (req) => {
      const { projectId, userId, from, to } = req.query as { projectId?: string; userId?: string; from?: string; to?: string };
      const roles = req.user?.roles || [];
      const currentUserId = req.user?.userId;
      const where: any = {};
      if (projectId) where.projectId = projectId;
      if (!roles.includes('admin') && !roles.includes('mgmt')) {
        where.userId = currentUserId;
      } else if (userId) {
        where.userId = userId;
      }
      if (from || to) {
        where.incurredOn = {};
        if (from) where.incurredOn.gte = new Date(from);
        if (to) where.incurredOn.lte = new Date(to);
      }
      const items = await prisma.expense.findMany({ where, orderBy: { incurredOn: 'desc' }, take: 200 });
      return { items };
    },
  );

  app.post('/expenses/:id/submit', { preHandler: requireRoleOrSelf(['admin', 'mgmt'], (req) => req.user?.userId) }, async (req) => {
    const { id } = req.params as { id: string };
    const userId = req.user?.userId;
    const { updated } = await submitApprovalWithUpdate({
      flowType: FlowTypeValue.expense,
      targetTable: 'expenses',
      targetId: id,
      update: (tx) => tx.expense.update({ where: { id }, data: { status: DocStatusValue.pending_qa } }),
      createdBy: userId,
    });
    return updated;
  });
}
