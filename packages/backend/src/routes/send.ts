import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { sendEmailStub, recordPdfStub } from '../services/notifier.js';
import { DocStatusValue } from '../types.js';

const prisma = new PrismaClient();

export async function registerSendRoutes(app: FastifyInstance) {
  app.post('/invoices/:id/send', async (req) => {
    const { id } = req.params as { id: string };
    const invoice = await prisma.invoice.update({ where: { id }, data: { status: DocStatusValue.sent } });
    await recordPdfStub('invoice', { id });
    await sendEmailStub(['fin@example.com'], `Invoice ${invoice.invoiceNo}`, 'Stub send');
    return invoice;
  });

  app.post('/purchase-orders/:id/send', async (req) => {
    const { id } = req.params as { id: string };
    const po = await prisma.purchaseOrder.update({ where: { id }, data: { status: DocStatusValue.sent } });
    await recordPdfStub('purchase_order', { id });
    await sendEmailStub(['vendor@example.com'], `PO ${po.poNo}`, 'Stub send');
    return po;
  });
}
