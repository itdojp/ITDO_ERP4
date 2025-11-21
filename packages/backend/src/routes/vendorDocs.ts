import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { createApproval } from '../services/approval.js';
import { FlowTypeValue, DocStatusValue } from '../types.js';

const prisma = new PrismaClient();

export async function registerVendorDocRoutes(app: FastifyInstance) {
  app.post('/vendor-quotes', async (req) => {
    const body = req.body as any;
    const vendorQuote = await prisma.vendorQuote.create({ data: body });
    return vendorQuote;
  });

  app.post('/vendor-invoices', async (req) => {
    const body = req.body as any;
    const vi = await prisma.vendorInvoice.create({ data: body });
    return vi;
  });

  app.post('/vendor-invoices/:id/approve', async (req) => {
    const { id } = req.params as { id: string };
    const vi = await prisma.vendorInvoice.update({ where: { id }, data: { status: DocStatusValue.pending_qa } });
    await createApproval(FlowTypeValue.vendor_invoice, 'vendor_invoices', id, [{ approverGroupId: 'mgmt' }, { approverGroupId: 'exec' }]);
    return vi;
  });
}
