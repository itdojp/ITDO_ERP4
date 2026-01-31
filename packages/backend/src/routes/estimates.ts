import { FastifyInstance } from 'fastify';
import { nextNumber } from '../services/numbering.js';
import { submitApprovalWithUpdate } from '../services/approval.js';
import { createApprovalPendingNotifications } from '../services/appNotifications.js';
import { DocStatusValue, FlowTypeValue } from '../types.js';
import { estimateSchema } from './validators.js';
import { requireProjectAccess, requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { evaluateActionPolicyWithFallback } from '../services/actionPolicy.js';
import { logActionPolicyOverrideIfNeeded } from '../services/actionPolicyAudit.js';

export async function registerEstimateRoutes(app: FastifyInstance) {
  app.get(
    '/estimates',
    { preHandler: requireRole(['admin', 'mgmt', 'user']) },
    async (req, reply) => {
      const { projectId, status } = req.query as {
        projectId?: string;
        status?: string;
      };
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      if (!isPrivileged) {
        if (!projectIds.length) return { items: [] };
        if (projectId && !projectIds.includes(projectId)) {
          return reply.code(403).send({ error: 'forbidden_project' });
        }
      }
      const where: Record<string, unknown> = {};
      if (projectId) {
        where.projectId = projectId;
      } else if (!isPrivileged) {
        where.projectId = { in: projectIds };
      }
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
    { preHandler: requireRole(['admin', 'mgmt', 'user']) },
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
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      if (!isPrivileged && !projectIds.includes(estimate.projectId)) {
        return reply.code(403).send({ error: 'forbidden_project' });
      }
      return estimate;
    },
  );

  app.get(
    '/projects/:projectId/estimates',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const { status } = req.query as { status?: string };
      const where: Record<string, unknown> = { projectId };
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
          estimateNo: number,
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
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      const reasonText =
        typeof body?.reasonText === 'string' ? body.reasonText.trim() : '';
      const estimate = await prisma.estimate.findUnique({
        where: { id },
        select: { status: true, projectId: true },
      });
      if (estimate) {
        const policyRes = await evaluateActionPolicyWithFallback({
          flowType: FlowTypeValue.estimate,
          actionKey: 'submit',
          actor: {
            userId: req.user?.userId ?? null,
            roles: req.user?.roles || [],
            groupIds: req.user?.groupIds || [],
            groupAccountIds: req.user?.groupAccountIds || [],
          },
          reasonText,
          state: { status: estimate.status, projectId: estimate.projectId },
          targetTable: 'estimates',
          targetId: id,
        });
        if (policyRes.policyApplied && !policyRes.allowed) {
          if (policyRes.reason === 'reason_required') {
            return reply.status(400).send({
              error: {
                code: 'REASON_REQUIRED',
                message: 'reasonText is required for override',
                details: { matchedPolicyId: policyRes.matchedPolicyId ?? null },
              },
            });
          }
          return reply.status(403).send({
            error: {
              code: 'ACTION_POLICY_DENIED',
              message: 'Estimate cannot be submitted',
              details: {
                reason: policyRes.reason,
                matchedPolicyId: policyRes.matchedPolicyId ?? null,
                guardFailures: policyRes.guardFailures ?? null,
              },
            },
          });
        }
        await logActionPolicyOverrideIfNeeded({
          req,
          flowType: FlowTypeValue.estimate,
          actionKey: 'submit',
          targetTable: 'estimates',
          targetId: id,
          reasonText,
          result: policyRes,
        });
      }
      const actorUserId = req.user?.userId || 'system';
      const { updated, approval } = await submitApprovalWithUpdate({
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
      await createApprovalPendingNotifications({
        approvalInstanceId: approval.id,
        projectId: approval.projectId,
        requesterUserId: actorUserId,
        actorUserId,
        flowType: approval.flowType,
        targetTable: approval.targetTable,
        targetId: approval.targetId,
        currentStep: approval.currentStep,
        steps: approval.steps,
      });
      return updated;
    },
  );
}
