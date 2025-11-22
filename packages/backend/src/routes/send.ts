import { FastifyInstance } from 'fastify';
import { sendInvoiceEmail, sendPurchaseOrderEmail, recordPdfStub } from '../services/notifier.js';
import { DocStatusValue } from '../types.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';

export async function registerSendRoutes(app: FastifyInstance) {
  app.post('/invoices/:id/send', { preHandler: requireRole(['admin', 'mgmt']) }, async (req) => {
    const { id } = req.params as { id: string };
    const invoice = await prisma.invoice.update({ where: { id }, data: { status: DocStatusValue.sent } });
    await recordPdfStub('invoice', { id });
    await sendInvoiceEmail(['fin@example.com'], invoice.invoiceNo);
    return invoice;
  });

  app.post('/purchase-orders/:id/send', { preHandler: requireRole(['admin', 'mgmt']) }, async (req) => {
    const { id } = req.params as { id: string };
    const po = await prisma.purchaseOrder.update({ where: { id }, data: { status: DocStatusValue.sent } });
    await recordPdfStub('purchase_order', { id });
    await sendPurchaseOrderEmail(['vendor@example.com'], po.poNo);
    return po;
  });
}
