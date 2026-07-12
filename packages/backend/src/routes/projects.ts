import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { requireProjectAccess, requireRole } from '../services/rbac.js';
import {
  projectSchema,
  projectPatchSchema,
  projectMemberSchema,
  projectMemberBulkSchema,
  recurringTemplateSchema,
  projectMilestoneSchema,
  projectMilestonePatchSchema,
  deleteReasonSchema,
} from './validators.js';
import { prisma } from '../services/db.js';
import { auditContextFromRequest } from '../services/audit.js';
import { parseDueDateRule } from '../services/dueDateRule.js';
import { toNumber } from '../services/utils.js';
import {
  addProjectMember,
  bulkAddProjectMembers,
  createProject,
  listProjectMemberCandidates,
  listProjectMembers,
  listProjects,
  removeProjectMember,
  updateProject,
} from '../application/projects/useCases.js';
import { registerProjectTaskRoutes } from './projects/tasks.js';
import {
  ensureProjectIdParam,
  projectActorFromRequest,
  projectApplicationLogger,
  sendApplicationResult,
} from './projects/shared.js';

type RecurringFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual';
type BillUpon = 'date' | 'acceptance' | 'time';

type RecurringTemplateBody = {
  frequency: RecurringFrequency;
  nextRunAt?: string;
  timezone?: string;
  defaultAmount?: number;
  defaultCurrency?: string;
  defaultTaxRate?: number;
  defaultTerms?: string;
  defaultMilestoneName?: string;
  billUpon?: BillUpon;
  dueDateRule?: unknown;
  shouldGenerateEstimate?: boolean;
  shouldGenerateInvoice?: boolean;
  isActive?: boolean;
};

