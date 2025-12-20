import { FastifyInstance } from 'fastify';
import { sendInvoiceEmail, sendPurchaseOrderEmail, generatePdfStub } from '../services/notifier.js';
import { DocStatusValue } from '../types.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';

export async function registerSendRoutes(app: FastifyInstance) {
  app.post('/invoices/:id/send', { preHandler: requireRole(['admin', 'mgmt']) }, async (req) => {
    const { id } = req.params as { id: string };
    const invoice = await prisma.invoice.update({ where: { id }, data: { status: DocStatusValue.sent } });
    const pdf = await generatePdfStub('invoice', { id, invoiceNo: invoice.invoiceNo });
    const updated = await prisma.invoice.update({ where: { id }, data: { pdfUrl: pdf.url } });
    await sendInvoiceEmail(['fin@example.com'], invoice.invoiceNo);
    return updated;
  });

  app.post('/purchase-orders/:id/send', { preHandler: requireRole(['admin', 'mgmt']) }, async (req) => {
    const { id } = req.params as { id: string };
    const po = await prisma.purchaseOrder.update({ where: { id }, data: { status: DocStatusValue.sent } });
    const pdf = await generatePdfStub('purchase_order', { id, poNo: po.poNo });
    const updated = await prisma.purchaseOrder.update({ where: { id }, data: { pdfUrl: pdf.url } });
    await sendPurchaseOrderEmail(['vendor@example.com'], po.poNo);
    return updated;
  });
}
