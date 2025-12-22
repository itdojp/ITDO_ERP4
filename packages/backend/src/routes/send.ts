import { FastifyInstance } from 'fastify';
import { sendInvoiceEmail, sendPurchaseOrderEmail, generatePdfStub } from '../services/notifier.js';
import { getDefaultTemplate, getPdfTemplate } from '../services/pdfTemplates.js';
import { DocStatusValue } from '../types.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';

export async function registerSendRoutes(app: FastifyInstance) {
  app.post('/invoices/:id/send', { preHandler: requireRole(['admin', 'mgmt']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { templateId } = req.query as { templateId?: string };
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) {
      return { error: 'not_found' };
    }
    const template = templateId ? getPdfTemplate(templateId) : getDefaultTemplate('invoice');
    if (!template) {
      return reply.code(400).send({ error: 'invalid_template' });
    }
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
    const template = templateId ? getPdfTemplate(templateId) : getDefaultTemplate('purchase_order');
    if (!template) {
      return reply.code(400).send({ error: 'invalid_template' });
    }
    const pdf = await generatePdfStub(template.id, { id, poNo: po.poNo });
    const updated = await prisma.purchaseOrder.update({ where: { id }, data: { status: DocStatusValue.sent, pdfUrl: pdf.url } });
    await sendPurchaseOrderEmail(['vendor@example.com'], po.poNo);
    return updated;
  });
}
