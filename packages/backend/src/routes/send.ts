import { FastifyInstance } from 'fastify';
import { sendInvoiceEmail, sendPurchaseOrderEmail, generatePdfStub } from '../services/notifier.js';
import { getDefaultTemplate, getPdfTemplate } from '../services/pdfTemplates.js';
import type { PdfTemplate } from '../services/pdfTemplates.js';
import { DocStatusValue } from '../types.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';

type TemplateResolveResult = { template: PdfTemplate | null; error?: { status: number; code: string } };

function resolveTemplate(kind: PdfTemplate['kind'], templateId?: string): TemplateResolveResult {
  if (templateId) {
    const template = getPdfTemplate(templateId);
    if (!template) {
      return { template: null, error: { status: 404, code: 'template_not_found' } };
    }
    if (template.kind !== kind) {
      return { template: null, error: { status: 400, code: 'template_kind_mismatch' } };
    }
    return { template };
  }
  const template = getDefaultTemplate(kind);
  if (!template) {
    return { template: null, error: { status: 400, code: 'default_template_missing' } };
  }
  return { template };
}

export async function registerSendRoutes(app: FastifyInstance) {
  app.post('/invoices/:id/send', { preHandler: requireRole(['admin', 'mgmt']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { templateId } = req.query as { templateId?: string };
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) {
      return { error: 'not_found' };
    }
    const resolved = resolveTemplate('invoice', templateId);
    if (!resolved.template) {
      return reply.code(resolved.error?.status || 400).send({ error: resolved.error?.code || 'invalid_template' });
    }
    const template = resolved.template;
    const pdf = await generatePdfStub(template.id, { id, invoiceNo: invoice.invoiceNo });
    const updated = await prisma.invoice.update({ where: { id }, data: { status: DocStatusValue.sent, pdfUrl: pdf.url } });
    await sendInvoiceEmail(['fin@example.com'], invoice.invoiceNo);
    return updated;
  });

  app.post('/purchase-orders/:id/send', { preHandler: requireRole(['admin', 'mgmt']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { templateId } = req.query as { templateId?: string };
    const po = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) {
      return { error: 'not_found' };
    }
    const resolved = resolveTemplate('purchase_order', templateId);
    if (!resolved.template) {
      return reply.code(resolved.error?.status || 400).send({ error: resolved.error?.code || 'invalid_template' });
    }
    const template = resolved.template;
    const pdf = await generatePdfStub(template.id, { id, poNo: po.poNo });
    const updated = await prisma.purchaseOrder.update({ where: { id }, data: { status: DocStatusValue.sent, pdfUrl: pdf.url } });
    await sendPurchaseOrderEmail(['vendor@example.com'], po.poNo);
    return updated;
  });
}
