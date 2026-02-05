import { FastifyInstance } from 'fastify';
import { act } from '../services/approval.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import {
  createApprovalOutcomeNotification,
  createApprovalPendingNotifications,
} from '../services/appNotifications.js';
import {
  approvalActionSchema,
  approvalCancelSchema,
  approvalRulePatchSchema,
  approvalRuleSchema,
} from './validators.js';
import { DocStatusValue, TimeStatusValue } from '../types.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { parseDateParam } from '../utils/date.js';
import { applyChatAckTemplates } from '../services/chatAckTemplates.js';

function hasValidSteps(steps: unknown) {
  if (Array.isArray(steps)) {
    return steps.every((s) => Boolean(s?.approverGroupId || s?.approverUserId));
  }
  if (!steps || typeof steps !== 'object') return false;
  const stages = (steps as any).stages;
  if (!Array.isArray(stages) || stages.length < 1) return false;
  const orders = new Set<number>();
  for (const stage of stages) {
    const order = Number(stage?.order);
    if (!Number.isInteger(order) || order < 1) return false;
    if (orders.has(order)) return false;
    orders.add(order);
    const approvers = stage?.approvers;
    if (!Array.isArray(approvers) || approvers.length < 1) return false;
    const completion = stage?.completion;
    if (completion && completion.mode === 'quorum') {
      const quorum = Number(completion.quorum);
      if (!Number.isInteger(quorum) || quorum < 1) return false;
      if (quorum > approvers.length) return false;
    }
    for (const approver of approvers) {
      const type = approver?.type;
      const id = approver?.id;
      if (type !== 'group' && type !== 'user') return false;
      if (typeof id !== 'string' || !id.trim()) return false;
    }
  }
  return true;
}

function ruleSnapshotForAudit(rule: any) {
  const toIso = (value: unknown) => {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  };
  return {
    id: rule?.id,
    flowType: rule?.flowType,
    version: rule?.version,
    isActive: rule?.isActive,
    effectiveFrom: toIso(rule?.effectiveFrom),
    conditions: rule?.conditions ?? null,
    steps: rule?.steps ?? null,
    createdAt: toIso(rule?.createdAt),
    updatedAt: toIso(rule?.updatedAt),
  };
}

const privilegedRoles = new Set(['admin', 'mgmt', 'exec']);
type ApprovalInstanceAccessFilter = {
  createdBy?: string;
  projectId?: { in: string[] };
};
const RESERVED_GROUP_IDS = new Set([
  'admin',
  'mgmt',
  'exec',
  'hr',
  'user',
  'external_chat',
]);

function normalizeSelector(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function extractUnknownApproverGroupError(err: unknown) {
  if (!err || typeof err !== 'object') return null;
  const message = (err as any).message;
  if (typeof message !== 'string') return null;
  if (!message.startsWith('unknown_approver_group:')) return null;
  return message.slice('unknown_approver_group:'.length);
}

function collectApprovalGroupSelectors(steps: unknown) {
  const selectors: string[] = [];
  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue;
      const approverGroupId = normalizeSelector((step as any).approverGroupId);
      if (approverGroupId) selectors.push(approverGroupId);
    }
    return selectors;
  }
  if (!steps || typeof steps !== 'object') return selectors;
  const stages = (steps as any).stages;
  if (!Array.isArray(stages)) return selectors;
  for (const stage of stages) {
    if (!stage || typeof stage !== 'object') continue;
    const approvers = Array.isArray((stage as any).approvers)
      ? (stage as any).approvers
      : [];
    for (const approver of approvers) {
      if (!approver || typeof approver !== 'object') continue;
      if ((approver as any).type !== 'group') continue;
      const id = normalizeSelector((approver as any).id);
      if (id) selectors.push(id);
    }
  }
  return selectors;
}

async function resolveGroupAccountIdBySelectorMap(selectors: string[]) {
  // NOTE: Only used in admin/mgmt protected routes. Do not reuse without ACLs.
  const normalized = Array.from(
    new Set(selectors.map((selector) => selector.trim()).filter(Boolean)),
  );
  if (!normalized.length) return new Map<string, string>();
  const rows = await prisma.groupAccount.findMany({
    where: {
      active: true,
      OR: [{ id: { in: normalized } }, { displayName: { in: normalized } }],
    },
    select: { id: true, displayName: true },
  });
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = normalizeSelector(row?.id);
    const displayName = normalizeSelector(row?.displayName);
    if (!id) continue;
    map.set(id, id);
    if (displayName) map.set(displayName, id);
  }
  return map;
}

