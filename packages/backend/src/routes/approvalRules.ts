import { FastifyInstance } from 'fastify';
import { act } from '../services/approval.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import {
  approvalActionSchema,
  approvalRulePatchSchema,
  approvalRuleSchema,
} from './validators.js';

function hasValidSteps(
  steps: Array<{ approverGroupId?: string; approverUserId?: string }>,
) {
  return steps.every((s) => Boolean(s.approverGroupId || s.approverUserId));
}

export async function registerApprovalRuleRoutes(app: FastifyInstance) {
  app.get(
    '/approval-rules',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async () => {
      const items = await prisma.approvalRule.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return { items };
    },
  );

  app.post(
    '/approval-rules',
    { preHandler: requireRole(['admin', 'mgmt']), schema: approvalRuleSchema },
    async (req, reply) => {
      const body = req.body as any;
      if (!hasValidSteps(body.steps || [])) {
        return reply
          .code(400)
          .send({
            error: 'invalid_steps',
            message: 'approverGroupId or approverUserId is required per step',
          });
      }
      const created = await prisma.approvalRule.create({ data: body });
      return created;
    },
  );

  app.patch(
    '/approval-rules/:id',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: approvalRulePatchSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      if (body.steps && !hasValidSteps(body.steps || [])) {
        return reply
          .code(400)
          .send({
            error: 'invalid_steps',
            message: 'approverGroupId or approverUserId is required per step',
          });
      }
      const updated = await prisma.approvalRule.update({
        where: { id },
        data: body,
      });
      return updated;
    },
  );

  app.get(
    '/approval-instances',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const {
        flowType,
        status,
        approverGroupId,
        projectId,
        approverUserId,
        requesterId,
        currentStep,
      } = req.query as any;
      const stepsFilter: any = {};
      if (approverGroupId) stepsFilter.approverGroupId = approverGroupId;
      if (approverUserId) stepsFilter.approverUserId = approverUserId;

      const where: any = {
        ...(flowType ? { flowType } : {}),
        ...(status ? { status } : {}),
        ...(projectId ? { projectId } : {}),
        ...(requesterId ? { createdBy: requesterId } : {}),
        ...(currentStep !== undefined && currentStep !== ''
          ? { currentStep: Number(currentStep) }
          : {}),
        ...(approverGroupId || approverUserId
          ? { steps: { some: stepsFilter } }
          : {}),
      };
      const items = await prisma.approvalInstance.findMany({
        where,
        include: { steps: true, rule: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items };
    },
  );

  app.post(
    '/approval-instances/:id/act',
    {
      preHandler: requireRole(['admin', 'mgmt', 'exec']),
      schema: approvalActionSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        action: 'approve' | 'reject';
        reason?: string;
      };
      const userId = req.user?.userId || 'system';
      const actorGroupId = req.user?.groupIds?.[0];
      try {
        const result = await act(id, userId, body.action, {
          reason: body.reason,
          actorGroupId,
        });
        return result;
      } catch (err: any) {
        return reply
          .code(400)
          .send({
            error: 'approval_action_failed',
            message: err?.message || 'failed',
          });
      }
    },
  );
}
