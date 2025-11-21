import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { nextNumber } from '../services/numbering.js';
import { createApproval } from '../services/approval.js';
import { DocStatusValue, FlowTypeValue } from '../types.js';

const prisma = new PrismaClient();

export async function registerEstimateRoutes(app: FastifyInstance) {
  app.post('/projects/:projectId/estimates', async (req) => {
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
  });

  app.post('/estimates/:id/submit', async (req) => {
    const { id } = req.params as { id: string };
    const estimate = await prisma.estimate.update({ where: { id }, data: { status: DocStatusValue.pending_qa } });
    await createApproval(FlowTypeValue.estimate, 'estimates', id, [{ approverGroupId: 'mgmt' }, { approverGroupId: 'exec' }]);
    return estimate;
  });
}