export async function registerProjectRoutes(app: FastifyInstance) {
  app.get(
    '/projects',
    { preHandler: requireRole(['admin', 'mgmt', 'user']) },
    async (req, reply) => {
      return sendApplicationResult(
        reply,
        await listProjects({ actor: projectActorFromRequest(req) }),
      );
    },
  );

  app.post(
    '/projects',
    { preHandler: requireRole(['admin', 'mgmt']), schema: projectSchema },
    async (req, reply) => {
      return sendApplicationResult(
        reply,
        await createProject({
          body: req.body as any,
          actor: projectActorFromRequest(req),
          logger: projectApplicationLogger(req),
        }),
      );
    },
  );

  app.patch(
    '/projects/:projectId',
    { preHandler: requireRole(['admin', 'mgmt']), schema: projectPatchSchema },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      return sendApplicationResult(
        reply,
        await updateProject({
          projectId,
          body: req.body as any,
          actor: projectActorFromRequest(req),
          auditContext: auditContextFromRequest(req),
          logger: projectApplicationLogger(req),
        }),
      );
    },
  );

  app.get(
    '/projects/:projectId/members',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      return sendApplicationResult(
        reply,
        await listProjectMembers({
          projectId,
          actor: projectActorFromRequest(req),
        }),
      );
    },
  );

  app.get(
    '/projects/:projectId/member-candidates',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { q } = req.query as { q?: string };
      return sendApplicationResult(
        reply,
        await listProjectMemberCandidates({
          projectId,
          query: q,
          actor: projectActorFromRequest(req),
        }),
      );
    },
  );

  app.post(
    '/projects/:projectId/members',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
      ],
      schema: projectMemberSchema,
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      return sendApplicationResult(
        reply,
        await addProjectMember({
          projectId,
          body: req.body as { userId: string; role?: 'member' | 'leader' },
          actor: projectActorFromRequest(req),
          auditContext: auditContextFromRequest(req),
          logger: projectApplicationLogger(req),
        }),
      );
    },
  );

  app.post(
    '/projects/:projectId/members/bulk',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
      ],
      schema: projectMemberBulkSchema,
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      return sendApplicationResult(
        reply,
        await bulkAddProjectMembers({
          projectId,
          body: req.body as {
            items: Array<{ userId: string; role?: 'member' | 'leader' }>;
          },
          actor: projectActorFromRequest(req),
          auditContext: auditContextFromRequest(req),
          logger: projectApplicationLogger(req),
        }),
      );
    },
  );

  app.delete(
    '/projects/:projectId/members/:userId',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
      ],
    },
    async (req, reply) => {
      const { projectId, userId: targetUserId } = req.params as {
        projectId: string;
        userId: string;
      };
      return sendApplicationResult(
        reply,
        await removeProjectMember({
          projectId,
          userId: targetUserId,
          actor: projectActorFromRequest(req),
          auditContext: auditContextFromRequest(req),
        }),
      );
    },
  );

  await registerProjectTaskRoutes(app);

  app.post(
    '/projects/:projectId/milestones',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: projectMilestoneSchema,
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as any;
      const milestone = await prisma.projectMilestone.create({
        data: {
          projectId,
          name: body.name,
          amount: body.amount,
          billUpon: body.billUpon || 'date',
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          taxRate: body.taxRate,
        },
      });
      return milestone;
    },
  );

  app.get(
    '/projects/:projectId/milestones',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const items = await prisma.projectMilestone.findMany({
        where: { projectId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return { items };
    },
  );

  app.patch(
    '/projects/:projectId/milestones/:milestoneId',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: projectMilestonePatchSchema,
    },
    async (req, reply) => {
      const { projectId, milestoneId } = req.params as {
        projectId: string;
        milestoneId: string;
      };
      const body = req.body as any;
      const milestone = await prisma.projectMilestone.findUnique({
        where: { id: milestoneId },
      });
      if (!milestone || milestone.projectId !== projectId) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Milestone not found' },
        });
      }
      if (milestone.deletedAt) {
        return reply.status(400).send({
          error: {
            code: 'ALREADY_DELETED',
            message: 'Milestone already deleted',
          },
        });
      }
      const lockedInvoice = await prisma.invoice.findFirst({
        where: {
          milestoneId,
          deletedAt: null,
          status: { not: 'draft' },
        },
        select: { id: true },
      });
      if (lockedInvoice) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Milestone has submitted invoices and cannot be updated',
          },
        });
      }
      const updated = await prisma.projectMilestone.update({
        where: { id: milestoneId },
        data: {
          name: body.name,
          amount: body.amount,
          billUpon: body.billUpon,
          dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
          taxRate: body.taxRate,
        },
      });
      if (typeof body.amount === 'number') {
        const draftInvoices = await prisma.invoice.findMany({
          where: { milestoneId, deletedAt: null, status: 'draft' },
          select: {
            id: true,
            totalAmount: true,
            lines: { select: { id: true, quantity: true, unitPrice: true } },
          },
        });
        const amountTolerance = 0.0001;
        const updates: Prisma.PrismaPromise<unknown>[] = [];
        const updatedInvoiceIds: string[] = [];
        for (const invoice of draftInvoices) {
          if (invoice.lines.length !== 1) {
            console.warn('[milestone] invoice sync skipped', {
              invoiceId: invoice.id,
              reason: 'line_count',
              lineCount: invoice.lines.length,
            });
            continue;
          }
          const line = invoice.lines[0];
          if (!line) continue;
          const quantity = toNumber(line.quantity);
          if (quantity !== 1) {
            console.warn('[milestone] invoice sync skipped', {
              invoiceId: invoice.id,
              reason: 'quantity',
              quantity,
            });
            continue;
          }
          const lineTotal = quantity * toNumber(line.unitPrice);
          const invoiceTotal = toNumber(invoice.totalAmount);
          if (Math.abs(lineTotal - invoiceTotal) > amountTolerance) {
            console.warn('[milestone] invoice sync skipped', {
              invoiceId: invoice.id,
              reason: 'manual_adjustment',
              lineTotal,
              invoiceTotal,
            });
            continue;
          }
          updates.push(
            prisma.billingLine.update({
              where: { id: line.id },
              data: { unitPrice: body.amount },
            }),
            prisma.invoice.update({
              where: { id: invoice.id },
              data: { totalAmount: body.amount },
            }),
          );
          updatedInvoiceIds.push(invoice.id);
        }
        if (updates.length) {
          try {
            await prisma.$transaction(updates);
          } catch (err) {
            console.error('[milestone] invoice sync failed', {
              milestoneId,
              invoiceIds: updatedInvoiceIds,
              error: err,
            });
          }
        }
      }
      return updated;
    },
  );

  app.post(
    '/projects/:projectId/milestones/:milestoneId/delete',
    { preHandler: requireRole(['admin', 'mgmt']), schema: deleteReasonSchema },
    async (req, reply) => {
      const { projectId, milestoneId } = req.params as {
        projectId: string;
        milestoneId: string;
      };
      const body = req.body as any;
      const milestone = await prisma.projectMilestone.findUnique({
        where: { id: milestoneId },
      });
      if (!milestone || milestone.projectId !== projectId) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Milestone not found' },
        });
      }
      if (milestone.deletedAt) {
        return reply.status(400).send({
          error: {
            code: 'ALREADY_DELETED',
            message: 'Milestone already deleted',
          },
        });
      }
      const linkedInvoice = await prisma.invoice.findFirst({
        where: {
          milestoneId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (linkedInvoice) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Milestone has linked invoices and cannot be deleted',
          },
        });
      }
      const updated = await prisma.projectMilestone.update({
        where: { id: milestoneId },
        data: {
          deletedAt: new Date(),
          deletedReason: body.reason,
        },
      });
      return updated;
    },
  );

  app.get(
    '/projects/:id/recurring-template',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const params = req.params as { id: string };
      const template = await prisma.recurringProjectTemplate.findUnique({
        where: { projectId: params.id },
      });
      return template;
    },
  );

  app.post(
    '/projects/:id/recurring-template',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: recurringTemplateSchema,
    },
    async (req, reply) => {
      const params = req.params as { id: string };
      const body = req.body as RecurringTemplateBody;
      const project = await prisma.project.findUnique({
        where: { id: params.id },
        select: { id: true },
      });
      if (!project) {
        return reply.code(404).send({ error: 'not_found' });
      }
      let dueDateRule: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined;
      if (Object.prototype.hasOwnProperty.call(body, 'dueDateRule')) {
        try {
          const parsed = parseDueDateRule(body.dueDateRule);
          dueDateRule =
            parsed === null ? Prisma.DbNull : (parsed as Prisma.InputJsonValue);
        } catch (err) {
          req.log.error({ err }, 'Failed to parse dueDateRule');
          return reply.code(400).send({
            error: {
              code: 'INVALID_DUE_DATE_RULE',
              message: 'dueDateRule is invalid',
              details: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }
      const data = {
        frequency: body.frequency,
        nextRunAt: body.nextRunAt ? new Date(body.nextRunAt) : undefined,
        timezone: body.timezone,
        defaultAmount: body.defaultAmount,
        defaultCurrency: body.defaultCurrency,
        defaultTaxRate: body.defaultTaxRate,
        defaultTerms: body.defaultTerms,
        defaultMilestoneName: body.defaultMilestoneName,
        billUpon: body.billUpon,
        dueDateRule,
        shouldGenerateEstimate: body.shouldGenerateEstimate,
        shouldGenerateInvoice: body.shouldGenerateInvoice,
        isActive: body.isActive,
      };
      const template = await prisma.recurringProjectTemplate.upsert({
        where: { projectId: params.id },
        create: {
          projectId: params.id,
          ...data,
        },
        update: data,
      });
      return template;
    },
  );

  app.get(
    '/projects/:id/recurring-generation-logs',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const project = await prisma.project.findUnique({
        where: { id },
        select: { id: true, deletedAt: true },
      });
      if (!project || project.deletedAt) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const { limit, templateId, periodKey } = req.query as {
        limit?: string;
        templateId?: string;
        periodKey?: string;
      };
      const takeRaw = limit ? Number(limit) : 50;
      const take =
        Number.isFinite(takeRaw) && takeRaw > 0
          ? Math.min(Math.floor(takeRaw), 200)
          : 50;
      const where: Record<string, unknown> = { projectId: id };
      if (templateId) where.templateId = templateId;
      if (periodKey) where.periodKey = periodKey;
      const items = await prisma.recurringGenerationLog.findMany({
        where,
        orderBy: [{ runAt: 'desc' }, { createdAt: 'desc' }],
        take,
      });
      return { items };
    },
  );
}
