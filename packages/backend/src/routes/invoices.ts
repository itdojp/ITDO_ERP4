import { FastifyInstance } from 'fastify';
import { nextNumber } from '../services/numbering.js';
import { submitApprovalWithUpdate } from '../services/approval.js';
import { FlowTypeValue, DocStatusValue } from '../types.js';
import { invoiceSchema } from './validators.js';
import { requireProjectAccess, requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';

export async function registerInvoiceRoutes(app: FastifyInstance) {
  const parseDate = (value?: string) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  };

  app.get(
    '/invoices',
    { preHandler: requireRole(['admin', 'mgmt', 'user']) },
    async (req, reply) => {
      const { projectId, status, from, to } = req.query as {
        projectId?: string;
        status?: string;
        from?: string;
        to?: string;
      };
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      if (!isPrivileged) {
        if (!projectIds.length) return { items: [] };
        if (projectId && !projectIds.includes(projectId)) {
          return reply.code(403).send({ error: 'forbidden_project' });
        }
      }
      const where: Record<string, unknown> = {};
      if (projectId) {
        where.projectId = projectId;
      } else if (!isPrivileged) {
        where.projectId = { in: projectIds };
      }
      if (status) where.status = status;
      if (from || to) {
        const fromDate = parseDate(from);
        const toDate = parseDate(to);
        if (from && !fromDate) {
          return reply.status(400).send({
            error: { code: 'INVALID_DATE', message: 'Invalid from date' },
          });
        }
        if (to && !toDate) {
          return reply.status(400).send({
            error: { code: 'INVALID_DATE', message: 'Invalid to date' },
          });
        }
        const issueDate: { gte?: Date; lte?: Date } = {};
        if (fromDate) issueDate.gte = fromDate;
        if (toDate) issueDate.lte = toDate;
        where.issueDate = issueDate;
      }
      const items = await prisma.invoice.findMany({
        where,
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items };
    },
  );

  app.get(
    '/invoices/:id',
    { preHandler: requireRole(['admin', 'mgmt', 'user']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = await prisma.invoice.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!invoice) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Invoice not found' },
        });
      }
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      if (!isPrivileged && !projectIds.includes(invoice.projectId)) {
        return reply.code(403).send({ error: 'forbidden_project' });
      }
      return invoice;
    },
  );

  app.get(
    '/projects/:projectId/invoices',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { status, from, to } = req.query as {
        status?: string;
        from?: string;
        to?: string;
      };
      const where: Record<string, unknown> = { projectId };
      if (status) where.status = status;
      if (from || to) {
        const fromDate = parseDate(from);
        const toDate = parseDate(to);
        if (from && !fromDate) {
          return reply.status(400).send({
            error: { code: 'INVALID_DATE', message: 'Invalid from date' },
          });
        }
        if (to && !toDate) {
          return reply.status(400).send({
            error: { code: 'INVALID_DATE', message: 'Invalid to date' },
          });
        }
        const issueDate: { gte?: Date; lte?: Date } = {};
        if (fromDate) issueDate.gte = fromDate;
        if (toDate) issueDate.lte = toDate;
        where.issueDate = issueDate;
      }
      const items = await prisma.invoice.findMany({
        where,
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items };
    },
  );

  app.post(
    '/projects/:projectId/invoices',
    { preHandler: requireRole(['admin', 'mgmt']), schema: invoiceSchema },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as any;
      const now = new Date();
      const { number, serial } = await nextNumber('invoice', now);
      const invoice = await prisma.invoice.create({
        data: {
          projectId,
          estimateId: body.estimateId,
          milestoneId: body.milestoneId,
          invoiceNo: number,
          issueDate: body.issueDate ? new Date(body.issueDate) : now,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          currency: body.currency || 'JPY',
          totalAmount: body.totalAmount,
          status: DocStatusValue.draft,
          numberingSerial: serial,
          lines: { create: body.lines || [] },
        },
        include: { lines: true },
      });
      return invoice;
    },
  );

  app.post(
    '/invoices/:id/submit',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { id } = req.params as { id: string };
      const { updated } = await submitApprovalWithUpdate({
        flowType: FlowTypeValue.invoice,
        targetTable: 'invoices',
        targetId: id,
        update: (tx) =>
          tx.invoice.update({
            where: { id },
            data: { status: DocStatusValue.pending_qa },
          }),
        createdBy: req.user?.userId,
      });
      return updated;
    },
  );
}
