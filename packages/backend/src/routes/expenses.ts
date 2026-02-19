import { FastifyInstance } from 'fastify';
import { submitApprovalWithUpdate } from '../services/approval.js';
import {
  createApprovalPendingNotifications,
  createExpenseMarkPaidNotification,
} from '../services/appNotifications.js';
import {
  expenseCommentCreateSchema,
  expenseMarkPaidSchema,
  expenseReassignSchema,
  expenseSchema,
  expenseUnmarkPaidSchema,
} from './validators.js';
import { DocStatusValue, FlowTypeValue } from '../types.js';
import { requireProjectAccess, requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { logReassignment } from '../services/reassignmentLog.js';
import { parseDateParam } from '../utils/date.js';
import { findPeriodLock, toPeriodKey } from '../services/periodLock.js';
import { evaluateActionPolicyWithFallback } from '../services/actionPolicy.js';
import { logActionPolicyOverrideIfNeeded } from '../services/actionPolicyAudit.js';

export async function registerExpenseRoutes(app: FastifyInstance) {
  const parseDate = (value?: string) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  };

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
      type ExpenseLineDraft = {
        lineNo: number;
        expenseDate: Date | null;
        category: string | null;
        description: string;
        amount: number;
        taxRate: number | null;
        taxAmount: number | null;
        currency: string;
        createdBy: string | null;
        updatedBy: string | null;
      };
      type ExpenseAttachmentDraft = {
        fileUrl: string;
        fileName: string | null;
        contentType: string | null;
        fileSizeBytes: number | null;
        fileHash: string | null;
        createdBy: string | null;
        updatedBy: string | null;
      };
      const actorUserId = req.user?.userId || null;
      const rawLines = Array.isArray(body.lines) ? body.lines : [];
      const rawAttachments = Array.isArray(body.attachments)
        ? body.attachments
        : [];
      const seenLineNos = new Set<number>();
      const lines: ExpenseLineDraft[] = [];
      let linesTotal = 0;
      for (const [index, line] of rawLines.entries()) {
        const lineNo = Number(line?.lineNo);
        if (!Number.isInteger(lineNo) || lineNo < 1) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_LINE',
              message: `lines[${index}].lineNo must be >= 1`,
            },
          });
        }
        if (seenLineNos.has(lineNo)) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_LINE',
              message: `lines[${index}].lineNo is duplicated`,
            },
          });
        }
        seenLineNos.add(lineNo);
        const expenseDate = line?.expenseDate
          ? parseDateParam(String(line.expenseDate))
          : null;
        if (line?.expenseDate && !expenseDate) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_LINE',
              message: `lines[${index}].expenseDate is invalid`,
            },
          });
        }
        const amount = Number(line?.amount);
        if (!Number.isFinite(amount) || amount < 0) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_LINE',
              message: `lines[${index}].amount is invalid`,
            },
          });
        }
        const taxRate =
          line?.taxRate === undefined || line?.taxRate === null
            ? null
            : Number(line.taxRate);
        if (taxRate !== null && (!Number.isFinite(taxRate) || taxRate < 0)) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_LINE',
              message: `lines[${index}].taxRate is invalid`,
            },
          });
        }
        const taxAmount =
          line?.taxAmount === undefined || line?.taxAmount === null
            ? null
            : Number(line.taxAmount);
        if (
          taxAmount !== null &&
          (!Number.isFinite(taxAmount) || taxAmount < 0)
        ) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_LINE',
              message: `lines[${index}].taxAmount is invalid`,
            },
          });
        }
        linesTotal += amount;
        lines.push({
          lineNo,
          expenseDate,
          category: line?.category ?? null,
          description: String(line?.description ?? ''),
          amount,
          taxRate,
          taxAmount,
          currency: line?.currency || body.currency,
          createdBy: actorUserId,
          updatedBy: actorUserId,
        });
      }
      if (lines.length > 0) {
        const declaredAmount = Number(body.amount);
        if (!Number.isFinite(declaredAmount) || declaredAmount < 0) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_AMOUNT',
              message: 'amount is invalid',
            },
          });
        }
        if (Math.abs(linesTotal - declaredAmount) > 0.01) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_AMOUNT',
              message: 'sum(lines.amount) must match amount',
            },
          });
        }
      }
      const attachments: ExpenseAttachmentDraft[] = rawAttachments.map(
        (attachment: unknown) => {
          const value =
            attachment && typeof attachment === 'object'
              ? (attachment as Record<string, unknown>)
              : {};
          return {
            fileUrl: String(value.fileUrl ?? ''),
            fileName:
              value.fileName === undefined || value.fileName === null
                ? null
                : String(value.fileName),
            contentType:
              value.contentType === undefined || value.contentType === null
                ? null
                : String(value.contentType),
            fileSizeBytes:
              value.fileSizeBytes === undefined || value.fileSizeBytes === null
                ? null
                : Number(value.fileSizeBytes),
            fileHash:
              value.fileHash === undefined || value.fileHash === null
                ? null
                : String(value.fileHash),
            createdBy: actorUserId,
            updatedBy: actorUserId,
          };
        },
      );
      const expense = await prisma.$transaction(async (tx) => {
        const {
          lines: _ignoredLines,
          attachments: _ignoredAttachments,
          ...raw
        } = body;
        const created = await tx.expense.create({
          data: { ...raw, incurredOn },
        });
        if (lines.length > 0) {
          await tx.expenseLine.createMany({
            data: lines.map((line) => ({
              ...line,
              expenseId: created.id,
            })),
          });
        }
        if (attachments.length > 0) {
          await tx.expenseAttachment.createMany({
            data: attachments.map((attachment) => ({
              ...attachment,
              expenseId: created.id,
            })),
          });
        }
        return created;
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

  app.get(
    '/expenses/:id',
    { preHandler: requireRole(['admin', 'mgmt', 'user']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const expense = await prisma.expense.findUnique({
        where: { id },
        include: {
          lines: { orderBy: { lineNo: 'asc' } },
          attachments: { orderBy: { createdAt: 'asc' } },
          comments: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (!expense) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const roles = req.user?.roles || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      if (!isPrivileged && expense.userId !== req.user?.userId) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      return expense;
    },
  );

  app.post(
    '/expenses/:id/comments',
    {
      preHandler: requireRole(['admin', 'mgmt', 'user']),
      schema: expenseCommentCreateSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { kind?: string; body: string };
      const expense = await prisma.expense.findUnique({ where: { id } });
      if (!expense) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const roles = req.user?.roles || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      if (!isPrivileged && expense.userId !== req.user?.userId) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const actorUserId = req.user?.userId || null;
      const created = await prisma.expenseComment.create({
        data: {
          expenseId: id,
          kind: body.kind?.trim() || 'general',
          body: body.body.trim(),
          createdBy: actorUserId,
          updatedBy: actorUserId,
        },
      });
      await logAudit({
        ...auditContextFromRequest(req),
        action: 'expense_comment_add',
        targetTable: 'ExpenseComment',
        targetId: created.id,
        metadata: { expenseId: id, kind: created.kind },
      });
      return created;
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
          groupAccountIds: req.user?.groupAccountIds || [],
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
      await logActionPolicyOverrideIfNeeded({
        req,
        flowType: FlowTypeValue.expense,
        actionKey: 'submit',
        targetTable: 'expenses',
        targetId: id,
        reasonText,
        result: policyRes,
      });
      const actorUserId = req.user?.userId || 'system';
      const { updated, approval } = await submitApprovalWithUpdate({
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

  app.post(
    '/expenses/:id/mark-paid',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: expenseMarkPaidSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { paidAt?: string; reasonText?: string };
      const paidAt = body?.paidAt ? parseDate(body.paidAt) : new Date();
      const reasonText =
        typeof body?.reasonText === 'string' ? body.reasonText.trim() : '';
      if (body?.paidAt && !paidAt) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'paidAt is invalid' },
        });
      }

      const expense = await prisma.expense.findUnique({ where: { id } });
      if (!expense || expense.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Expense not found' },
        });
      }

      const policyRes = await evaluateActionPolicyWithFallback({
        flowType: FlowTypeValue.expense,
        actionKey: 'mark_paid',
        actor: {
          userId: req.user?.userId ?? null,
          roles: req.user?.roles || [],
          groupIds: req.user?.groupIds || [],
          groupAccountIds: req.user?.groupAccountIds || [],
        },
        reasonText,
        state: {
          status: expense.status,
          projectId: expense.projectId,
          settlementStatus: expense.settlementStatus,
        },
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
            message: 'Expense cannot be marked as paid',
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
        flowType: FlowTypeValue.expense,
        actionKey: 'mark_paid',
        targetTable: 'expenses',
        targetId: id,
        reasonText,
        result: policyRes,
      });

      if (expense.status !== DocStatusValue.approved) {
        return reply.status(409).send({
          error: {
            code: 'INVALID_STATUS',
            message: 'Expense must be approved to mark as paid',
          },
        });
      }
      if (expense.settlementStatus === 'paid') {
        return reply.status(409).send({
          error: {
            code: 'ALREADY_PAID',
            message: 'Expense is already marked as paid',
          },
        });
      }

      const actorId = req.user?.userId || 'system';
      const updated = await prisma.expense.update({
        where: { id },
        data: {
          settlementStatus: 'paid',
          paidAt,
          paidBy: actorId,
          updatedBy: actorId,
        },
      });

      await createExpenseMarkPaidNotification({
        expenseId: id,
        userId: expense.userId,
        projectId: expense.projectId,
        amount: expense.amount?.toString(),
        currency: expense.currency,
        paidAt: updated.paidAt ?? paidAt,
        actorUserId: actorId,
      });

      await logAudit({
        ...auditContextFromRequest(req),
        action: 'expense_mark_paid',
        targetTable: 'Expense',
        targetId: id,
        reasonText: reasonText || undefined,
        metadata: {
          previousStatus: expense.status,
          paidAt: updated.paidAt?.toISOString() ?? null,
          paidBy: updated.paidBy ?? null,
          amount: expense.amount?.toString(),
          currency: expense.currency,
        },
      });

      return updated;
    },
  );

  app.post(
    '/expenses/:id/unmark-paid',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: expenseUnmarkPaidSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { reasonText?: string };
      const reasonText =
        typeof body?.reasonText === 'string' ? body.reasonText.trim() : '';
      if (!reasonText) {
        return reply.status(400).send({
          error: { code: 'INVALID_REASON', message: 'reasonText is required' },
        });
      }

      const expense = await prisma.expense.findUnique({ where: { id } });
      if (!expense || expense.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Expense not found' },
        });
      }

      const policyRes = await evaluateActionPolicyWithFallback({
        flowType: FlowTypeValue.expense,
        actionKey: 'unmark_paid',
        actor: {
          userId: req.user?.userId ?? null,
          roles: req.user?.roles || [],
          groupIds: req.user?.groupIds || [],
          groupAccountIds: req.user?.groupAccountIds || [],
        },
        reasonText,
        state: {
          status: expense.status,
          projectId: expense.projectId,
          settlementStatus: expense.settlementStatus,
        },
        targetTable: 'expenses',
        targetId: id,
      });
      if (policyRes.policyApplied && !policyRes.allowed) {
        return reply.status(403).send({
          error: {
            code: 'ACTION_POLICY_DENIED',
            message: 'Expense cannot be unmarked as paid',
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
        flowType: FlowTypeValue.expense,
        actionKey: 'unmark_paid',
        targetTable: 'expenses',
        targetId: id,
        reasonText,
        result: policyRes,
      });

      if (expense.settlementStatus !== 'paid') {
        return reply.status(409).send({
          error: {
            code: 'INVALID_STATUS',
            message: 'Expense is not marked as paid',
          },
        });
      }

      const actorId = req.user?.userId || 'system';
      const updated = await prisma.expense.update({
        where: { id },
        data: {
          settlementStatus: 'unpaid',
          paidAt: null,
          paidBy: null,
          updatedBy: actorId,
        },
      });

      await logAudit({
        ...auditContextFromRequest(req),
        action: 'expense_unmark_paid',
        targetTable: 'Expense',
        targetId: id,
        reasonText,
        metadata: {
          previousPaidAt: expense.paidAt?.toISOString() ?? null,
          previousPaidBy: expense.paidBy ?? null,
          amount: expense.amount?.toString(),
          currency: expense.currency,
        },
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
