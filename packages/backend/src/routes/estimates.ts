import { FastifyInstance } from 'fastify';
import { nextNumber } from '../services/numbering.js';
import { createApprovalFor } from '../services/approval.js';
import { DocStatusValue, FlowTypeValue } from '../types.js';
import { estimateSchema } from './validators.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';

export async function registerEstimateRoutes(app: FastifyInstance) {
  app.get(
    '/projects/:projectId/estimates',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const { status } = req.query as { status?: string };
      const where: any = { projectId };
      if (status) where.status = status;
      const items = await prisma.estimate.findMany({
        where,
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items };
    },
  );

  app.post(
    '/projects/:projectId/estimates',
    { preHandler: requireRole(['admin', 'mgmt']), schema: estimateSchema },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as any;
      const now = new Date();
      const { number, serial } = await nextNumber('estimate', now);
      const estimate = await prisma.estimate.create({
        data: {
          projectId,
          version: serial,
          totalAmount: body.totalAmount,
          currency: body.currency || 'JPY',
          status: DocStatusValue.draft,
          validUntil: body.validUntil ? new Date(body.validUntil) : null,
          notes: body.notes,
          numberingSerial: serial,
          lines: { create: body.lines || [] },
        },
        include: { lines: true },
      });
      return { number, estimate };
    },
  );

  app.post(
    '/estimates/:id/submit',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { id } = req.params as { id: string };
      const estimate = await prisma.estimate.update({
        where: { id },
        data: { status: DocStatusValue.pending_qa },
      });
      await createApprovalFor(
        FlowTypeValue.estimate,
        'estimates',
        id,
        { totalAmount: estimate.totalAmount },
        { createdBy: req.user?.userId },
      );
      return estimate;
    },
  );
}
