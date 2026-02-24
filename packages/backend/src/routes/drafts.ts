import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import {
  draftDiffSchema,
  draftGenerateSchema,
  draftRegenerateSchema,
} from './validators.js';

type DraftKind = 'invoice_send' | 'approval_request' | 'notification_report';

type DraftText = {
  subject: string;
  body: string;
};

type DraftGenerateBody = {
  kind: DraftKind;
  targetId?: string;
  context?: Record<string, unknown> | null;
  instruction?: string;
};

type DraftContent = DraftText & {
  kind: DraftKind;
  metadata: Record<string, unknown>;
};

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringifyScalar(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null) {
    const toString =
      typeof (value as { toString?: () => string }).toString === 'function'
        ? (value as { toString: () => string }).toString()
        : '';
    return toString === '[object Object]' ? '' : toString;
  }
  return '';
}

function formatDate(value: Date | null | undefined) {
  if (!(value instanceof Date)) return null;
  return value.toISOString().slice(0, 10);
}

function appendInstruction(body: string, instruction: string) {
  const normalized = normalizeText(instruction);
  if (!normalized) return body;
  return `${body}\n\n補足指示:\n- ${normalized}`;
}

function createDraftDiff(before: DraftText, after: DraftText) {
  const fields: Array<keyof DraftText> = ['subject', 'body'];
  const changes = fields
    .filter((field) => before[field] !== after[field])
    .map((field) => ({
      field,
      before: before[field],
      after: after[field],
      beforeMissing: normalizeText(before[field]).length === 0,
      afterMissing: normalizeText(after[field]).length === 0,
    }));
  return {
    hasChanges: changes.length > 0,
    changeCount: changes.length,
    changes,
  };
}

function resolveTargetId(
  kind: DraftKind,
  targetId: string | undefined,
): { ok: true; targetId: string } | { ok: false; error: string } {
  const normalized = normalizeText(targetId);
  if (kind === 'notification_report') {
    return { ok: true, targetId: normalized || `report-${Date.now()}` };
  }
  if (!normalized) {
    return { ok: false, error: 'target_required' };
  }
  return { ok: true, targetId: normalized };
}

async function buildInvoiceSendDraft(
  targetId: string,
  instruction: string,
): Promise<DraftContent | null> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: targetId },
    include: {
      project: {
        select: {
          id: true,
          code: true,
          name: true,
          customer: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });
  if (!invoice) return null;
  const invoiceNo = normalizeText(invoice.invoiceNo) || invoice.id;
  const customerName =
    normalizeText(invoice.project?.customer?.name) || 'ご担当者様';
  const projectName = normalizeText(invoice.project?.name) || invoice.projectId;
  const projectCode = normalizeText(invoice.project?.code);
  const dueDate = formatDate(invoice.dueDate);
  const issueDate = formatDate(invoice.issueDate);
  const amount = stringifyScalar(invoice.totalAmount);
  const currency = normalizeText(invoice.currency) || 'JPY';
  const subject = `【請求書送付案】${invoiceNo}`;
  const bodyLines = [
    `${customerName}`,
    '',
    'いつもお世話になっております。',
    `請求書 ${invoiceNo} を送付いたします。`,
    '',
    `- 案件: ${projectCode ? `${projectCode} / ` : ''}${projectName}`,
    `- 請求金額: ${amount} ${currency}`,
    `- 発行日: ${issueDate ?? '未設定'}`,
    `- 支払期限: ${dueDate ?? '未設定'}`,
    '',
    '内容をご確認のうえ、ご不明点があればご連絡ください。',
  ];
  return {
    kind: 'invoice_send',
    subject,
    body: appendInstruction(bodyLines.join('\n'), instruction),
    metadata: {
      targetTable: 'invoices',
      targetId: invoice.id,
      invoiceNo,
      projectId: invoice.projectId,
      projectName,
      customerId: invoice.project?.customer?.id ?? null,
      customerName: customerName === 'ご担当者様' ? null : customerName,
      amount,
      currency,
      issueDate,
      dueDate,
    },
  };
}

async function buildApprovalRequestDraft(
  targetId: string,
  instruction: string,
): Promise<DraftContent | null> {
  const approval = await prisma.approvalInstance.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      flowType: true,
      targetTable: true,
      targetId: true,
      status: true,
      projectId: true,
      currentStep: true,
      createdAt: true,
      ruleId: true,
    },
  });
  if (!approval) return null;
  const subject = `【承認依頼案】${approval.flowType}:${approval.targetId}`;
  const bodyLines = [
    '承認をお願いします。',
    '',
    `- 対象: ${approval.targetTable}/${approval.targetId}`,
    `- フロー: ${approval.flowType}`,
    `- ステータス: ${approval.status}`,
    `- 現在ステップ: ${approval.currentStep ?? 0}`,
    `- 申請日時: ${approval.createdAt.toISOString()}`,
    '',
    '証跡（Evidence Snapshot）を確認のうえ、承認可否を判断してください。',
  ];
  return {
    kind: 'approval_request',
    subject,
    body: appendInstruction(bodyLines.join('\n'), instruction),
    metadata: {
      targetTable: 'approval_instances',
      targetId: approval.id,
      flowType: approval.flowType,
      status: approval.status,
      projectId: approval.projectId,
      currentStep: approval.currentStep,
      ruleId: approval.ruleId,
    },
  };
}

