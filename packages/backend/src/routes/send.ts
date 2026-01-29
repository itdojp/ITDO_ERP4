import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import {
  sendEstimateEmail,
  sendInvoiceEmail,
  sendPurchaseOrderEmail,
} from '../services/notifier.js';
import { generatePdf, type PdfRenderOptions } from '../services/pdf.js';
import {
  getDefaultTemplate,
  getPdfTemplate,
} from '../services/pdfTemplates.js';
import type { PdfTemplate } from '../services/pdfTemplates.js';
import { DocStatusValue, FlowTypeValue } from '../types.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import type { NotifyResult } from '../services/notifier.js';
import { evaluateActionPolicyWithFallback } from '../services/actionPolicy.js';

type TemplateResolveResult = {
  template: PdfTemplate | null;
  setting: TemplateSetting | null;
  error?: { status: number; code: string };
};

type SendLogMetadata = Record<string, string>;

type TemplateSetting = {
  id: string;
  kind: PdfTemplate['kind'];
  templateId: string;
  layoutConfig?: unknown | null;
  logoUrl?: string | null;
  signatureText?: string | null;
  createdAt?: Date | null;
};

type SendLogInput = {
  kind: PdfTemplate['kind'];
  targetTable: string;
  targetId: string;
  recipients: string[];
  templateId: string;
  pdfUrl?: string;
  status: string;
  error?: string;
  actorId?: string;
  metadata?: SendLogMetadata;
};

type SendLogClient = {
  documentSendLog: {
    create: (args: {
      data: {
        kind: PdfTemplate['kind'];
        targetTable: string;
        targetId: string;
        channel: string;
        status: string;
        recipients: string[];
        templateId?: string;
        pdfUrl?: string;
        providerMessageId?: string;
        error?: string;
        metadata?: SendLogMetadata;
        createdBy?: string;
      };
      select: { id: true };
    }) => Promise<{ id: string }>;
    update: (args: {
      where: { id: string };
      data: {
        status?: string;
        providerMessageId?: string;
        error?: string;
        updatedBy?: string;
      };
    }) => Promise<unknown>;
  };
};

const SUCCESS_NOTIFY_STATUSES = new Set(['stub', 'success']);
const RETRY_BLOCK_STATUSES = new Set([
  'success',
  'stub',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'processed',
]);
const DEFAULT_RETRY_COOLDOWN_MINUTES = 5;

function resolveRetryCooldownMs() {
  const raw = process.env.SEND_LOG_RETRY_COOLDOWN_MINUTES;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.floor(parsed) * 60 * 1000;
  }
  return DEFAULT_RETRY_COOLDOWN_MINUTES * 60 * 1000;
}

async function resolveTemplateContext(
  kind: PdfTemplate['kind'],
  params: { templateId?: string; templateSettingId?: string },
): Promise<TemplateResolveResult> {
  let setting: TemplateSetting | null = null;
  let resolvedTemplateId = params.templateId;
  if (params.templateSettingId) {
    setting = (await prisma.docTemplateSetting.findUnique({
      where: { id: params.templateSettingId },
    })) as TemplateSetting | null;
    if (!setting) {
      return {
        template: null,
        setting: null,
        error: { status: 404, code: 'template_setting_not_found' },
      };
    }
    if (setting.kind !== kind) {
      return {
        template: null,
        setting: null,
        error: { status: 400, code: 'template_setting_kind_mismatch' },
      };
    }
    resolvedTemplateId = setting.templateId;
  }

  if (!resolvedTemplateId) {
    const defaultSetting = (await prisma.docTemplateSetting.findFirst({
      where: { kind, isDefault: true },
      orderBy: { createdAt: 'desc' },
    })) as TemplateSetting | null;
    if (defaultSetting) {
      setting = defaultSetting;
      resolvedTemplateId = defaultSetting.templateId;
    }
  }

  let template: PdfTemplate | undefined;
  if (resolvedTemplateId) {
    template = getPdfTemplate(resolvedTemplateId);
    if (!template) {
      return {
        template: null,
        setting: null,
        error: { status: 404, code: 'template_not_found' },
      };
    }
    if (template.kind !== kind) {
      return {
        template: null,
        setting: null,
        error: { status: 400, code: 'template_kind_mismatch' },
      };
    }
  } else {
    template = getDefaultTemplate(kind);
    if (!template) {
      return {
        template: null,
        setting: null,
        error: { status: 400, code: 'default_template_missing' },
      };
    }
  }

  if (!setting) {
    setting = (await prisma.docTemplateSetting.findFirst({
      where: { kind, templateId: template.id },
      orderBy: { createdAt: 'desc' },
    })) as TemplateSetting | null;
  }

  return { template, setting };
}

