import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import {
  sendInvoiceEmail,
  sendPurchaseOrderEmail,
} from '../services/notifier.js';
import { generatePdf } from '../services/pdf.js';
import {
  getDefaultTemplate,
  getPdfTemplate,
} from '../services/pdfTemplates.js';
import type { PdfTemplate } from '../services/pdfTemplates.js';
import { DocStatusValue } from '../types.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import type { NotifyResult } from '../services/notifier.js';

type TemplateResolveResult = {
  template: PdfTemplate | null;
  error?: { status: number; code: string };
};

type DocumentSendLogClient = {
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
        createdBy?: string;
      };
    }) => Promise<unknown>;
  };
};

const SUCCESS_NOTIFY_STATUSES = new Set(['stub', 'success']);

function resolveTemplate(
  kind: PdfTemplate['kind'],
  templateId?: string,
): TemplateResolveResult {
  if (templateId) {
    const template = getPdfTemplate(templateId);
    if (!template) {
      return {
        template: null,
        error: { status: 404, code: 'template_not_found' },
      };
    }
    if (template.kind !== kind) {
      return {
        template: null,
        error: { status: 400, code: 'template_kind_mismatch' },
      };
    }
    return { template };
  }
  const template = getDefaultTemplate(kind);
  if (!template) {
    return {
      template: null,
      error: { status: 400, code: 'default_template_missing' },
    };
  }
  return { template };
}

function shouldMarkSent(result: NotifyResult) {
  return SUCCESS_NOTIFY_STATUSES.has(result.status);
}

async function recordSendLog(
  db: DocumentSendLogClient,
  params: {
    kind: PdfTemplate['kind'];
    targetTable: string;
    targetId: string;
    recipients: string[];
    templateId: string;
    pdfUrl?: string;
    result: NotifyResult;
    actorId?: string;
  },
) {
  const {
    kind,
    targetTable,
    targetId,
    recipients,
    templateId,
    pdfUrl,
    result,
    actorId,
  } = params;
  await db.documentSendLog.create({
    data: {
      kind,
      targetTable,
      targetId,
      channel: result.channel,
      status: result.status,
      recipients,
      templateId,
      pdfUrl,
      providerMessageId: result.messageId,
      error: result.error,
      createdBy: actorId,
    },
  });
}

export async function registerSendRoutes(app: FastifyInstance) {
  app.post(
    '/invoices/:id/send',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { templateId } = req.query as { templateId?: string };
      const invoice = await prisma.invoice.findUnique({ where: { id } });
      if (!invoice) {
        return { error: 'not_found' };
      }
      const resolved = resolveTemplate('invoice', templateId);
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
      );
      const recipients = ['fin@example.com'];
      if (!pdf.filePath || !pdf.filename) {
        const failureResult: NotifyResult = {
          channel: 'email',
          status: 'failed',
          target: recipients.join(','),
          error: 'pdf_generation_failed',
        };
        await recordSendLog(prisma, {
          kind: 'invoice',
          targetTable: 'invoices',
          targetId: id,
          recipients,
          templateId: template.id,
          result: failureResult,
          actorId: req.user?.userId,
        });
        return reply.status(500).send({ error: 'pdf_generation_failed' });
      }
      const notifyResult = await sendInvoiceEmail(
        recipients,
        invoice.invoiceNo,
        {
          filename: pdf.filename,
          path: pdf.filePath,
          url: pdf.url,
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
          await recordSendLog(tx, {
            kind: 'invoice',
            targetTable: 'invoices',
            targetId: id,
            recipients,
            templateId: template.id,
            pdfUrl: pdf.url,
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
      const { templateId } = req.query as { templateId?: string };
      const po = await prisma.purchaseOrder.findUnique({ where: { id } });
      if (!po) {
        return { error: 'not_found' };
      }
      const resolved = resolveTemplate('purchase_order', templateId);
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
      );
      const recipients = ['vendor@example.com'];
      if (!pdf.filePath || !pdf.filename) {
        const failureResult: NotifyResult = {
          channel: 'email',
          status: 'failed',
          target: recipients.join(','),
          error: 'pdf_generation_failed',
        };
        await recordSendLog(prisma, {
          kind: 'purchase_order',
          targetTable: 'purchase_orders',
          targetId: id,
          recipients,
          templateId: template.id,
          result: failureResult,
          actorId: req.user?.userId,
        });
        return reply.status(500).send({ error: 'pdf_generation_failed' });
      }
      const notifyResult = await sendPurchaseOrderEmail(recipients, po.poNo, {
        filename: pdf.filename,
        path: pdf.filePath,
        url: pdf.url,
      });
      const nextStatus = shouldMarkSent(notifyResult)
        ? DocStatusValue.sent
        : po.status;
      const updated = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const updatedPo = await tx.purchaseOrder.update({
            where: { id },
            data: { status: nextStatus, pdfUrl: pdf.url },
          });
          await recordSendLog(tx, {
            kind: 'purchase_order',
            targetTable: 'purchase_orders',
            targetId: id,
            recipients,
            templateId: template.id,
            pdfUrl: pdf.url,
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
}
