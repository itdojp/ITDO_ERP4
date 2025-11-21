import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { createApproval } from '../services/approval.js';
import { expenseSchema } from './validators.js';
import { DocStatusValue, FlowTypeValue } from '../types.js';

const prisma = new PrismaClient();

export async function registerExpenseRoutes(app: FastifyInstance) {
  app.post('/expenses', { schema: expenseSchema }, async (req) => {
    const body = req.body as any;
    const expense = await prisma.expense.create({ data: body });
    return expense;
  });

  app.get('/expenses', async (req) => {
    const { projectId, userId } = req.query as { projectId?: string; userId?: string };
    const items = await prisma.expense.findMany({ where: { projectId, userId }, orderBy: { incurredOn: 'desc' }, take: 200 });
    return { items };
  });

  app.post('/expenses/:id/submit', async (req) => {
    const { id } = req.params as { id: string };
    const exp = await prisma.expense.update({ where: { id }, data: { status: DocStatusValue.pending_qa } });
    await createApproval(FlowTypeValue.expense, 'expenses', id, [{ approverGroupId: 'mgmt' }]);
    return exp;
  });
}
