import type { Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { nextNumber } from '../services/numbering.js';
import { submitApprovalWithUpdate } from '../services/approval.js';
import { DocStatusValue, FlowTypeValue } from '../types.js';
import { estimateSchema } from './validators.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';

export async function registerEstimateRoutes(app: FastifyInstance) {
  app.get(
    '/estimates',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { projectId, status } = req.query as {
        projectId?: string;
        status?: string;
      };
      const where: Prisma.EstimateWhereInput = {};
      if (projectId) where.projectId = projectId;
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

  app.get(
    '/estimates/:id',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const estimate = await prisma.estimate.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!estimate) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Estimate not found' },
        });
      }
      return estimate;
    },
  );

  app.get(
    '/projects/:projectId/estimates',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const { status } = req.query as { status?: string };
      const where: Prisma.EstimateWhereInput = { projectId };
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
      const { updated } = await submitApprovalWithUpdate({
        flowType: FlowTypeValue.estimate,
        targetTable: 'estimates',
        targetId: id,
        update: (tx) =>
          tx.estimate.update({
            where: { id },
            data: { status: DocStatusValue.pending_qa },
          }),
        createdBy: req.user?.userId,
      });
      return updated;
    },
  );
}
