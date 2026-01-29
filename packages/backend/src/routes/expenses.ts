import { FastifyInstance } from 'fastify';
import { submitApprovalWithUpdate } from '../services/approval.js';
import { expenseReassignSchema, expenseSchema } from './validators.js';
import { DocStatusValue, FlowTypeValue } from '../types.js';
import { requireProjectAccess, requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { logReassignment } from '../services/reassignmentLog.js';
import { parseDateParam } from '../utils/date.js';
import { findPeriodLock, toPeriodKey } from '../services/periodLock.js';
import { evaluateActionPolicyWithFallback } from '../services/actionPolicy.js';

export async function registerExpenseRoutes(app: FastifyInstance) {
  app.post(
    '/expenses',
    {
      schema: expenseSchema,
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        requireProjectAccess((req) => (req.body as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const body = req.body as any;
      const roles = req.user?.roles || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      const currentUserId = req.user?.userId;
      if (!isPrivileged) {
        if (!currentUserId) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        body.userId = currentUserId;
      }
      const incurredOn = parseDateParam(body.incurredOn);
      if (!incurredOn) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid incurredOn' },
        });
      }
      const expense = await prisma.expense.create({
        data: { ...body, incurredOn },
      });
      return expense;
    },
  );

  app.get(
    '/expenses',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        requireProjectAccess((req) => (req.query as any)?.projectId),
      ],
    },
    async (req) => {
      const { projectId, userId, from, to } = req.query as {
        projectId?: string;
        userId?: string;
        from?: string;
        to?: string;
      };
      const roles = req.user?.roles || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      const currentUserId = req.user?.userId;
      const projectIds = req.user?.projectIds || [];
      const where: any = {};
      if (projectId) {
        where.projectId = projectId;
      } else if (!isPrivileged) {
        if (!projectIds.length) return { items: [] };
        where.projectId = { in: projectIds };
      }
      if (!isPrivileged) {
        where.userId = currentUserId;
      } else if (userId) {
        where.userId = userId;
      }
      if (from || to) {
        where.incurredOn = {};
        if (from) where.incurredOn.gte = new Date(from);
        if (to) where.incurredOn.lte = new Date(to);
      }
      const items = await prisma.expense.findMany({
        where,
        orderBy: { incurredOn: 'desc' },
        take: 200,
      });
      return { items };
    },
  );

  app.post(
    '/expenses/:id/submit',
    { preHandler: requireRole(['admin', 'mgmt', 'user']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      const reasonText =
        typeof body?.reasonText === 'string' ? body.reasonText.trim() : '';
      const expense = await prisma.expense.findUnique({ where: { id } });
      if (!expense) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const roles = req.user?.roles || [];
      const userId = req.user?.userId;
      if (
        !roles.includes('admin') &&
        !roles.includes('mgmt') &&
        expense.userId !== userId
      ) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const policyRes = await evaluateActionPolicyWithFallback({
        flowType: FlowTypeValue.expense,
        actionKey: 'submit',
        actor: {
          userId: req.user?.userId ?? null,
          roles: req.user?.roles || [],
          groupIds: req.user?.groupIds || [],
        },
        reasonText,
        state: { status: expense.status, projectId: expense.projectId },
        targetTable: 'expenses',
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
            message: 'Expense cannot be submitted',
            details: {
              reason: policyRes.reason,
              matchedPolicyId: policyRes.matchedPolicyId ?? null,
              guardFailures: policyRes.guardFailures ?? null,
            },
          },
        });
      }
      const { updated } = await submitApprovalWithUpdate({
        flowType: FlowTypeValue.expense,
        targetTable: 'expenses',
        targetId: id,
        update: (tx) =>
          tx.expense.update({
            where: { id },
            data: { status: DocStatusValue.pending_qa },
          }),
        createdBy: userId,
      });
      return updated;
    },
  );

  app.post(
    '/expenses/:id/reassign',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: expenseReassignSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      const reasonText =
        typeof body.reasonText === 'string' ? body.reasonText.trim() : '';
      if (!reasonText) {
        return reply.status(400).send({
          error: { code: 'INVALID_REASON', message: 'reasonText is required' },
        });
      }
      const expense = await prisma.expense.findUnique({ where: { id } });
      if (!expense) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Expense not found' },
        });
      }
      if (expense.deletedAt) {
        return reply.status(400).send({
          error: { code: 'ALREADY_DELETED', message: 'Expense deleted' },
        });
      }
      if (
        expense.status !== DocStatusValue.draft &&
        expense.status !== DocStatusValue.rejected
      ) {
        return reply.status(400).send({
          error: { code: 'INVALID_STATUS', message: 'Expense not editable' },
        });
      }
      const pendingApproval = await prisma.approvalInstance.findFirst({
        where: {
          targetTable: 'expenses',
          targetId: id,
          status: {
            in: [DocStatusValue.pending_qa, DocStatusValue.pending_exec],
          },
        },
        select: { id: true },
      });
      if (pendingApproval) {
        return reply.status(400).send({
          error: { code: 'PENDING_APPROVAL', message: 'Approval in progress' },
        });
      }
      const targetProject = await prisma.project.findUnique({
        where: { id: body.toProjectId },
        select: { id: true, deletedAt: true },
      });
      if (!targetProject || targetProject.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }
      const periodKey = toPeriodKey(expense.incurredOn);
      const fromLock = await findPeriodLock(periodKey, expense.projectId);
      if (fromLock) {
        return reply.status(400).send({
          error: { code: 'PERIOD_LOCKED', message: 'Period is locked' },
        });
      }
      if (body.toProjectId !== expense.projectId) {
        const toLock = await findPeriodLock(periodKey, body.toProjectId);
        if (toLock) {
          return reply.status(400).send({
            error: { code: 'PERIOD_LOCKED', message: 'Period is locked' },
          });
        }
      }
      const updated = await prisma.expense.update({
        where: { id },
        data: { projectId: body.toProjectId },
      });
      await logAudit({
        action: 'reassignment',
        targetTable: 'expenses',
        targetId: id,
        reasonCode: body.reasonCode,
        reasonText,
        metadata: {
          fromProjectId: expense.projectId,
          toProjectId: body.toProjectId,
        },
        ...auditContextFromRequest(req),
      });
      await logReassignment({
        targetTable: 'expenses',
        targetId: id,
        fromProjectId: expense.projectId,
        toProjectId: body.toProjectId,
        reasonCode: body.reasonCode,
        reasonText,
        createdBy: req.user?.userId,
      });
      return updated;
    },
  );
}
