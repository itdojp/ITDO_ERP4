import { FastifyInstance } from 'fastify';
import { nextNumber } from '../services/numbering.js';
import { submitApprovalWithUpdate } from '../services/approval.js';
import { FlowTypeValue, DocStatusValue, TimeStatusValue } from '../types.js';
import { invoiceFromTimeEntriesSchema, invoiceSchema } from './validators.js';
import { requireProjectAccess, requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { endOfDay, parseDateParam } from '../utils/date.js';

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
    '/projects/:projectId/invoices/from-time-entries',
    {
      preHandler: [
        requireRole(['admin', 'mgmt']),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
      schema: invoiceFromTimeEntriesSchema,
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as any;
      const fromDate = parseDateParam(body.from);
      const toDate = parseDateParam(body.to);
      if (!fromDate || !toDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'from/to are required' },
        });
      }
      const toDateEnd = endOfDay(toDate);
      if (fromDate.getTime() > toDateEnd.getTime()) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE_RANGE', message: 'from must be <= to' },
        });
      }
      const unitPrice = Number(body.unitPrice);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_UNIT_PRICE',
            message: 'unitPrice must be > 0',
          },
        });
      }
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, deletedAt: true, currency: true },
      });
      if (!project || project.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }
      const currency =
        typeof body.currency === 'string' && body.currency.trim()
          ? body.currency.trim()
          : project.currency || 'JPY';
      const issueDate = body.issueDate
        ? parseDate(String(body.issueDate))
        : null;
      const dueDate = body.dueDate ? parseDate(String(body.dueDate)) : null;
      if (body.issueDate && !issueDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid issueDate' },
        });
      }
      if (body.dueDate && !dueDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid dueDate' },
        });
      }

      const timeEntries = await prisma.timeEntry.findMany({
        where: {
          projectId,
          deletedAt: null,
          billedInvoiceId: null,
          status: { in: [TimeStatusValue.submitted, TimeStatusValue.approved] },
          workDate: { gte: fromDate, lte: toDateEnd },
        },
        select: {
          id: true,
          taskId: true,
          workType: true,
          minutes: true,
          workDate: true,
        },
      });
      if (!timeEntries.length) {
        return reply.status(400).send({
          error: { code: 'NO_TIME_ENTRIES', message: 'No time entries found' },
        });
      }

      const pendingApprovals = await prisma.approvalInstance.findMany({
        where: {
          targetTable: 'time_entries',
          targetId: { in: timeEntries.map((entry) => entry.id) },
          status: {
            in: [DocStatusValue.pending_qa, DocStatusValue.pending_exec],
          },
        },
        select: { targetId: true },
      });
      const pendingIds = new Set(pendingApprovals.map((row) => row.targetId));
      const eligible = timeEntries.filter((entry) => !pendingIds.has(entry.id));
      if (!eligible.length) {
        return reply.status(400).send({
          error: {
            code: 'NO_ELIGIBLE_TIME_ENTRIES',
            message: 'All time entries are pending approval',
          },
        });
      }

      const taskIds = Array.from(
        new Set(eligible.map((entry) => entry.taskId).filter(Boolean)),
      ) as string[];
      const tasks = taskIds.length
        ? await prisma.projectTask.findMany({
            where: { id: { in: taskIds }, deletedAt: null },
            select: { id: true, name: true },
          })
        : [];
      const taskNameMap = new Map(tasks.map((task) => [task.id, task.name]));

      const groups = new Map<
        string,
        { taskId: string | null; workType: string | null; minutes: number }
      >();
      for (const entry of eligible) {
        const taskId = entry.taskId ?? null;
        const workType = entry.workType?.trim() ? entry.workType.trim() : null;
        const key = `${taskId ?? ''}::${workType ?? ''}`;
        const current = groups.get(key) ?? { taskId, workType, minutes: 0 };
        current.minutes += entry.minutes || 0;
        groups.set(key, current);
      }

      const lines = Array.from(groups.values())
        .filter((group) => group.minutes > 0)
        .map((group) => {
          const taskName = group.taskId
            ? taskNameMap.get(group.taskId) || 'タスク'
            : 'タスクなし';
          const workTypeLabel = group.workType ? ` / ${group.workType}` : '';
          const quantityHours = group.minutes / 60;
          return {
            description: `工数 ${taskName}${workTypeLabel}`,
            quantity: Number(quantityHours.toFixed(2)),
            unitPrice,
            taxRate: null,
            taskId: group.taskId,
            timeEntryRange: `${body.from}..${body.to}`,
          };
        });
      if (!lines.length) {
        return reply.status(400).send({
          error: { code: 'NO_BILLABLE_TIME', message: 'Total minutes is 0' },
        });
      }
      const totalAmount = lines.reduce(
        (sum, line) => sum + Number(line.quantity) * unitPrice,
        0,
      );
      const now = new Date();
      const { number, serial } = await nextNumber('invoice', now);
      const eligibleIds = eligible.map((entry) => entry.id);
      const invoice = await prisma.$transaction(async (tx) => {
        const created = await tx.invoice.create({
          data: {
            projectId,
            invoiceNo: number,
            issueDate: issueDate ?? now,
            dueDate: dueDate ?? null,
            currency,
            totalAmount,
            status: DocStatusValue.draft,
            numberingSerial: serial,
            lines: { create: lines },
          },
          include: { lines: true },
        });
        const updated = await tx.timeEntry.updateMany({
          where: { id: { in: eligibleIds }, billedInvoiceId: null },
          data: { billedInvoiceId: created.id, billedAt: now },
        });
        if (updated.count !== eligibleIds.length) {
          throw new Error('time_entries_conflict');
        }
        return created;
      });
      return { invoice, meta: { timeEntryCount: eligibleIds.length } };
    },
  );

  app.post(
    '/invoices/:id/release-time-entries',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoice = await prisma.invoice.findUnique({
        where: { id },
        select: { id: true, status: true },
      });
      if (!invoice) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Invoice not found' },
        });
      }
      if (invoice.status !== DocStatusValue.draft) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_STATUS',
            message: 'Only a draft invoice can release time entries',
          },
        });
      }
      const updated = await prisma.timeEntry.updateMany({
        where: { billedInvoiceId: id },
        data: { billedInvoiceId: null, billedAt: null },
      });
      return { released: updated.count };
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
