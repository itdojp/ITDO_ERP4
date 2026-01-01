import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { requireRole } from '../services/rbac.js';
import {
  projectSchema,
  projectPatchSchema,
  recurringTemplateSchema,
  projectTaskSchema,
  projectTaskPatchSchema,
  projectMilestoneSchema,
  projectMilestonePatchSchema,
  deleteReasonSchema,
  reassignSchema,
} from './validators.js';
import { prisma } from '../services/db.js';
import { parseDueDateRule } from '../services/dueDateRule.js';

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

async function hasCircularParent(taskId: string, parentTaskId: string) {
  const visited = new Set<string>([taskId]);
  let currentId: string | null = parentTaskId;
  while (currentId) {
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    const current: { parentTaskId: string | null } | null =
      await prisma.projectTask.findUnique({
        where: { id: currentId },
        select: { parentTaskId: true },
      });
    if (!current) return false;
    currentId = current.parentTaskId;
  }
  return false;
}

export async function registerProjectRoutes(app: FastifyInstance) {
  app.get('/projects', async () => {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { items: projects };
  });

  app.post(
    '/projects',
    { preHandler: requireRole(['admin', 'mgmt']), schema: projectSchema },
    async (req, reply) => {
      const body = req.body as any;
      const hasCustomerIdProp = Object.prototype.hasOwnProperty.call(
        body,
        'customerId',
      );
      const customerId =
        hasCustomerIdProp && body.customerId !== ''
          ? (body.customerId ?? null)
          : null;
      if (customerId) {
        const customer = await prisma.customer.findUnique({
          where: { id: customerId },
          select: { id: true },
        });
        if (!customer) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Customer not found' },
          });
        }
      }
      const data = hasCustomerIdProp ? { ...body, customerId } : { ...body };
      const project = await prisma.project.create({ data });
      return project;
    },
  );

  app.patch(
    '/projects/:projectId',
    { preHandler: requireRole(['admin', 'mgmt']), schema: projectPatchSchema },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as any;
      const current = await prisma.project.findUnique({
        where: { id: projectId },
      });
      if (!current) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }
      const hasCustomerIdProp = Object.prototype.hasOwnProperty.call(
        body,
        'customerId',
      );
      const customerId =
        hasCustomerIdProp && body.customerId !== ''
          ? (body.customerId ?? null)
          : null;
      if (hasCustomerIdProp && customerId) {
        const customer = await prisma.customer.findUnique({
          where: { id: customerId },
          select: { id: true },
        });
        if (!customer) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Customer not found' },
          });
        }
      }
      const data = hasCustomerIdProp ? { ...body, customerId } : { ...body };
      const project = await prisma.project.update({
        where: { id: projectId },
        data,
      });
      return project;
    },
  );

  app.get(
    '/projects/:projectId/tasks',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const items = await prisma.projectTask.findMany({
        where: { projectId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return { items };
    },
  );

  app.post(
    '/projects/:projectId/tasks',
    { preHandler: requireRole(['admin', 'mgmt']), schema: projectTaskSchema },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as any;
      if (body.parentTaskId) {
        const parent = await prisma.projectTask.findUnique({
          where: { id: body.parentTaskId },
          select: { projectId: true, deletedAt: true },
        });
        if (!parent || parent.deletedAt) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Parent task not found' },
          });
        }
        if (parent.projectId !== projectId) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Parent task belongs to another project',
            },
          });
        }
      }
      const task = await prisma.projectTask.create({
        data: {
          projectId,
          name: body.name,
          parentTaskId: body.parentTaskId,
          assigneeId: body.assigneeId,
          status: body.status,
          planStart: body.planStart ? new Date(body.planStart) : null,
          planEnd: body.planEnd ? new Date(body.planEnd) : null,
          actualStart: body.actualStart ? new Date(body.actualStart) : null,
          actualEnd: body.actualEnd ? new Date(body.actualEnd) : null,
        },
      });
      return task;
    },
  );

  app.patch(
    '/projects/:projectId/tasks/:taskId',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: projectTaskPatchSchema,
    },
    async (req, reply) => {
      const { projectId, taskId } = req.params as {
        projectId: string;
        taskId: string;
      };
      const body = req.body as any;
      const current = await prisma.projectTask.findUnique({
        where: { id: taskId },
      });
      if (!current || current.projectId !== projectId) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Task not found' },
        });
      }
      if (current.deletedAt) {
        return reply.status(400).send({
          error: { code: 'ALREADY_DELETED', message: 'Task already deleted' },
        });
      }
      if (Object.prototype.hasOwnProperty.call(body, 'parentTaskId')) {
        if (body.parentTaskId === taskId) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Parent task cannot be self',
            },
          });
        }
        if (body.parentTaskId) {
          const parent = await prisma.projectTask.findUnique({
            where: { id: body.parentTaskId },
            select: { projectId: true, deletedAt: true },
          });
          if (!parent || parent.deletedAt) {
            return reply.status(404).send({
              error: { code: 'NOT_FOUND', message: 'Parent task not found' },
            });
          }
          if (parent.projectId !== projectId) {
            return reply.status(400).send({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Parent task belongs to another project',
              },
            });
          }
          if (await hasCircularParent(taskId, body.parentTaskId)) {
            return reply.status(400).send({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Parent task creates circular reference',
              },
            });
          }
        }
      }
      const task = await prisma.projectTask.update({
        where: { id: taskId },
        data: {
          name: body.name,
          parentTaskId: body.parentTaskId,
          assigneeId: body.assigneeId,
          status: body.status,
          planStart: body.planStart ? new Date(body.planStart) : undefined,
          planEnd: body.planEnd ? new Date(body.planEnd) : undefined,
          actualStart: body.actualStart
            ? new Date(body.actualStart)
            : undefined,
          actualEnd: body.actualEnd ? new Date(body.actualEnd) : undefined,
        },
      });
      return task;
    },
  );

  app.post(
    '/projects/:projectId/tasks/:taskId/reassign',
    { preHandler: requireRole(['admin', 'mgmt']), schema: reassignSchema },
    async (req, reply) => {
      const { projectId, taskId } = req.params as {
        projectId: string;
        taskId: string;
      };
      const body = req.body as any;
      const task = await prisma.projectTask.findUnique({
        where: { id: taskId },
      });
      if (!task || task.projectId !== projectId) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Task not found' },
        });
      }
      if (task.deletedAt) {
        return reply.status(400).send({
          error: { code: 'ALREADY_DELETED', message: 'Task already deleted' },
        });
      }
      const targetProject = await prisma.project.findUnique({
        where: { id: body.toProjectId },
        select: { id: true },
      });
      if (!targetProject) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Target project not found' },
        });
      }
      const [childCount, timeCount, estimateCount, invoiceCount, poCount] =
        await Promise.all([
          prisma.projectTask.count({
            where: { parentTaskId: taskId, deletedAt: null },
          }),
          prisma.timeEntry.count({
            where: { taskId, deletedAt: null },
          }),
          prisma.estimateLine.count({ where: { taskId } }),
          prisma.billingLine.count({ where: { taskId } }),
          prisma.purchaseOrderLine.count({ where: { taskId } }),
        ]);
      if (
        childCount > 0 ||
        timeCount > 0 ||
        estimateCount > 0 ||
        invoiceCount > 0 ||
        poCount > 0
      ) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Task has linked records and cannot be reassigned',
          },
        });
      }
      const updated = await prisma.projectTask.update({
        where: { id: taskId },
        data: {
          projectId: body.toProjectId,
        },
      });
      return updated;
    },
  );

  app.post(
    '/projects/:projectId/tasks/:taskId/delete',
    { preHandler: requireRole(['admin', 'mgmt']), schema: deleteReasonSchema },
    async (req, reply) => {
      const { projectId, taskId } = req.params as {
        projectId: string;
        taskId: string;
      };
      const body = req.body as any;
      const task = await prisma.projectTask.findUnique({
        where: { id: taskId },
      });
      if (!task || task.projectId !== projectId) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Task not found' },
        });
      }
      if (task.deletedAt) {
        return reply.status(400).send({
          error: { code: 'ALREADY_DELETED', message: 'Task already deleted' },
        });
      }
      const [childCount, timeCount, estimateCount, invoiceCount, poCount] =
        await Promise.all([
          prisma.projectTask.count({
            where: { parentTaskId: taskId, deletedAt: null },
          }),
          prisma.timeEntry.count({
            where: { taskId, deletedAt: null },
          }),
          prisma.estimateLine.count({ where: { taskId } }),
          prisma.billingLine.count({ where: { taskId } }),
          prisma.purchaseOrderLine.count({ where: { taskId } }),
        ]);
      if (
        childCount > 0 ||
        timeCount > 0 ||
        estimateCount > 0 ||
        invoiceCount > 0 ||
        poCount > 0
      ) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Task has linked records and cannot be deleted',
          },
        });
      }
      const updated = await prisma.projectTask.update({
        where: { id: taskId },
        data: {
          deletedAt: new Date(),
          deletedReason: body.reason,
        },
      });
      return updated;
    },
  );

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
}
