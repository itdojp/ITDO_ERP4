import { FastifyInstance } from 'fastify';
import { act } from '../services/approval.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import {
  approvalActionSchema,
  approvalCancelSchema,
  approvalRulePatchSchema,
  approvalRuleSchema,
} from './validators.js';
import { DocStatusValue, TimeStatusValue } from '../types.js';
import { logAudit } from '../services/audit.js';

function hasValidSteps(
  steps: Array<{ approverGroupId?: string; approverUserId?: string }>,
) {
  return steps.every((s) => Boolean(s.approverGroupId || s.approverUserId));
}

const privilegedRoles = new Set(['admin', 'mgmt', 'exec']);
type ApprovalInstanceAccessFilter = {
  createdBy?: string;
  projectId?: { in: string[] };
};

async function resetTargetStatus(
  tx: any,
  targetTable: string,
  targetId: string,
) {
  if (targetTable === 'estimates') {
    await tx.estimate.update({
      where: { id: targetId },
      data: { status: DocStatusValue.draft },
    });
    return;
  }
  if (targetTable === 'invoices') {
    await tx.invoice.update({
      where: { id: targetId },
      data: { status: DocStatusValue.draft },
    });
    return;
  }
  if (targetTable === 'expenses') {
    await tx.expense.update({
      where: { id: targetId },
      data: { status: DocStatusValue.draft },
    });
    return;
  }
  if (targetTable === 'purchase_orders') {
    await tx.purchaseOrder.update({
      where: { id: targetId },
      data: { status: DocStatusValue.draft },
    });
    return;
  }
  if (targetTable === 'vendor_invoices') {
    await tx.vendorInvoice.update({
      where: { id: targetId },
      data: { status: DocStatusValue.received },
    });
    return;
  }
  if (targetTable === 'vendor_quotes') {
    await tx.vendorQuote.update({
      where: { id: targetId },
      data: { status: DocStatusValue.received },
    });
    return;
  }
  if (targetTable === 'time_entries') {
    await tx.timeEntry.update({
      where: { id: targetId },
      data: { status: TimeStatusValue.submitted },
    });
    return;
  }
  if (targetTable === 'leave_requests') {
    await tx.leaveRequest.update({
      where: { id: targetId },
      data: { status: 'draft' },
    });
  }
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
        return reply.code(400).send({
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
        return reply.code(400).send({
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
    { preHandler: requireRole(['admin', 'mgmt', 'exec', 'user']) },
    async (req, reply) => {
      const roles = req.user?.roles || [];
      const userId = req.user?.userId;
      const userProjectIds = req.user?.projectIds || [];
      const isPrivileged = roles.some((role) => privilegedRoles.has(role));
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
      if (!isPrivileged) {
        if (!userId) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        const accessFilters: ApprovalInstanceAccessFilter[] = [
          { createdBy: userId },
        ];
        if (userProjectIds.length) {
          accessFilters.push({ projectId: { in: userProjectIds } });
        }
        where.AND = [...(where.AND || []), { OR: accessFilters }];
      }
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
      const actorGroupIds = req.user?.groupIds ?? [];
      try {
        const result = await act(id, userId, body.action, {
          reason: body.reason,
          actorGroupId,
          actorGroupIds,
        });
        return result;
      } catch (err: any) {
        return reply.code(400).send({
          error: 'approval_action_failed',
          message: err?.message || 'failed',
        });
      }
    },
  );

  app.post(
    '/approval-instances/:id/cancel',
    {
      preHandler: requireRole(['admin', 'mgmt', 'exec', 'user']),
      schema: approvalCancelSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { reason: string };
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!reason) {
        return reply.code(400).send({
          error: 'invalid_reason',
          message: 'reason is required',
        });
      }
      const roles = req.user?.roles || [];
      const userId = req.user?.userId;
      if (!userId) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const isPrivileged = roles.some((role) => privilegedRoles.has(role));
      const actorGroupId = req.user?.groupIds?.[0];
      const now = new Date();
      try {
        const cancelled = await prisma.$transaction(async (tx: any) => {
          const instance = await tx.approvalInstance.findUnique({
            where: { id },
            include: { steps: true },
          });
          if (!instance) {
            return null;
          }
          if (
            instance.status === DocStatusValue.approved ||
            instance.status === DocStatusValue.rejected ||
            instance.status === DocStatusValue.cancelled
          ) {
            throw new Error('instance_closed');
          }
          if (!isPrivileged && instance.createdBy !== userId) {
            throw new Error('forbidden');
          }
          await tx.approvalInstance.update({
            where: { id },
            data: { status: DocStatusValue.cancelled, currentStep: null },
          });
          await tx.approvalStep.updateMany({
            where: {
              instanceId: id,
              status: {
                in: [DocStatusValue.pending_qa, DocStatusValue.pending_exec],
              },
            },
            data: {
              status: DocStatusValue.cancelled,
              actedBy: userId,
              actedAt: now,
            },
          });
          await resetTargetStatus(tx, instance.targetTable, instance.targetId);
          await logAudit({
            action: 'approval_cancel',
            userId,
            targetTable: 'approval_instances',
            targetId: instance.id,
            metadata: {
              fromStatus: instance.status,
              toStatus: DocStatusValue.cancelled,
              reason,
              actorGroupId,
              targetTable: instance.targetTable,
              targetId: instance.targetId,
            },
          });
          return { status: DocStatusValue.cancelled };
        });
        if (!cancelled) {
          return reply.code(404).send({ error: 'not_found' });
        }
        return cancelled;
      } catch (err: any) {
        if (err?.message === 'forbidden') {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (err?.message === 'instance_closed') {
          return reply.code(400).send({ error: 'instance_closed' });
        }
        return reply.code(400).send({
          error: 'approval_cancel_failed',
          message: err?.message || 'failed',
        });
      }
    },
  );
}
