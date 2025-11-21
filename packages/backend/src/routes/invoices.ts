import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { nextNumber } from '../services/numbering.js';
import { createApproval } from '../services/approval.js';
import { FlowTypeValue, DocStatusValue } from '../types.js';

const prisma = new PrismaClient();

export async function registerInvoiceRoutes(app: FastifyInstance) {
  app.post('/projects/:projectId/invoices', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const body = req.body as any;
    const now = new Date();
    const { number, serial } = await nextNumber('invoice', now);
    const invoice = await prisma.invoice.create({
      data: {
        projectId,
        estimateId: body.estimateId,
        milestoneId: body.milestoneId,
        invoiceNo: number,
        issueDate: body.issueDate ? new Date(body.issueDate) : now,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        currency: body.currency || 'JPY',
        totalAmount: body.totalAmount,
        status: DocStatusValue.draft,
        numberingSerial: serial,
        lines: { create: body.lines || [] },
      },
      include: { lines: true },
    });
    return invoice;
  });

  app.post('/invoices/:id/submit', async (req) => {
    const { id } = req.params as { id: string };
    const invoice = await prisma.invoice.update({ where: { id }, data: { status: DocStatusValue.pending_qa } });
    await createApproval(FlowTypeValue.invoice, 'invoices', id, [{ approverGroupId: 'mgmt' }, { approverGroupId: 'exec' }]);
    return invoice;
  });
}