function resolveSelectorStrict(
  selector: string,
  selectorMap: Map<string, string>,
) {
  const trimmed = selector.trim();
  if (!trimmed) return trimmed;
  const resolved = selectorMap.get(trimmed);
  if (resolved) return resolved;
  if (RESERVED_GROUP_IDS.has(trimmed)) return trimmed;
  throw new Error(`unknown_approver_group:${trimmed}`);
}

async function resolveGroupSelectorCandidates(selector: string) {
  const trimmed = normalizeSelector(selector);
  if (!trimmed) return [];
  const selectorMap = await resolveGroupAccountIdBySelectorMap([trimmed]);
  const resolved = selectorMap.get(trimmed);
  const candidates = new Set<string>([trimmed]);
  if (resolved) candidates.add(resolved);
  return Array.from(candidates);
}

async function resolveApprovalStepsGroupIds(steps: unknown) {
  const selectors = collectApprovalGroupSelectors(steps);
  const selectorMap = await resolveGroupAccountIdBySelectorMap(selectors);
  if (Array.isArray(steps)) {
    const resolved = [];
    for (const step of steps) {
      if (!step || typeof step !== 'object') {
        resolved.push(step);
        continue;
      }
      const approverGroupId =
        typeof (step as any).approverGroupId === 'string'
          ? resolveSelectorStrict((step as any).approverGroupId, selectorMap)
          : (step as any).approverGroupId;
      resolved.push({
        ...(step as any),
        ...(approverGroupId !== undefined ? { approverGroupId } : {}),
      });
    }
    return resolved;
  }
  if (!steps || typeof steps !== 'object') return steps;
  const stages = (steps as any).stages;
  if (!Array.isArray(stages)) return steps;
  const resolvedStages = [];
  for (const stage of stages) {
    if (!stage || typeof stage !== 'object') {
      resolvedStages.push(stage);
      continue;
    }
    const approvers = Array.isArray((stage as any).approvers)
      ? (stage as any).approvers
      : [];
    const resolvedApprovers = [];
    for (const approver of approvers) {
      if (!approver || typeof approver !== 'object') {
        resolvedApprovers.push(approver);
        continue;
      }
      if (
        (approver as any).type === 'group' &&
        typeof (approver as any).id === 'string'
      ) {
        const id = resolveSelectorStrict((approver as any).id, selectorMap);
        resolvedApprovers.push({ ...(approver as any), id });
      } else {
        resolvedApprovers.push(approver);
      }
    }
    resolvedStages.push({ ...(stage as any), approvers: resolvedApprovers });
  }
  return { ...(steps as any), stages: resolvedStages };
}

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
    return;
  }
  throw new Error(`Unsupported approval target table: ${targetTable}`);
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
      if (body.steps !== undefined) {
        try {
          body.steps = await resolveApprovalStepsGroupIds(body.steps);
        } catch (err) {
          const unknownGroup = extractUnknownApproverGroupError(err);
          if (unknownGroup !== null) {
            return reply.code(400).send({
              error: 'unknown_approver_group',
              message: `unknown approver group: ${unknownGroup}`,
            });
          }
          throw err;
        }
      }
      if (!hasValidSteps(body.steps || [])) {
        return reply.code(400).send({
          error: 'invalid_steps',
          message:
            'steps must be either an array of steps (approverGroupId/approverUserId) or {stages:[{order, approvers:[{type,id}], completion?}]}; stage.order must be unique; quorum must be <= approvers.length',
        });
      }
      let effectiveFrom: Date | undefined;
      if (body.effectiveFrom !== undefined) {
        const parsed = parseDateParam(body.effectiveFrom);
        if (!parsed) {
          return reply.code(400).send({
            error: 'invalid_effectiveFrom',
            message: 'effectiveFrom must be a valid date-time string',
          });
        }
        effectiveFrom = parsed;
      }
      const created = await prisma.approvalRule.create({
        data: {
          ...body,
          ...(effectiveFrom !== undefined ? { effectiveFrom } : {}),
        },
      });
      await logAudit({
        action: 'approval_rule_created',
        targetTable: 'approval_rules',
        targetId: created.id,
        metadata: {
          flowType: created.flowType,
          after: ruleSnapshotForAudit(created),
        },
        ...auditContextFromRequest(req),
      });
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
      if (body.steps !== undefined) {
        try {
          body.steps = await resolveApprovalStepsGroupIds(body.steps);
        } catch (err) {
          const unknownGroup = extractUnknownApproverGroupError(err);
          if (unknownGroup !== null) {
            return reply.code(400).send({
              error: 'unknown_approver_group',
              message: `unknown approver group: ${unknownGroup}`,
            });
          }
          throw err;
        }
      }
      if (body.steps && !hasValidSteps(body.steps || [])) {
        return reply.code(400).send({
          error: 'invalid_steps',
          message:
            'steps must be either an array of steps (approverGroupId/approverUserId) or {stages:[{order, approvers:[{type,id}], completion?}]}; stage.order must be unique; quorum must be <= approvers.length',
        });
      }
      let effectiveFrom: Date | undefined;
      if (body.effectiveFrom !== undefined) {
        const parsed = parseDateParam(body.effectiveFrom);
        if (!parsed) {
          return reply.code(400).send({
            error: 'invalid_effectiveFrom',
            message: 'effectiveFrom must be a valid date-time string',
          });
        }
        effectiveFrom = parsed;
      }
      const { before, updated } = await prisma.$transaction(async (tx) => {
        const before = await tx.approvalRule.findUnique({ where: { id } });
        const updated = await tx.approvalRule.update({
          where: { id },
          data: {
            ...body,
            ...(effectiveFrom !== undefined ? { effectiveFrom } : {}),
          },
        });
        return { before, updated };
      });
      await logAudit({
        action: 'approval_rule_updated',
        targetTable: 'approval_rules',
        targetId: updated.id,
        metadata: {
          flowType: updated.flowType,
          before: before ? ruleSnapshotForAudit(before) : null,
          after: ruleSnapshotForAudit(updated),
          patch: body,
        },
        ...auditContextFromRequest(req),
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
      if (approverGroupId) {
        const raw = String(approverGroupId);
        const candidates = await resolveGroupSelectorCandidates(raw);
        if (candidates.length) {
          stepsFilter.approverGroupId = { in: candidates };
        }
      }
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
      const actorGroupAccountIds = req.user?.groupAccountIds ?? [];
      try {
        const result = await act(id, userId, body.action, {
          reason: body.reason,
          actorGroupId,
          actorGroupIds,
          actorGroupAccountIds,
          auditContext: auditContextFromRequest(req, { userId }),
        });
        const instance = await prisma.approvalInstance.findUnique({
          where: { id },
          include: { steps: true },
        });
        if (instance?.createdBy) {
          if (result.status === DocStatusValue.approved) {
            await createApprovalOutcomeNotification({
              approvalInstanceId: instance.id,
              projectId: instance.projectId,
              requesterUserId: instance.createdBy,
              actorUserId: userId,
              flowType: instance.flowType,
              targetTable: instance.targetTable,
              targetId: instance.targetId,
              outcome: 'approved',
            });
          } else if (result.status === DocStatusValue.rejected) {
            await createApprovalOutcomeNotification({
              approvalInstanceId: instance.id,
              projectId: instance.projectId,
              requesterUserId: instance.createdBy,
              actorUserId: userId,
              flowType: instance.flowType,
              targetTable: instance.targetTable,
              targetId: instance.targetId,
              outcome: 'rejected',
            });
          } else if (
            result.status === DocStatusValue.pending_qa ||
            result.status === DocStatusValue.pending_exec
          ) {
            await createApprovalPendingNotifications({
              approvalInstanceId: instance.id,
              projectId: instance.projectId,
              requesterUserId: instance.createdBy,
              actorUserId: userId,
              flowType: instance.flowType,
              targetTable: instance.targetTable,
              targetId: instance.targetId,
              currentStep: instance.currentStep,
              steps: instance.steps,
            });
          }
        }
        if (instance) {
          try {
            await applyChatAckTemplates({
              req,
              flowType: instance.flowType,
              actionKey: body.action,
              targetTable: 'approval_instances',
              targetId: instance.id,
              projectId: instance.projectId,
              actorUserId: userId,
            });
          } catch (err) {
            req.log?.warn(
              { err, approvalInstanceId: instance.id },
              'applyChatAckTemplates failed',
            );
          }
        }
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
            targetTable: 'approval_instances',
            targetId: instance.id,
            reasonText: reason,
            actorGroupId,
            metadata: {
              fromStatus: instance.status,
              toStatus: DocStatusValue.cancelled,
              targetTable: instance.targetTable,
              targetId: instance.targetId,
            },
            ...auditContextFromRequest(req, { userId }),
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
