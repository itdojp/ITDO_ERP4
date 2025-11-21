import { FastifyInstance } from 'fastify';
import { createApproval } from '../services/approval.js';
import { expenseSchema } from './validators.js';
import { DocStatusValue, FlowTypeValue } from '../types.js';
import { requireRole, requireRoleOrSelf } from '../services/rbac.js';
import { prisma } from '../services/db.js';

export async function registerExpenseRoutes(app: FastifyInstance) {
  app.post('/expenses', { schema: expenseSchema, preHandler: requireRole(['admin', 'mgmt', 'user']) }, async (req) => {
    const body = req.body as any;
    const expense = await prisma.expense.create({ data: body });
    return expense;
  });

  app.get('/expenses', { preHandler: requireRole(['admin', 'mgmt', 'user']) }, async (req) => {
    const { projectId, userId } = req.query as { projectId?: string; userId?: string };
    const roles = req.user?.roles || [];
    const currentUserId = req.user?.userId;
    const where: any = {};
    if (projectId) where.projectId = projectId;
    if (!roles.includes('admin') && !roles.includes('mgmt')) {
      where.userId = currentUserId;
    } else if (userId) {
      where.userId = userId;
    }
    const items = await prisma.expense.findMany({ where, orderBy: { incurredOn: 'desc' }, take: 200 });
    return { items };
  });

  app.post('/expenses/:id/submit', { preHandler: requireRoleOrSelf(['admin', 'mgmt'], (req) => req.user?.userId) }, async (req) => {
    const { id } = req.params as { id: string };
    const exp = await prisma.expense.update({ where: { id }, data: { status: DocStatusValue.pending_qa } });
    await createApproval(FlowTypeValue.expense, 'expenses', id, [{ approverGroupId: 'mgmt' }]);
    return exp;
  });
}
