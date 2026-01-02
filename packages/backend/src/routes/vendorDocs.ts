import { FastifyInstance } from 'fastify';
import { submitApprovalWithUpdate } from '../services/approval.js';
import { FlowTypeValue, DocStatusValue } from '../types.js';
import { vendorInvoiceSchema, vendorQuoteSchema } from './validators.js';
import { requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { checkProjectAndVendor } from '../services/entityChecks.js';

export async function registerVendorDocRoutes(app: FastifyInstance) {
  const parseDate = (value?: string) => (value ? new Date(value) : undefined);

  app.get(
    '/vendor-quotes',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { projectId, vendorId, status } = req.query as {
        projectId?: string;
        vendorId?: string;
        status?: string;
      };
      const where: Record<string, unknown> = {};
      if (projectId) where.projectId = projectId;
      if (vendorId) where.vendorId = vendorId;
      if (status) where.status = status;
      const items = await prisma.vendorQuote.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items };
    },
  );

  app.get(
    '/vendor-quotes/:id',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const quote = await prisma.vendorQuote.findUnique({
        where: { id },
      });
      if (!quote) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Vendor quote not found' },
        });
      }
      return quote;
    },
  );

  app.get(
    '/vendor-invoices',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { projectId, vendorId, status } = req.query as {
        projectId?: string;
        vendorId?: string;
        status?: string;
      };
      const where: Record<string, unknown> = {};
      if (projectId) where.projectId = projectId;
      if (vendorId) where.vendorId = vendorId;
      if (status) where.status = status;
      const items = await prisma.vendorInvoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items };
    },
  );

  app.get(
    '/vendor-invoices/:id',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = await prisma.vendorInvoice.findUnique({
        where: { id },
      });
      if (!invoice) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Vendor invoice not found' },
        });
      }
      return invoice;
    },
  );

  app.post(
    '/vendor-quotes',
    { preHandler: requireRole(['admin', 'mgmt']), schema: vendorQuoteSchema },
    async (req, reply) => {
      const body = req.body as any;
      const { projectExists, vendorExists } = await checkProjectAndVendor(
        body.projectId,
        body.vendorId,
      );
      if (!projectExists) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }
      if (!vendorExists) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Vendor not found' },
        });
      }
      const vendorQuote = await prisma.vendorQuote.create({
        data: {
          ...body,
          issueDate: parseDate(body.issueDate),
          currency: body.currency ?? 'JPY',
        },
      });
      return vendorQuote;
    },
  );

  app.post(
    '/vendor-invoices',
    { preHandler: requireRole(['admin', 'mgmt']), schema: vendorInvoiceSchema },
    async (req, reply) => {
      const body = req.body as any;
      const { projectExists, vendorExists } = await checkProjectAndVendor(
        body.projectId,
        body.vendorId,
      );
      if (!projectExists) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }
      if (!vendorExists) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Vendor not found' },
        });
      }
      const vi = await prisma.vendorInvoice.create({
        data: {
          ...body,
          receivedDate: parseDate(body.receivedDate),
          dueDate: parseDate(body.dueDate),
          currency: body.currency ?? 'JPY',
        },
      });
      return vi;
    },
  );

  app.post(
    '/vendor-invoices/:id/approve',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { id } = req.params as { id: string };
      const { updated } = await submitApprovalWithUpdate({
        flowType: FlowTypeValue.vendor_invoice,
        targetTable: 'vendor_invoices',
        targetId: id,
        update: (tx) =>
          tx.vendorInvoice.update({
            where: { id },
            data: { status: DocStatusValue.pending_qa },
          }),
        createdBy: req.user?.userId,
      });
      return updated;
    },
  );
}
