import { FastifyInstance } from 'fastify';
import {
  sendInvoiceEmail,
  sendPurchaseOrderEmail,
  generatePdfStub,
} from '../services/notifier.js';
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

async function recordSendLog(params: {
  kind: PdfTemplate['kind'];
  targetTable: string;
  targetId: string;
  recipients: string[];
  templateId: string;
  pdfUrl: string;
  result: NotifyResult;
  actorId?: string;
}) {
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
  await prisma.documentSendLog.create({
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
      const pdf = await generatePdfStub(template.id, {
        id,
        invoiceNo: invoice.invoiceNo,
      });
      const recipients = ['fin@example.com'];
      const notifyResult = await sendInvoiceEmail(
        recipients,
        invoice.invoiceNo,
      );
      const nextStatus =
        notifyResult.status === 'failed' || notifyResult.status === 'error'
          ? invoice.status
          : DocStatusValue.sent;
      const updated = await prisma.invoice.update({
        where: { id },
        data: {
          status: nextStatus,
          pdfUrl: pdf.url,
          emailMessageId: notifyResult.messageId,
        },
      });
      await recordSendLog({
        kind: 'invoice',
        targetTable: 'invoices',
        targetId: id,
        recipients,
        templateId: template.id,
        pdfUrl: pdf.url,
        result: notifyResult,
        actorId: req.user?.userId,
      });
      return updated;
    },
  );

  app.get(
    '/invoices/:id/send-logs',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { id } = req.params as { id: string };
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
      const pdf = await generatePdfStub(template.id, { id, poNo: po.poNo });
      const recipients = ['vendor@example.com'];
      const notifyResult = await sendPurchaseOrderEmail(recipients, po.poNo);
      const nextStatus =
        notifyResult.status === 'failed' || notifyResult.status === 'error'
          ? po.status
          : DocStatusValue.sent;
      const updated = await prisma.purchaseOrder.update({
        where: { id },
        data: { status: nextStatus, pdfUrl: pdf.url },
      });
      await recordSendLog({
        kind: 'purchase_order',
        targetTable: 'purchase_orders',
        targetId: id,
        recipients,
        templateId: template.id,
        pdfUrl: pdf.url,
        result: notifyResult,
        actorId: req.user?.userId,
      });
      return updated;
    },
  );

  app.get(
    '/purchase-orders/:id/send-logs',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { id } = req.params as { id: string };
      const items = await prisma.documentSendLog.findMany({
        where: { targetTable: 'purchase_orders', targetId: id },
        orderBy: { createdAt: 'desc' },
      });
      return { items };
    },
  );
}
