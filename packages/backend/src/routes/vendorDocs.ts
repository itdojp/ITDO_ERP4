import { FastifyInstance } from 'fastify';
import { createApprovalFor } from '../services/approval.js';
import { FlowTypeValue, DocStatusValue } from '../types.js';
import { vendorInvoiceSchema, vendorQuoteSchema } from './validators.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';

export async function registerVendorDocRoutes(app: FastifyInstance) {
  app.post('/vendor-quotes', { preHandler: requireRole(['admin', 'mgmt']), schema: vendorQuoteSchema }, async (req) => {
    const body = req.body as any;
    const vendorQuote = await prisma.vendorQuote.create({ data: body });
    return vendorQuote;
  });

  app.post('/vendor-invoices', { preHandler: requireRole(['admin', 'mgmt']), schema: vendorInvoiceSchema }, async (req) => {
    const body = req.body as any;
    const vi = await prisma.vendorInvoice.create({ data: body });
    return vi;
  });

  app.post('/vendor-invoices/:id/approve', { preHandler: requireRole(['admin', 'mgmt']) }, async (req) => {
    const { id } = req.params as { id: string };
    const vi = await prisma.vendorInvoice.update({ where: { id }, data: { status: DocStatusValue.pending_qa } });
    await createApprovalFor(FlowTypeValue.vendor_invoice, 'vendor_invoices', id, {
      totalAmount: vi.totalAmount,
      projectId: vi.projectId,
      vendorId: vi.vendorId,
    }, { createdBy: req.user?.userId });
    return vi;
  });
}