function buildNotificationReportDraft(
  targetId: string,
  context: Record<string, unknown> | null | undefined,
  instruction: string,
): DraftContent {
  const reportName =
    normalizeText(context?.reportName) ||
    normalizeText(context?.title) ||
    '定期レポート';
  const period = normalizeText(context?.period) || '当月';
  const highlightsRaw = Array.isArray(context?.highlights)
    ? context?.highlights
    : [];
  const highlights = highlightsRaw
    .map((item) => normalizeText(item))
    .filter((item) => item.length > 0)
    .slice(0, 10);
  const subject = `【通知案】${reportName}（${period}）`;
  const bodyLines = [
    '関係者各位',
    '',
    `${reportName}（${period}）を共有します。`,
    '',
    '要点:',
    ...(highlights.length > 0
      ? highlights.map((item) => `- ${item}`)
      : ['- 要点は未入力です。']),
    '',
    '詳細はダッシュボードをご確認ください。',
  ];
  return {
    kind: 'notification_report',
    subject,
    body: appendInstruction(bodyLines.join('\n'), instruction),
    metadata: {
      targetTable: 'report_notifications',
      targetId,
      reportName,
      period,
      highlightCount: highlights.length,
    },
  };
}

async function buildDraft(
  body: DraftGenerateBody,
): Promise<DraftContent | null | 'target_required'> {
  const resolved = resolveTargetId(body.kind, body.targetId);
  if (!resolved.ok) return 'target_required';
  const instruction = normalizeText(body.instruction);
  if (body.kind === 'invoice_send') {
    return buildInvoiceSendDraft(resolved.targetId, instruction);
  }
  if (body.kind === 'approval_request') {
    return buildApprovalRequestDraft(resolved.targetId, instruction);
  }
  return buildNotificationReportDraft(
    resolved.targetId,
    body.context,
    instruction,
  );
}

export async function registerDraftRoutes(app: FastifyInstance) {
  app.post(
    '/drafts',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: draftGenerateSchema,
    },
    async (req, reply) => {
      const body = req.body as DraftGenerateBody;
      const draft = await buildDraft(body);
      if (draft === 'target_required') {
        return reply.code(400).send({ error: 'target_required' });
      }
      if (!draft) {
        return reply.code(404).send({ error: 'not_found' });
      }
      await logAudit({
        ...auditContextFromRequest(req),
        action: 'draft_generated',
        targetTable: 'drafts',
        targetId: draft.metadata.targetId
          ? String(draft.metadata.targetId)
          : undefined,
        metadata: {
          kind: draft.kind,
          targetTable: draft.metadata.targetTable,
          targetId: draft.metadata.targetId,
        } as Prisma.InputJsonValue,
      });
      return {
        kind: draft.kind,
        draft: {
          subject: draft.subject,
          body: draft.body,
        },
        metadata: draft.metadata,
      };
    },
  );

  app.post(
    '/drafts/regenerate',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: draftRegenerateSchema,
    },
    async (req, reply) => {
      const body = req.body as DraftGenerateBody & { previous: DraftText };
      const draft = await buildDraft(body);
      if (draft === 'target_required') {
        return reply.code(400).send({ error: 'target_required' });
      }
      if (!draft) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const diff = createDraftDiff(body.previous, {
        subject: draft.subject,
        body: draft.body,
      });
      await logAudit({
        ...auditContextFromRequest(req),
        action: 'draft_regenerated',
        targetTable: 'drafts',
        targetId: draft.metadata.targetId
          ? String(draft.metadata.targetId)
          : undefined,
        metadata: {
          kind: draft.kind,
          targetTable: draft.metadata.targetTable,
          targetId: draft.metadata.targetId,
          changeCount: diff.changeCount,
        } as Prisma.InputJsonValue,
      });
      return {
        kind: draft.kind,
        draft: {
          subject: draft.subject,
          body: draft.body,
        },
        metadata: draft.metadata,
        diff,
      };
    },
  );

  app.post(
    '/drafts/diff',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: draftDiffSchema,
    },
    async (req) => {
      const body = req.body as { before: DraftText; after: DraftText };
      const diff = createDraftDiff(body.before, body.after);
      await logAudit({
        ...auditContextFromRequest(req),
        action: 'draft_diff_viewed',
        targetTable: 'drafts',
        metadata: {
          changeCount: diff.changeCount,
          fields: diff.changes.map((item) => item.field),
        } as Prisma.InputJsonValue,
      });
      return diff;
    },
  );
}
