import { FastifyInstance } from 'fastify';
import {
  ExpenseQaStageRequiredError,
  submitApprovalWithUpdate,
} from '../services/approval.js';
import {
  createApprovalPendingNotifications,
  createExpenseMarkPaidNotification,
} from '../services/appNotifications.js';
import {
  expenseBudgetEscalationSchema,
  expenseCommentCreateSchema,
  expenseListQuerySchema,
  expenseMarkPaidSchema,
  expenseQaChecklistPatchSchema,
  expenseReassignSchema,
  expenseSchema,
  expenseUnmarkPaidSchema,
} from './validators.js';
import { DocStatusValue, FlowTypeValue } from '../types.js';
import {
  hasProjectAccess,
  requireProjectAccess,
  requireRole,
} from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { logReassignment } from '../services/reassignmentLog.js';
import { parseDateParam } from '../utils/date.js';
import { findPeriodLock, toPeriodKey } from '../services/periodLock.js';
import { evaluateActionPolicyWithFallback } from '../services/actionPolicy.js';
import { logActionPolicyOverrideIfNeeded } from '../services/actionPolicyAudit.js';
import { logExpenseStateTransition } from '../services/expenseStateTransitionLog.js';
import {
  isExpenseQaChecklistComplete,
  normalizeExpenseQaChecklist,
} from '../services/expenseQaChecklist.js';
import {
  evaluateExpenseBudget,
  hasExpenseBudgetEscalationFields,
  missingExpenseBudgetEscalationFields,
} from '../services/expenseBudget.js';

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

type ExpenseCreateDraftResult =
  | {
      ok: true;
      declaredAmount: number;
      lines: ExpenseLineDraft[];
      attachments: ExpenseAttachmentDraft[];
      sanitizedBody: Record<string, unknown>;
    }
  | {
      ok: false;
      statusCode: number;
      error: { code: string; message: string };
    };

type ExpenseSubmitEvidenceInput = {
  receiptUrl: string | null;
  attachmentCount: number;
};

type ExpenseBudgetEscalationInput = {
  budgetEscalationReason?: string | null;
  budgetEscalationImpact?: string | null;
  budgetEscalationAlternative?: string | null;
};

type ExpenseQaChecklistRecord = {
  id: string;
  expenseId: string;
  amountVerified: boolean;
  receiptVerified: boolean;
  journalPrepared: boolean;
  projectLinked: boolean;
  budgetChecked: boolean;
  notes: string | null;
  completedAt: Date | null;
  completedBy: string | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
};

function toExpenseQaChecklistResponse(
  expenseId: string,
  checklist: Partial<ExpenseQaChecklistRecord> | null | undefined,
) {
  const normalized = normalizeExpenseQaChecklist(checklist);
  return {
    expenseId,
    ...normalized,
    notes:
      checklist && typeof checklist.notes === 'string' ? checklist.notes : null,
    isComplete: isExpenseQaChecklistComplete(normalized),
    completedAt: checklist?.completedAt?.toISOString() ?? null,
    completedBy: checklist?.completedBy ?? null,
    createdAt: checklist?.createdAt?.toISOString() ?? null,
    createdBy: checklist?.createdBy ?? null,
    updatedAt: checklist?.updatedAt?.toISOString() ?? null,
    updatedBy: checklist?.updatedBy ?? null,
  };
}