function buildPdfOptions(
  setting: TemplateSetting | null,
): PdfRenderOptions | undefined {
  if (!setting) return undefined;
  return {
    layoutConfig: setting.layoutConfig
      ? (setting.layoutConfig as Record<string, unknown>)
      : undefined,
    logoUrl: setting.logoUrl ?? undefined,
    signatureText: setting.signatureText ?? undefined,
  };
}

function buildSendLogMetadata(
  template: PdfTemplate,
  setting: TemplateSetting | null,
  extra?: SendLogMetadata,
): SendLogMetadata {
  const metadata: SendLogMetadata = { templateId: template.id };
  if (setting?.id) {
    metadata.templateSettingId = setting.id;
  }
  if (extra) {
    Object.entries(extra).forEach(([key, value]) => {
      metadata[key] = value;
    });
  }
  return metadata;
}

function shouldMarkSent(result: NotifyResult) {
  return SUCCESS_NOTIFY_STATUSES.has(result.status);
}

async function createSendLog(db: SendLogClient, input: SendLogInput) {
  return db.documentSendLog.create({
    data: {
      kind: input.kind,
      targetTable: input.targetTable,
      targetId: input.targetId,
      channel: 'email',
      status: input.status,
      recipients: input.recipients,
      templateId: input.templateId,
      pdfUrl: input.pdfUrl,
      error: input.error,
      metadata: input.metadata,
      createdBy: input.actorId,
    },
    select: { id: true },
  });
}

async function updateSendLog(
  db: SendLogClient,
  params: {
    id: string;
    result: NotifyResult;
    actorId?: string;
  },
) {
  return db.documentSendLog.update({
    where: { id: params.id },
    data: {
      status: params.result.status,
      providerMessageId: params.result.messageId,
      error: params.result.error,
      updatedBy: params.actorId,
    },
  });
}

function buildEmailMetadata(params: {
  sendLogId: string;
  targetTable: string;
  targetId: string;
  kind: PdfTemplate['kind'];
}): SendLogMetadata {
  return {
    sendLogId: params.sendLogId,
    targetTable: params.targetTable,
    targetId: params.targetId,
    kind: params.kind,
  };
}

function extractTemplateSettingId(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const raw = metadata as Record<string, unknown>;
  const value = raw.templateSettingId;
  return typeof value === 'string' ? value : undefined;
}

