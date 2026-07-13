import type { FastifyInstance, FastifyRequest } from 'fastify';
import { nextNumber } from '../services/numbering.js';
import { DocStatusValue } from '../types.js';
import { purchaseOrderSchema } from './validators.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { checkProjectAndVendor } from '../services/entityChecks.js';
import { auditContextFromRequest } from '../services/audit.js';
import {
  submitPurchaseOrderForApproval,
  type PurchaseOrderActorContext,
} from '../application/purchaseOrders/useCases.js';

function purchaseOrderActorFromRequest(
  req: FastifyRequest,
): PurchaseOrderActorContext {
  return {
    userId: req.user?.userId ?? null,
    roles: req.user?.roles ?? [],
    groupIds: req.user?.groupIds ?? [],
    groupAccountIds: req.user?.groupAccountIds ?? [],
    projectIds: req.user?.projectIds ?? [],
  };
}

export async function registerPurchaseOrderRoutes(app: FastifyInstance) {
  app.get(
    '/purchase-orders',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { projectId, vendorId, status } = req.query as {
        projectId?: string;
        vendorId?: string;
        status?: string;
      };
      const where: Record<string, unknown> = {};
      if (projectId) where.projectId = projectId;
      if (vendorId) where.vendorId = vendorId;
      if (status) where.status = status;
      const items = await prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items };
    },
  );

  app.get(
    '/purchase-orders/:id',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const po = await prisma.purchaseOrder.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!po) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Purchase order not found' },
        });
      }
      return po;
    },
  );

  app.post(
    '/projects/:projectId/purchase-orders',
    { preHandler: requireRole(['admin', 'mgmt']), schema: purchaseOrderSchema },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as any;
      const { projectExists, vendorExists } = await checkProjectAndVendor(
        projectId,
        body.vendorId,
      );
      if (!projectExists) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }
      if (!vendorExists) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Vendor not found' },
        });
      }
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
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      const result = await submitPurchaseOrderForApproval({
        id,
        body,
        actor: purchaseOrderActorFromRequest(req),
        auditContext: auditContextFromRequest(req),
      });
      if (!result.ok) {
        return reply
          .status(result.statusCode)
          .type('application/json')
          .send(result.body);
      }
      return reply.type('application/json').send(result.value);
    },
  );
}
