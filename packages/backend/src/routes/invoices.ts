import { FastifyInstance } from 'fastify';
import { nextNumber } from '../services/numbering.js';
import { submitApprovalWithUpdate } from '../services/approval.js';
import { FlowTypeValue, DocStatusValue } from '../types.js';
import { invoiceSchema } from './validators.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';

export async function registerInvoiceRoutes(app: FastifyInstance) {
  app.get(
    '/projects/:projectId/invoices',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const { status, from, to } = req.query as {
        status?: string;
        from?: string;
        to?: string;
      };
      const where: any = { projectId };
      if (status) where.status = status;
      if (from || to) {
        where.issueDate = {};
        if (from) where.issueDate.gte = new Date(from);
        if (to) where.issueDate.lte = new Date(to);
      }
      const items = await prisma.invoice.findMany({
        where,
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items };
    },
  );

  app.post(
    '/projects/:projectId/invoices',
    { preHandler: requireRole(['admin', 'mgmt']), schema: invoiceSchema },
    async (req) => {
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
    },
  );

  app.post(
    '/invoices/:id/submit',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { id } = req.params as { id: string };
      const { updated } = await submitApprovalWithUpdate({
        flowType: FlowTypeValue.invoice,
        targetTable: 'invoices',
        targetId: id,
        update: (tx) =>
          tx.invoice.update({
            where: { id },
            data: { status: DocStatusValue.pending_qa },
          }),
        createdBy: req.user?.userId,
      });
      return updated;
    },
  );
}
