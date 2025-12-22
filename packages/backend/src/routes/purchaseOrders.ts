import { FastifyInstance } from 'fastify';
import { nextNumber } from '../services/numbering.js';
import { createApprovalFor } from '../services/approval.js';
import { FlowTypeValue, DocStatusValue } from '../types.js';
import { purchaseOrderSchema } from './validators.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';

export async function registerPurchaseOrderRoutes(app: FastifyInstance) {
  app.post(
    '/projects/:projectId/purchase-orders',
    { preHandler: requireRole(['admin', 'mgmt']), schema: purchaseOrderSchema },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as any;
      const now = new Date();
      const { number, serial } = await nextNumber('purchase_order', now);
      const po = await prisma.purchaseOrder.create({
        data: {
          projectId,
          vendorId: body.vendorId,
          poNo: number,
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
      return po;
    },
  );

  app.post(
    '/purchase-orders/:id/submit',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { id } = req.params as { id: string };
      const po = await prisma.purchaseOrder.update({
        where: { id },
        data: { status: DocStatusValue.pending_qa },
      });
      await createApprovalFor(
        FlowTypeValue.purchase_order,
        'purchase_orders',
        id,
        {
          totalAmount: po.totalAmount,
          projectId: po.projectId,
          vendorId: po.vendorId,
        },
        { createdBy: req.user?.userId },
      );
      return po;
    },
  );
}