function normalizeOptionalTrimmedValue(
  value: unknown,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export function buildExpenseCreateDraft(input: {
  body: Record<string, unknown>;
  actorUserId: string | null;
}): ExpenseCreateDraftResult {
  const { body, actorUserId } = input;
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const rawAttachments = Array.isArray(body.attachments)
    ? body.attachments
    : [];
  const declaredAmount = Number(body.amount);
  if (!Number.isFinite(declaredAmount) || declaredAmount < 0) {
    return {
      ok: false,
      statusCode: 400,
      error: {
        code: 'INVALID_AMOUNT',
        message: 'amount is invalid',
      },
    };
  }

  const seenLineNos = new Set<number>();
  const lines: ExpenseLineDraft[] = [];
  let linesTotal = 0;
  for (const [index, line] of rawLines.entries()) {
    const lineNo = Number((line as any)?.lineNo);
    if (!Number.isInteger(lineNo) || lineNo < 1) {
      return {
        ok: false,
        statusCode: 400,
        error: {
          code: 'INVALID_LINE',
          message: `lines[${index}].lineNo must be >= 1`,
        },
      };
    }
    if (seenLineNos.has(lineNo)) {
      return {
        ok: false,
        statusCode: 400,
        error: {
          code: 'INVALID_LINE',
          message: `lines[${index}].lineNo is duplicated`,
        },
      };
    }
    seenLineNos.add(lineNo);
    const expenseDate = (line as any)?.expenseDate
      ? parseDateParam(String((line as any).expenseDate))
      : null;
    if ((line as any)?.expenseDate && !expenseDate) {
      return {
        ok: false,
        statusCode: 400,
        error: {
          code: 'INVALID_LINE',
          message: `lines[${index}].expenseDate is invalid`,
        },
      };
    }
    const amount = Number((line as any)?.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return {
        ok: false,
        statusCode: 400,
        error: {
          code: 'INVALID_LINE',
          message: `lines[${index}].amount is invalid`,
        },
      };
    }
    const taxRate =
      (line as any)?.taxRate === undefined || (line as any)?.taxRate === null
        ? null
        : Number((line as any).taxRate);
    if (taxRate !== null && (!Number.isFinite(taxRate) || taxRate < 0)) {
      return {
        ok: false,
        statusCode: 400,
        error: {
          code: 'INVALID_LINE',
          message: `lines[${index}].taxRate is invalid`,
        },
      };
    }
    const taxAmount =
      (line as any)?.taxAmount === undefined ||
      (line as any)?.taxAmount === null
        ? null
        : Number((line as any).taxAmount);
    if (taxAmount !== null && (!Number.isFinite(taxAmount) || taxAmount < 0)) {
      return {
        ok: false,
        statusCode: 400,
        error: {
          code: 'INVALID_LINE',
          message: `lines[${index}].taxAmount is invalid`,
        },
      };
    }
    linesTotal += amount;
    lines.push({
      lineNo,
      expenseDate,
      category: (line as any)?.category ?? null,
      description: String((line as any)?.description ?? ''),
      amount,
      taxRate,
      taxAmount,
      currency: (line as any)?.currency || String(body.currency || 'JPY'),
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });
  }
  if (lines.length > 0 && Math.abs(linesTotal - declaredAmount) > 0.01) {
    return {
      ok: false,
      statusCode: 400,
      error: {
        code: 'INVALID_AMOUNT',
        message: 'sum(lines.amount) must match amount',
      },
    };
  }

  const attachments: ExpenseAttachmentDraft[] = [];
  for (const [index, attachment] of rawAttachments.entries()) {
    const value =
      attachment && typeof attachment === 'object'
        ? (attachment as Record<string, unknown>)
        : {};
    const fileUrl =
      typeof value.fileUrl === 'string' ? value.fileUrl.trim() : '';
    if (!fileUrl) {
      return {
        ok: false,
        statusCode: 400,
        error: {
          code: 'INVALID_ATTACHMENT',
          message: `attachments[${index}].fileUrl is required`,
        },
      };
    }
    attachments.push({
      fileUrl,
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
    });
  }

  const {
    lines: _ignoredLines,
    attachments: _ignoredAttachments,
    ...raw
  } = body;
  if (typeof raw.receiptUrl === 'string') {
    const normalizedReceiptUrl = raw.receiptUrl.trim();
    raw.receiptUrl = normalizedReceiptUrl || null;
  }
  return {
    ok: true,
    declaredAmount,
    lines,
    attachments,
    sanitizedBody: raw,
  };
}

export function hasExpenseSubmitEvidence(
  input: ExpenseSubmitEvidenceInput,
): boolean {
  const hasReceiptUrl =
    typeof input.receiptUrl === 'string' && input.receiptUrl.trim().length > 0;
  if (hasReceiptUrl) return true;
  return Number.isFinite(input.attachmentCount) && input.attachmentCount > 0;
}

export function applyExpenseHasReceiptFilter(
  where: Record<string, unknown>,
  hasReceipt: boolean,
): void {
  const andConditions = Array.isArray(where.AND) ? where.AND : [];
  if (hasReceipt) {
    where.AND = [
      ...andConditions,
      {
        OR: [
          {
            AND: [{ receiptUrl: { not: null } }, { receiptUrl: { not: '' } }],
          },
          { attachments: { some: {} } },
        ],
      },
    ];
    return;
  }
  where.AND = [
    ...andConditions,
    { OR: [{ receiptUrl: null }, { receiptUrl: '' }] },
    { attachments: { none: {} } },
  ];
}

export async function registerExpenseRoutes(app: FastifyInstance) {
  const parseDate = (value?: string) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  };
  const parseBooleanQuery = (
    value: string | boolean | undefined,
  ): boolean | null | undefined => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    return null;
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
      const actorUserId = req.user?.userId || null;
      const createDraft = buildExpenseCreateDraft({ body, actorUserId });
      if (!createDraft.ok) {
        return reply.status(createDraft.statusCode).send({
          error: createDraft.error,
        });
      }
      const { lines, attachments, sanitizedBody } = createDraft;
      const expense = await prisma.$transaction(async (tx) => {
        const created = await tx.expense.create({
          data: { ...(sanitizedBody as any), incurredOn },
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
      await logExpenseStateTransition({
        client: prisma,
        expenseId: expense.id,
        from: { status: null, settlementStatus: null },
        to: {
          status: expense.status,
          settlementStatus: expense.settlementStatus,
        },
        actorUserId: req.user?.userId || null,
        metadata: { trigger: 'create' },
      });
      return expense;
    },
  );

  app.get(
    '/expenses',
    {
      schema: expenseListQuerySchema,
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        requireProjectAccess((req) => (req.query as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const {
        projectId,
        userId,
        from,
        to,
        status,
        settlementStatus,
        paidFrom,
        paidTo,
        hasReceipt,
      } = req.query as {
        projectId?: string;
        userId?: string;
        from?: string;
        to?: string;
        status?: string;
        settlementStatus?: 'paid' | 'unpaid';
        paidFrom?: string;
        paidTo?: string;
        hasReceipt?: string | boolean;
      };
      const roles = req.user?.roles || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      const currentUserId = req.user?.userId;
      const projectIds = req.user?.projectIds || [];
      const fromDate = from ? parseDate(from) : null;
      const toDate = to ? parseDate(to) : null;
      const paidFromDate = paidFrom ? parseDate(paidFrom) : null;
      const paidToDate = paidTo ? parseDate(paidTo) : null;
      const hasReceiptValue = parseBooleanQuery(hasReceipt);
      if ((from && !fromDate) || (to && !toDate)) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'from/to is invalid' },
        });
      }
      if ((paidFrom && !paidFromDate) || (paidTo && !paidToDate)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE',
            message: 'paidFrom/paidTo is invalid',
          },
        });
      }
      if (hasReceiptValue === null) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_BOOLEAN',
            message: 'hasReceipt must be true/false/1/0',
          },
        });
      }
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
      if (fromDate || toDate) {
        where.incurredOn = {};
        if (fromDate) where.incurredOn.gte = fromDate;
        if (toDate) where.incurredOn.lte = toDate;
      }
      if (status) {
        where.status = status;
      }
      if (settlementStatus) {
        where.settlementStatus = settlementStatus;
      }
      if (paidFromDate || paidToDate) {
        where.paidAt = {};
        if (paidFromDate) where.paidAt.gte = paidFromDate;
        if (paidToDate) {
          const paidToExclusive = new Date(paidToDate);
          paidToExclusive.setDate(paidToExclusive.getDate() + 1);
          where.paidAt.lt = paidToExclusive;
        }
      }
      if (hasReceiptValue !== undefined) {
        applyExpenseHasReceiptFilter(where, hasReceiptValue);
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
      if (!isPrivileged) {
        if (expense.userId !== req.user?.userId) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (
          !hasProjectAccess(
            roles,
            req.user?.projectIds || [],
            expense.projectId,
          )
        ) {
          return reply.code(403).send({ error: 'forbidden_project' });
        }
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
      if (!isPrivileged) {
        if (expense.userId !== req.user?.userId) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (
          !hasProjectAccess(
            roles,
            req.user?.projectIds || [],
            expense.projectId,
          )
        ) {
          return reply.code(403).send({ error: 'forbidden_project' });
        }
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
  app.get(
    '/expenses/:id/qa-checklist',
    { preHandler: requireRole(['admin', 'mgmt', 'user']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const expense = await prisma.expense.findUnique({
        where: { id },
        select: { id: true, userId: true, projectId: true, deletedAt: true },
      });
      if (!expense || expense.deletedAt) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const roles = req.user?.roles || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      if (!isPrivileged) {
        if (expense.userId !== req.user?.userId) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (
          !hasProjectAccess(
            roles,
            req.user?.projectIds || [],
            expense.projectId,
          )
        ) {
          return reply.code(403).send({ error: 'forbidden_project' });
        }
      }
      const checklist = await prisma.expenseQaChecklist.findUnique({
        where: { expenseId: id },
      });
      return toExpenseQaChecklistResponse(id, checklist);
    },
  );

  app.put(
    '/expenses/:id/qa-checklist',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: expenseQaChecklistPatchSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        amountVerified?: boolean;
        receiptVerified?: boolean;
        journalPrepared?: boolean;
        projectLinked?: boolean;
        budgetChecked?: boolean;
        notes?: string | null;
      };
      const expense = await prisma.expense.findUnique({
        where: { id },
        select: { id: true, deletedAt: true },
      });
      if (!expense || expense.deletedAt) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const actorUserId = req.user?.userId || null;
      const current = await prisma.expenseQaChecklist.findUnique({
        where: { expenseId: id },
      });
      const merged = {
        amountVerified: body.amountVerified ?? current?.amountVerified ?? false,
        receiptVerified:
          body.receiptVerified ?? current?.receiptVerified ?? false,
        journalPrepared:
          body.journalPrepared ?? current?.journalPrepared ?? false,
        projectLinked: body.projectLinked ?? current?.projectLinked ?? false,
        budgetChecked: body.budgetChecked ?? current?.budgetChecked ?? false,
      };
      const isComplete = isExpenseQaChecklistComplete(merged);
      const notesProvided = Object.prototype.hasOwnProperty.call(body, 'notes');
      const rawNotes =
        notesProvided && typeof body.notes === 'string'
          ? body.notes.trim()
          : '';
      const nextNotes = notesProvided
        ? rawNotes || null
        : (current?.notes ?? null);
      const nextCompletedAt = isComplete
        ? (current?.completedAt ?? new Date())
        : null;
      const nextCompletedBy = isComplete
        ? (current?.completedBy ?? actorUserId)
        : null;
      const saved = await prisma.expenseQaChecklist.upsert({
        where: { expenseId: id },
        create: {
          expenseId: id,
          ...merged,
          notes: nextNotes,
          completedAt: nextCompletedAt,
          completedBy: nextCompletedBy,
          createdBy: actorUserId,
          updatedBy: actorUserId,
        },
        update: {
          ...merged,
          notes: nextNotes,
          completedAt: nextCompletedAt,
          completedBy: nextCompletedBy,
          updatedBy: actorUserId,
        },
      });
      await logAudit({
        ...auditContextFromRequest(req),
        action: 'expense_qa_checklist_upsert',
        targetTable: 'ExpenseQaChecklist',
        targetId: saved.id,
        metadata: {
          expenseId: id,
          isComplete,
          checklist: merged,
          notesUpdated: notesProvided,
        },
      });
      return toExpenseQaChecklistResponse(id, saved);
    },
  );

  app.put(
    '/expenses/:id/budget-escalation',
    {
      preHandler: requireRole(['admin', 'mgmt', 'user']),
      schema: expenseBudgetEscalationSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as ExpenseBudgetEscalationInput;
      const expense = await prisma.expense.findUnique({
        where: { id },
      });
      if (!expense || expense.deletedAt) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const roles = req.user?.roles || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      if (!isPrivileged) {
        if (expense.userId !== req.user?.userId) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (
          !hasProjectAccess(
            roles,
            req.user?.projectIds || [],
            expense.projectId,
          )
        ) {
          return reply.code(403).send({ error: 'forbidden_project' });
        }
      }
      if (
        expense.status === DocStatusValue.approved ||
        expense.status === DocStatusValue.rejected
      ) {
        return reply.code(409).send({
          error: {
            code: 'EXPENSE_CLOSED',
            message: 'Budget escalation cannot be updated after close',
          },
        });
      }
      const budgetEscalationReason = normalizeOptionalTrimmedValue(
        body.budgetEscalationReason,
      );
      const budgetEscalationImpact = normalizeOptionalTrimmedValue(
        body.budgetEscalationImpact,
      );
      const budgetEscalationAlternative = normalizeOptionalTrimmedValue(
        body.budgetEscalationAlternative,
      );
      const updateData: Record<string, unknown> = {};
      if (budgetEscalationReason !== undefined) {
        updateData.budgetEscalationReason = budgetEscalationReason;
      }
      if (budgetEscalationImpact !== undefined) {
        updateData.budgetEscalationImpact = budgetEscalationImpact;
      }
      if (budgetEscalationAlternative !== undefined) {
        updateData.budgetEscalationAlternative = budgetEscalationAlternative;
      }
      updateData.budgetEscalationUpdatedAt = new Date();
      updateData.updatedBy = req.user?.userId || null;

      const patched = {
        ...expense,
        ...(budgetEscalationReason !== undefined
          ? { budgetEscalationReason }
          : {}),
        ...(budgetEscalationImpact !== undefined
          ? { budgetEscalationImpact }
          : {}),
        ...(budgetEscalationAlternative !== undefined
          ? { budgetEscalationAlternative }
          : {}),
      };
      const evaluation = await evaluateExpenseBudget({
        client: prisma,
        expense: patched,
      });
      updateData.budgetSnapshot = evaluation.snapshot as unknown as object;
      updateData.budgetOverrunAmount = evaluation.requiresEscalation
        ? evaluation.snapshot.overrunAmount
        : null;

      const updated = await prisma.expense.update({
        where: { id },
        data: updateData as any,
      });
      await logAudit({
        ...auditContextFromRequest(req),
        action: 'expense_budget_escalation_update',
        targetTable: 'Expense',
        targetId: id,
        metadata: {
          requiresEscalation: evaluation.requiresEscalation,
          overrunAmount: evaluation.snapshot.overrunAmount,
          hasEscalation: hasExpenseBudgetEscalationFields(updated as any),
        },
      });
      return {
        expenseId: id,
        budgetSnapshot: updated.budgetSnapshot ?? null,
        budgetOverrunAmount:
          updated.budgetOverrunAmount == null
            ? null
            : Number(updated.budgetOverrunAmount),
        budgetEscalationReason: updated.budgetEscalationReason ?? null,
        budgetEscalationImpact: updated.budgetEscalationImpact ?? null,
        budgetEscalationAlternative:
          updated.budgetEscalationAlternative ?? null,
        budgetEscalationUpdatedAt:
          updated.budgetEscalationUpdatedAt?.toISOString() ?? null,
      };
    },
  );

  app.get(
    '/expenses/:id/state-transitions',
    { preHandler: requireRole(['admin', 'mgmt', 'user']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { limit } = req.query as { limit?: number };
      const expense = await prisma.expense.findUnique({
        where: { id },
        select: { id: true, userId: true },
      });
      if (!expense) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const roles = req.user?.roles || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      if (!isPrivileged && expense.userId !== req.user?.userId) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const cappedLimit = Math.min(Math.max(Number(limit || 100), 1), 500);
      const items = await prisma.expenseStateTransitionLog.findMany({
        where: { expenseId: id },
        orderBy: { createdAt: 'desc' },
        take: cappedLimit,
      });
      return { items };
    },
  );
  app.post(
    '/expenses/:id/submit',
    {
      preHandler: requireRole(['admin', 'mgmt', 'user']),
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      const reasonText =
        typeof body?.reasonText === 'string' ? body.reasonText.trim() : '';
      const expense = await prisma.expense.findUnique({ where: { id } });
      if (!expense) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (expense.deletedAt) {
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
      const hasReceiptEvidence = hasExpenseSubmitEvidence({
        receiptUrl: expense.receiptUrl,
        attachmentCount: 0,
      });
      if (!hasReceiptEvidence) {
        const attachmentCount = await prisma.expenseAttachment.count({
          where: { expenseId: id },
        });
        if (
          !hasExpenseSubmitEvidence({
            receiptUrl: expense.receiptUrl,
            attachmentCount,
          })
        ) {
          return reply.status(400).send({
            error: {
              code: 'RECEIPT_REQUIRED',
              message: 'At least one expense receipt is required',
            },
          });
        }
      }
      const budgetEscalationReason = normalizeOptionalTrimmedValue(
        body?.budgetEscalationReason,
      );
      const budgetEscalationImpact = normalizeOptionalTrimmedValue(
        body?.budgetEscalationImpact,
      );
      const budgetEscalationAlternative = normalizeOptionalTrimmedValue(
        body?.budgetEscalationAlternative,
      );
      const effectiveExpense = {
        ...expense,
        ...(budgetEscalationReason !== undefined
          ? { budgetEscalationReason }
          : {}),
        ...(budgetEscalationImpact !== undefined
          ? { budgetEscalationImpact }
          : {}),
        ...(budgetEscalationAlternative !== undefined
          ? { budgetEscalationAlternative }
          : {}),
      };
      const budgetEvaluation = await evaluateExpenseBudget({
        client: prisma,
        expense: effectiveExpense,
      });
      if (
        budgetEvaluation.requiresEscalation &&
        !hasExpenseBudgetEscalationFields(effectiveExpense)
      ) {
        return reply.status(400).send({
          error: {
            code: 'BUDGET_ESCALATION_REQUIRED',
            message:
              'budget escalation details are required when projected expense exceeds budget',
            details: {
              overrunAmount: budgetEvaluation.snapshot.overrunAmount,
              budgetCost: budgetEvaluation.snapshot.budgetCost,
              projectedAmount: budgetEvaluation.snapshot.projectedAmount,
              periodKey: budgetEvaluation.snapshot.periodKey,
              missingFields:
                missingExpenseBudgetEscalationFields(effectiveExpense),
            },
          },
        });
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
      const submitUpdateData: Record<string, unknown> = {
        status: DocStatusValue.pending_qa,
        budgetSnapshot: budgetEvaluation.snapshot as unknown as object,
        budgetOverrunAmount: budgetEvaluation.requiresEscalation
          ? budgetEvaluation.snapshot.overrunAmount
          : null,
      };
      if (budgetEscalationReason !== undefined) {
        submitUpdateData.budgetEscalationReason = budgetEscalationReason;
      }
      if (budgetEscalationImpact !== undefined) {
        submitUpdateData.budgetEscalationImpact = budgetEscalationImpact;
      }
      if (budgetEscalationAlternative !== undefined) {
        submitUpdateData.budgetEscalationAlternative =
          budgetEscalationAlternative;
      }
      if (
        budgetEscalationReason !== undefined ||
        budgetEscalationImpact !== undefined ||
        budgetEscalationAlternative !== undefined
      ) {
        submitUpdateData.budgetEscalationUpdatedAt = new Date();
      }
      const actorUserId = req.user?.userId || 'system';
      let submitResult: Awaited<ReturnType<typeof submitApprovalWithUpdate>>;
      try {
        submitResult = await submitApprovalWithUpdate({
          flowType: FlowTypeValue.expense,
          targetTable: 'expenses',
          targetId: id,
          update: (tx) =>
            tx.expense.update({
              where: { id },
              data: submitUpdateData as any,
            }),
          createdBy: userId,
        });
      } catch (error) {
        if (error instanceof ExpenseQaStageRequiredError) {
          return reply.status(409).send({
            error: {
              code: 'EXPENSE_QA_STAGE_REQUIRED',
              message:
                'expense approval rule must include a non-exec stage before exec stage',
            },
          });
        }
        throw error;
      }
      const { updated, approval } = submitResult;
      await logExpenseStateTransition({
        client: prisma,
        expenseId: id,
        from: {
          status: expense.status,
          settlementStatus: expense.settlementStatus,
        },
        to: {
          status: updated.status,
          settlementStatus: updated.settlementStatus,
        },
        actorUserId: actorUserId,
        reasonText: reasonText || null,
        metadata: {
          trigger: 'submit',
          approvalInstanceId: approval.id,
        },
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
      await logExpenseStateTransition({
        client: prisma,
        expenseId: id,
        from: {
          status: expense.status,
          settlementStatus: expense.settlementStatus,
        },
        to: {
          status: updated.status,
          settlementStatus: updated.settlementStatus,
        },
        actorUserId: actorId,
        reasonText: reasonText || null,
        metadata: {
          trigger: 'mark_paid',
          paidAt: updated.paidAt?.toISOString() ?? null,
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
      await logExpenseStateTransition({
        client: prisma,
        expenseId: id,
        from: {
          status: expense.status,
          settlementStatus: expense.settlementStatus,
        },
        to: {
          status: updated.status,
          settlementStatus: updated.settlementStatus,
        },
        actorUserId: actorId,
        reasonText,
        metadata: { trigger: 'unmark_paid' },
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