export async function registerSendRoutes(app: FastifyInstance) {
  app.post(
    '/estimates/:id/send',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { templateId, templateSettingId } = req.query as {
        templateId?: string;
        templateSettingId?: string;
      };
      const estimate = await prisma.estimate.findUnique({ where: { id } });
      if (!estimate) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const resolved = await resolveTemplateContext('estimate', {
        templateId,
        templateSettingId,
      });
      if (!resolved.template) {
        return reply
          .code(resolved.error?.status || 400)
          .send({ error: resolved.error?.code || 'invalid_template' });
      }
      const template = resolved.template;
      const pdf = await generatePdf(
        template.id,
        {
          id,
          estimateNo: estimate.estimateNo,
        },
        estimate.estimateNo,
        buildPdfOptions(resolved.setting),
      );
      const recipients = ['sales@example.com'];
      if (!pdf.filePath || !pdf.filename) {
        await createSendLog(prisma, {
          kind: 'estimate',
          targetTable: 'estimates',
          targetId: id,
          recipients,
          templateId: template.id,
          pdfUrl: pdf.url,
          status: 'failed',
          error: 'pdf_generation_failed',
          actorId: req.user?.userId,
          metadata: buildSendLogMetadata(template, resolved.setting),
        });
        return reply.status(500).send({ error: 'pdf_generation_failed' });
      }
      const sendLog = await createSendLog(prisma, {
        kind: 'estimate',
        targetTable: 'estimates',
        targetId: id,
        recipients,
        templateId: template.id,
        pdfUrl: pdf.url,
        status: 'requested',
        actorId: req.user?.userId,
        metadata: buildSendLogMetadata(template, resolved.setting),
      });
      const notifyResult = await sendEstimateEmail(
        recipients,
        estimate.estimateNo,
        {
          filename: pdf.filename,
          path: pdf.filePath,
          url: pdf.url,
        },
        {
          metadata: buildEmailMetadata({
            sendLogId: sendLog.id,
            targetTable: 'estimates',
            targetId: id,
            kind: 'estimate',
          }),
        },
      );
      const nextStatus = shouldMarkSent(notifyResult)
        ? DocStatusValue.sent
        : estimate.status;
      const updated = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const updatedEstimate = await tx.estimate.update({
            where: { id },
            data: {
              status: nextStatus,
              pdfUrl: pdf.url,
              emailMessageId: notifyResult.messageId,
            },
          });
          await updateSendLog(tx, {
            id: sendLog.id,
            result: notifyResult,
            actorId: req.user?.userId,
          });
          return updatedEstimate;
        },
      );
      return updated;
    },
  );

  app.get(
    '/estimates/:id/send-logs',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const estimate = await prisma.estimate.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!estimate) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const items = await prisma.documentSendLog.findMany({
        where: { targetTable: 'estimates', targetId: id },
        orderBy: { createdAt: 'desc' },
      });
      return { items };
    },
  );

  app.post(
    '/invoices/:id/send',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const {
        templateId,
        templateSettingId,
        reasonText: reasonTextRaw,
      } = req.query as {
        templateId?: string;
        templateSettingId?: string;
        reasonText?: string;
      };
      const reasonText =
        typeof reasonTextRaw === 'string' ? reasonTextRaw.trim() : '';
      const invoice = await prisma.invoice.findUnique({ where: { id } });
      if (!invoice) {
        return reply.code(404).send({ error: 'not_found' });
      }

      const policyRes = await evaluateActionPolicyWithFallback({
        flowType: FlowTypeValue.invoice,
        actionKey: 'send',
        actor: {
          userId: req.user?.userId ?? null,
          roles: req.user?.roles || [],
          groupIds: req.user?.groupIds || [],
        },
        reasonText,
        state: { status: invoice.status, projectId: invoice.projectId },
        targetTable: 'invoices',
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
            message: 'Invoice cannot be sent',
            details: {
              reason: policyRes.reason,
              matchedPolicyId: policyRes.matchedPolicyId ?? null,
              guardFailures: policyRes.guardFailures ?? null,
            },
          },
        });
      }
      const resolved = await resolveTemplateContext('invoice', {
        templateId,
        templateSettingId,
      });
      if (!resolved.template) {
        return reply
          .code(resolved.error?.status || 400)
          .send({ error: resolved.error?.code || 'invalid_template' });
      }
      const template = resolved.template;
      const pdf = await generatePdf(
        template.id,
        {
          id,
          invoiceNo: invoice.invoiceNo,
        },
        invoice.invoiceNo,
        buildPdfOptions(resolved.setting),
      );
      const recipients = ['fin@example.com'];
      if (!pdf.filePath || !pdf.filename) {
        await createSendLog(prisma, {
          kind: 'invoice',
          targetTable: 'invoices',
          targetId: id,
          recipients,
          templateId: template.id,
          pdfUrl: pdf.url,
          status: 'failed',
          error: 'pdf_generation_failed',
          actorId: req.user?.userId,
          metadata: buildSendLogMetadata(template, resolved.setting),
        });
        return reply.status(500).send({ error: 'pdf_generation_failed' });
      }
      const sendLog = await createSendLog(prisma, {
        kind: 'invoice',
        targetTable: 'invoices',
        targetId: id,
        recipients,
        templateId: template.id,
        pdfUrl: pdf.url,
        status: 'requested',
        actorId: req.user?.userId,
        metadata: buildSendLogMetadata(template, resolved.setting),
      });
      const notifyResult = await sendInvoiceEmail(
        recipients,
        invoice.invoiceNo,
        {
          filename: pdf.filename,
          path: pdf.filePath,
          url: pdf.url,
        },
        {
          metadata: buildEmailMetadata({
            sendLogId: sendLog.id,
            targetTable: 'invoices',
            targetId: id,
            kind: 'invoice',
          }),
        },
      );
      const nextStatus = shouldMarkSent(notifyResult)
        ? DocStatusValue.sent
        : invoice.status;
      const updated = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const updatedInvoice = await tx.invoice.update({
            where: { id },
            data: {
              status: nextStatus,
              pdfUrl: pdf.url,
              emailMessageId: notifyResult.messageId,
            },
          });
          await updateSendLog(tx, {
            id: sendLog.id,
            result: notifyResult,
            actorId: req.user?.userId,
          });
          return updatedInvoice;
        },
      );
      return updated;
    },
  );

  app.get(
    '/invoices/:id/send-logs',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = await prisma.invoice.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!invoice) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const items = await prisma.documentSendLog.findMany({
        where: { targetTable: 'invoices', targetId: id },
        orderBy: { createdAt: 'desc' },
      });
      return { items };
    },
  );

  app.post(
    '/purchase-orders/:id/send',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { templateId, templateSettingId } = req.query as {
        templateId?: string;
        templateSettingId?: string;
      };
      const po = await prisma.purchaseOrder.findUnique({ where: { id } });
      if (!po) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const resolved = await resolveTemplateContext('purchase_order', {
        templateId,
        templateSettingId,
      });
      if (!resolved.template) {
        return reply
          .code(resolved.error?.status || 400)
          .send({ error: resolved.error?.code || 'invalid_template' });
      }
      const template = resolved.template;
      const pdf = await generatePdf(
        template.id,
        { id, poNo: po.poNo },
        po.poNo,
        buildPdfOptions(resolved.setting),
      );
      const recipients = ['vendor@example.com'];
      if (!pdf.filePath || !pdf.filename) {
        await createSendLog(prisma, {
          kind: 'purchase_order',
          targetTable: 'purchase_orders',
          targetId: id,
          recipients,
          templateId: template.id,
          pdfUrl: pdf.url,
          status: 'failed',
          error: 'pdf_generation_failed',
          actorId: req.user?.userId,
          metadata: buildSendLogMetadata(template, resolved.setting),
        });
        return reply.status(500).send({ error: 'pdf_generation_failed' });
      }
      const sendLog = await createSendLog(prisma, {
        kind: 'purchase_order',
        targetTable: 'purchase_orders',
        targetId: id,
        recipients,
        templateId: template.id,
        pdfUrl: pdf.url,
        status: 'requested',
        actorId: req.user?.userId,
        metadata: buildSendLogMetadata(template, resolved.setting),
      });
      const notifyResult = await sendPurchaseOrderEmail(
        recipients,
        po.poNo,
        {
          filename: pdf.filename,
          path: pdf.filePath,
          url: pdf.url,
        },
        {
          metadata: buildEmailMetadata({
            sendLogId: sendLog.id,
            targetTable: 'purchase_orders',
            targetId: id,
            kind: 'purchase_order',
          }),
        },
      );
      const nextStatus = shouldMarkSent(notifyResult)
        ? DocStatusValue.sent
        : po.status;
      const updated = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const updatedPo = await tx.purchaseOrder.update({
            where: { id },
            data: { status: nextStatus, pdfUrl: pdf.url },
          });
          await updateSendLog(tx, {
            id: sendLog.id,
            result: notifyResult,
            actorId: req.user?.userId,
          });
          return updatedPo;
        },
      );
      return updated;
    },
  );

  app.get(
    '/purchase-orders/:id/send-logs',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const purchaseOrder = await prisma.purchaseOrder.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!purchaseOrder) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const items = await prisma.documentSendLog.findMany({
        where: { targetTable: 'purchase_orders', targetId: id },
        orderBy: { createdAt: 'desc' },
      });
      return { items };
    },
  );

  app.get(
    '/document-send-logs/:id',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const item = await prisma.documentSendLog.findUnique({ where: { id } });
      if (!item) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return item;
    },
  );

  app.get(
    '/document-send-logs/:id/events',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const sendLog = await prisma.documentSendLog.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!sendLog) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const items = await prisma.documentSendEvent.findMany({
        where: { sendLogId: id },
        orderBy: { createdAt: 'desc' },
      });
      return { items };
    },
  );

  app.post(
    '/document-send-logs/:id/retry',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const sendLog = await prisma.documentSendLog.findUnique({
        where: { id },
      });
      if (!sendLog) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (RETRY_BLOCK_STATUSES.has(sendLog.status)) {
        return reply.code(400).send({ error: 'already_sent' });
      }
      const cooldownMs = resolveRetryCooldownMs();
      if (cooldownMs > 0) {
        const lastEvent = await prisma.documentSendEvent.findFirst({
          where: { sendLogId: id },
          orderBy: { createdAt: 'desc' },
        });
        const lastActivity =
          lastEvent?.createdAt ||
          (sendLog.updatedAt instanceof Date ? sendLog.updatedAt : null) ||
          (sendLog.createdAt instanceof Date ? sendLog.createdAt : null);
        if (lastActivity) {
          const lastTime = lastActivity.getTime();
          if (!Number.isNaN(lastTime) && Date.now() - lastTime < cooldownMs) {
            return reply.code(429).send({ error: 'retry_too_soon' });
          }
        }
      }
      const templateSettingId = extractTemplateSettingId(sendLog.metadata);
      const targetTable = sendLog.targetTable;
      if (targetTable === 'invoices') {
        const invoice = await prisma.invoice.findUnique({
          where: { id: sendLog.targetId },
        });
        if (!invoice) {
          return reply.code(404).send({ error: 'target_not_found' });
        }
        const resolved = await resolveTemplateContext('invoice', {
          templateId: sendLog.templateId ?? undefined,
          templateSettingId,
        });
        if (!resolved.template) {
          return reply
            .code(resolved.error?.status || 400)
            .send({ error: resolved.error?.code || 'invalid_template' });
        }
        const template = resolved.template;
        const pdf = await generatePdf(
          template.id,
          { id: sendLog.targetId, invoiceNo: invoice.invoiceNo },
          invoice.invoiceNo,
          buildPdfOptions(resolved.setting),
        );
        if (!pdf.filePath || !pdf.filename) {
          await createSendLog(prisma, {
            kind: 'invoice',
            targetTable: 'invoices',
            targetId: sendLog.targetId,
            recipients: Array.isArray(sendLog.recipients)
              ? (sendLog.recipients as string[])
              : [],
            templateId: template.id,
            pdfUrl: pdf.url,
            status: 'failed',
            error: 'pdf_generation_failed',
            actorId: req.user?.userId,
            metadata: buildSendLogMetadata(template, resolved.setting, {
              retryOf: sendLog.id,
            }),
          });
          return reply.status(500).send({ error: 'pdf_generation_failed' });
        }
        const recipients = Array.isArray(sendLog.recipients)
          ? (sendLog.recipients as string[])
          : ['fin@example.com'];
        const retryLog = await createSendLog(prisma, {
          kind: 'invoice',
          targetTable: 'invoices',
          targetId: sendLog.targetId,
          recipients,
          templateId: template.id,
          pdfUrl: pdf.url,
          status: 'requested',
          actorId: req.user?.userId,
          metadata: buildSendLogMetadata(template, resolved.setting, {
            retryOf: sendLog.id,
          }),
        });
        const notifyResult = await sendInvoiceEmail(
          recipients,
          invoice.invoiceNo,
          { filename: pdf.filename, path: pdf.filePath, url: pdf.url },
          {
            metadata: buildEmailMetadata({
              sendLogId: retryLog.id,
              targetTable: 'invoices',
              targetId: sendLog.targetId,
              kind: 'invoice',
            }),
          },
        );
        const nextStatus = shouldMarkSent(notifyResult)
          ? DocStatusValue.sent
          : invoice.status;
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await tx.invoice.update({
            where: { id: invoice.id },
            data: {
              status: nextStatus,
              pdfUrl: pdf.url,
              emailMessageId: notifyResult.messageId,
            },
          });
          await updateSendLog(tx, {
            id: retryLog.id,
            result: notifyResult,
            actorId: req.user?.userId,
          });
        });
        return { status: 'ok', retryLogId: retryLog.id };
      }

      if (targetTable === 'purchase_orders') {
        const po = await prisma.purchaseOrder.findUnique({
          where: { id: sendLog.targetId },
        });
        if (!po) {
          return reply.code(404).send({ error: 'target_not_found' });
        }
        const resolved = await resolveTemplateContext('purchase_order', {
          templateId: sendLog.templateId ?? undefined,
          templateSettingId,
        });
        if (!resolved.template) {
          return reply
            .code(resolved.error?.status || 400)
            .send({ error: resolved.error?.code || 'invalid_template' });
        }
        const template = resolved.template;
        const pdf = await generatePdf(
          template.id,
          { id: sendLog.targetId, poNo: po.poNo },
          po.poNo,
          buildPdfOptions(resolved.setting),
        );
        if (!pdf.filePath || !pdf.filename) {
          await createSendLog(prisma, {
            kind: 'purchase_order',
            targetTable: 'purchase_orders',
            targetId: sendLog.targetId,
            recipients: Array.isArray(sendLog.recipients)
              ? (sendLog.recipients as string[])
              : [],
            templateId: template.id,
            pdfUrl: pdf.url,
            status: 'failed',
            error: 'pdf_generation_failed',
            actorId: req.user?.userId,
            metadata: buildSendLogMetadata(template, resolved.setting, {
              retryOf: sendLog.id,
            }),
          });
          return reply.status(500).send({ error: 'pdf_generation_failed' });
        }
        const recipients = Array.isArray(sendLog.recipients)
          ? (sendLog.recipients as string[])
          : ['vendor@example.com'];
        const retryLog = await createSendLog(prisma, {
          kind: 'purchase_order',
          targetTable: 'purchase_orders',
          targetId: sendLog.targetId,
          recipients,
          templateId: template.id,
          pdfUrl: pdf.url,
          status: 'requested',
          actorId: req.user?.userId,
          metadata: buildSendLogMetadata(template, resolved.setting, {
            retryOf: sendLog.id,
          }),
        });
        const notifyResult = await sendPurchaseOrderEmail(
          recipients,
          po.poNo,
          { filename: pdf.filename, path: pdf.filePath, url: pdf.url },
          {
            metadata: buildEmailMetadata({
              sendLogId: retryLog.id,
              targetTable: 'purchase_orders',
              targetId: sendLog.targetId,
              kind: 'purchase_order',
            }),
          },
        );
        const nextStatus = shouldMarkSent(notifyResult)
          ? DocStatusValue.sent
          : po.status;
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: { status: nextStatus, pdfUrl: pdf.url },
          });
          await updateSendLog(tx, {
            id: retryLog.id,
            result: notifyResult,
            actorId: req.user?.userId,
          });
        });
        return { status: 'ok', retryLogId: retryLog.id };
      }

      return reply.code(400).send({ error: 'unsupported_target' });
    },
  );
}
