import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { requireProjectAccess, requireRole } from '../services/rbac.js';
import {
  projectSchema,
  projectPatchSchema,
  projectMemberSchema,
  projectMemberBulkSchema,
  recurringTemplateSchema,
  projectTaskSchema,
  projectTaskPatchSchema,
  projectTaskDependencySchema,
  projectBaselineSchema,
  projectMilestoneSchema,
  projectMilestonePatchSchema,
  deleteReasonSchema,
  reassignSchema,
} from './validators.js';
import { prisma } from '../services/db.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { parseDueDateRule } from '../services/dueDateRule.js';
import { toNumber } from '../services/utils.js';
import {
  addTaskDependency,
  buildTaskDependencyGraph,
  hasTaskDependencyPath,
  normalizeParentId,
  removeTaskDependency,
} from '../services/taskDependencyGraph.js';
import {
  addProjectMember,
  bulkAddProjectMembers,
  createProject,
  listProjectMemberCandidates,
  listProjectMembers,
  listProjects,
  reassignProjectTask,
  removeProjectMember,
  updateProject,
} from '../application/projects/useCases.js';

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

async function ensureProjectIdParam(req: any, reply: any) {
  const projectId = req?.params?.projectId;
  if (!projectId) {
    return reply.status(400).send({
      error: { code: 'INVALID_PROJECT', message: 'Project id is required' },
    });
  }
  return undefined;
}

function isPrivilegedRole(roles: string[]) {
  return roles.includes('admin') || roles.includes('mgmt');
}

function parseNullableDateField(body: any, key: string) {
  const hasProp = Object.prototype.hasOwnProperty.call(body, key);
  const value = hasProp ? (body[key] ? new Date(body[key]) : null) : undefined;
  return { hasProp, value };
}

function isStartDateAfterEndDate(
  startDate: Date | null | undefined,
  endDate: Date | null | undefined,
) {
  return (
    startDate instanceof Date &&
    endDate instanceof Date &&
    startDate.getTime() > endDate.getTime()
  );
}

function sendInvalidDateRangeError(
  reply: any,
  startField: string,
  endField: string,
) {
  return reply.status(400).send({
    error: {
      code: 'VALIDATION_ERROR',
      message: `${startField} must be before or equal to ${endField}`,
    },
  });
}

async function ensureProjectLeader(req: any, reply: any, projectId: string) {
  const userId = req.user?.userId;
  if (!userId) {
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  const leader = await prisma.projectMember.findFirst({
    where: { projectId, userId, role: 'leader' },
    select: { id: true },
  });
  if (!leader) {
    reply.code(403).send({ error: 'forbidden_project' });
    return false;
  }
  return true;
}

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

function projectActorFromRequest(req: any) {
  return {
    userId: req.user?.userId ?? null,
    roles: req.user?.roles || [],
    projectIds: req.user?.projectIds || [],
  };
}

function projectApplicationLogger(req: any) {
  return typeof req.log?.warn === 'function'
    ? { warn: req.log.warn.bind(req.log) }
    : undefined;
}

function sendApplicationResult(reply: any, result: any) {
  if (!result.ok) return reply.status(result.statusCode).send(result.body);
  return result.value;
}

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

  app.get(
    '/projects/:projectId/tasks',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
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
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
      schema: projectTaskSchema,
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as any;
      const parentTaskId = normalizeParentId(body.parentTaskId);
      const hasProgressPercentProp = Object.prototype.hasOwnProperty.call(
        body,
        'progressPercent',
      );
      const progressPercent = hasProgressPercentProp
        ? body.progressPercent
        : undefined;
      const { value: planStart } = parseNullableDateField(body, 'planStart');
      const { value: planEnd } = parseNullableDateField(body, 'planEnd');
      const { value: actualStart } = parseNullableDateField(
        body,
        'actualStart',
      );
      const { value: actualEnd } = parseNullableDateField(body, 'actualEnd');
      if (isStartDateAfterEndDate(planStart, planEnd)) {
        return sendInvalidDateRangeError(reply, 'planStart', 'planEnd');
      }
      if (isStartDateAfterEndDate(actualStart, actualEnd)) {
        return sendInvalidDateRangeError(reply, 'actualStart', 'actualEnd');
      }
      if (parentTaskId) {
        const parent = await prisma.projectTask.findUnique({
          where: { id: parentTaskId },
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
          parentTaskId,
          assigneeId: body.assigneeId,
          status: body.status,
          progressPercent: progressPercent ?? null,
          planStart: planStart ?? null,
          planEnd: planEnd ?? null,
          actualStart: actualStart ?? null,
          actualEnd: actualEnd ?? null,
        },
      });
      return task;
    },
  );

  app.patch(
    '/projects/:projectId/tasks/:taskId',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
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
      const hasProgressPercentProp = Object.prototype.hasOwnProperty.call(
        body,
        'progressPercent',
      );
      const progressPercent = hasProgressPercentProp
        ? body.progressPercent
        : undefined;
      const { hasProp: hasPlanStartProp, value: planStart } =
        parseNullableDateField(body, 'planStart');
      const { hasProp: hasPlanEndProp, value: planEnd } =
        parseNullableDateField(body, 'planEnd');
      const { hasProp: hasActualStartProp, value: actualStart } =
        parseNullableDateField(body, 'actualStart');
      const { hasProp: hasActualEndProp, value: actualEnd } =
        parseNullableDateField(body, 'actualEnd');
      const effectivePlanStart =
        planStart === undefined ? current.planStart : planStart;
      const effectivePlanEnd =
        planEnd === undefined ? current.planEnd : planEnd;
      if (isStartDateAfterEndDate(effectivePlanStart, effectivePlanEnd)) {
        return sendInvalidDateRangeError(reply, 'planStart', 'planEnd');
      }
      const effectiveActualStart =
        actualStart === undefined ? current.actualStart : actualStart;
      const effectiveActualEnd =
        actualEnd === undefined ? current.actualEnd : actualEnd;
      if (isStartDateAfterEndDate(effectiveActualStart, effectiveActualEnd)) {
        return sendInvalidDateRangeError(reply, 'actualStart', 'actualEnd');
      }
      const hasParentTaskIdProp = Object.prototype.hasOwnProperty.call(
        body,
        'parentTaskId',
      );
      const nextParentTaskId = hasParentTaskIdProp
        ? normalizeParentId(body.parentTaskId)
        : undefined;
      const currentParentTaskId = current.parentTaskId ?? null;
      const parentChanged =
        hasParentTaskIdProp && nextParentTaskId !== currentParentTaskId;
      const reasonText =
        typeof body.reasonText === 'string' ? body.reasonText.trim() : '';
      if (parentChanged && !reasonText) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_REASON',
            message: 'reasonText is required when changing task parent',
          },
        });
      }
      if (hasParentTaskIdProp) {
        if (nextParentTaskId === taskId) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Parent task cannot be self',
            },
          });
        }
        if (nextParentTaskId) {
          const parent = await prisma.projectTask.findUnique({
            where: { id: nextParentTaskId },
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
          if (await hasCircularParent(taskId, nextParentTaskId)) {
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
          parentTaskId: hasParentTaskIdProp ? nextParentTaskId : undefined,
          assigneeId: body.assigneeId,
          status: body.status,
          progressPercent: hasProgressPercentProp ? progressPercent : undefined,
          planStart: hasPlanStartProp ? planStart : undefined,
          planEnd: hasPlanEndProp ? planEnd : undefined,
          actualStart: hasActualStartProp ? actualStart : undefined,
          actualEnd: hasActualEndProp ? actualEnd : undefined,
        },
      });
      if (parentChanged) {
        await logAudit({
          action: 'project_task_parent_updated',
          targetTable: 'project_tasks',
          targetId: taskId,
          reasonText,
          metadata: {
            projectId,
            fromParentTaskId: currentParentTaskId,
            toParentTaskId: nextParentTaskId ?? null,
          },
          ...auditContextFromRequest(req),
        });
      }
      return task;
    },
  );

  app.get(
    '/projects/:projectId/tasks/:taskId/dependencies',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId, taskId } = req.params as {
        projectId: string;
        taskId: string;
      };
      const task = await prisma.projectTask.findUnique({
        where: { id: taskId },
        select: { id: true, projectId: true, deletedAt: true },
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
      const deps = await prisma.projectTaskDependency.findMany({
        where: { projectId, toTaskId: taskId, fromTask: { deletedAt: null } },
        select: { fromTaskId: true },
        orderBy: { createdAt: 'asc' },
      });
      return { predecessorIds: deps.map((dep) => dep.fromTaskId) };
    },
  );

  app.put(
    '/projects/:projectId/tasks/:taskId/dependencies',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
      schema: projectTaskDependencySchema,
    },
    async (req, reply) => {
      const { projectId, taskId } = req.params as {
        projectId: string;
        taskId: string;
      };
      const body = req.body as any;
      const rawPredecessorIds: unknown[] = Array.isArray(body.predecessorIds)
        ? body.predecessorIds
        : [];
      const predecessorIds: string[] = Array.from(
        new Set(
          rawPredecessorIds
            .map((value) => String(value).trim())
            .filter((value) => value.length > 0),
        ),
      );
      if (predecessorIds.includes(taskId)) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Task cannot depend on itself',
          },
        });
      }
      const task = await prisma.projectTask.findUnique({
        where: { id: taskId },
        select: { id: true, projectId: true, deletedAt: true },
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

      if (predecessorIds.length) {
        const predecessors = await prisma.projectTask.findMany({
          where: { id: { in: predecessorIds }, projectId, deletedAt: null },
          select: { id: true },
        });
        if (predecessors.length !== predecessorIds.length) {
          return reply.status(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'Predecessor task not found',
            },
          });
        }
      }

      const existing = await prisma.projectTaskDependency.findMany({
        where: { projectId, toTaskId: taskId },
        select: { fromTaskId: true },
      });
      const existingIds = new Set(existing.map((dep) => dep.fromTaskId));
      const desiredIds = new Set(predecessorIds);
      const toAdd = predecessorIds.filter((id) => !existingIds.has(id));
      const toRemove = Array.from(existingIds).filter(
        (id) => !desiredIds.has(id),
      );

      if (toAdd.length) {
        const edges = await prisma.projectTaskDependency.findMany({
          where: {
            projectId,
            fromTask: { deletedAt: null },
            toTask: { deletedAt: null },
          },
          select: { fromTaskId: true, toTaskId: true },
        });
        const graph = buildTaskDependencyGraph(edges);
        for (const fromTaskId of toRemove) {
          removeTaskDependency(graph, fromTaskId, taskId);
        }
        for (const fromTaskId of toAdd) {
          if (hasTaskDependencyPath(graph, taskId, fromTaskId)) {
            return reply.status(400).send({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Task dependency creates circular reference',
              },
            });
          }
          addTaskDependency(graph, fromTaskId, taskId);
        }
      }

      const userId = req.user?.userId;
      await prisma.$transaction(async (tx) => {
        if (toRemove.length) {
          await tx.projectTaskDependency.deleteMany({
            where: {
              projectId,
              toTaskId: taskId,
              fromTaskId: { in: toRemove },
            },
          });
        }
        if (toAdd.length) {
          await tx.projectTaskDependency.createMany({
            data: toAdd.map((fromTaskId) => ({
              projectId,
              fromTaskId,
              toTaskId: taskId,
              createdBy: userId,
            })),
            skipDuplicates: true,
          });
        }
      });

      return { predecessorIds, added: toAdd.length, removed: toRemove.length };
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
      return sendApplicationResult(
        reply,
        await reassignProjectTask({
          projectId,
          taskId,
          body: req.body as any,
          actor: projectActorFromRequest(req),
          auditContext: auditContextFromRequest(req),
        }),
      );
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
      const updated = await prisma.$transaction(async (tx) => {
        const updated = await tx.projectTask.update({
          where: { id: taskId },
          data: {
            deletedAt: new Date(),
            deletedReason: body.reason,
          },
        });
        await tx.projectTaskDependency.deleteMany({
          where: {
            projectId,
            OR: [{ fromTaskId: taskId }, { toTaskId: taskId }],
          },
        });
        return updated;
      });
      return updated;
    },
  );

  app.get(
    '/projects/:projectId/baselines',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, deletedAt: true },
      });
      if (!project || project.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }
      const items = await prisma.projectBaseline.findMany({
        where: { projectId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items };
    },
  );

  app.get(
    '/projects/:projectId/baselines/:baselineId',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId, baselineId } = req.params as {
        projectId: string;
        baselineId: string;
      };
      const baseline = await prisma.projectBaseline.findUnique({
        where: { id: baselineId },
        include: {
          tasks: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!baseline || baseline.projectId !== projectId) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Baseline not found' },
        });
      }
      if (baseline.deletedAt) {
        return reply.status(400).send({
          error: {
            code: 'ALREADY_DELETED',
            message: 'Baseline already deleted',
          },
        });
      }
      return baseline;
    },
  );

  app.post(
    '/projects/:projectId/baselines',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        ensureProjectIdParam,
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
      schema: projectBaselineSchema,
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const roles = req.user?.roles || [];
      const isPrivileged = isPrivilegedRole(roles);
      if (!isPrivileged) {
        const allowed = await ensureProjectLeader(req, reply, projectId);
        if (!allowed) return reply;
      }
      const body = req.body as any;
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const baselineName = name || `baseline-${new Date().toISOString()}`;
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          deletedAt: true,
          currency: true,
          planHours: true,
          budgetCost: true,
        },
      });
      if (!project || project.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }
      const tasks = await prisma.projectTask.findMany({
        where: { projectId, deletedAt: null },
        select: {
          id: true,
          name: true,
          status: true,
          planStart: true,
          planEnd: true,
          progressPercent: true,
        },
      });
      const createdBy = req.user?.userId;
      const baseline = await prisma.$transaction(async (tx) => {
        const baseline = await tx.projectBaseline.create({
          data: {
            projectId,
            name: baselineName,
            currency: project.currency,
            planHours: project.planHours,
            budgetCost: project.budgetCost,
            createdBy,
          },
        });
        if (tasks.length) {
          await tx.projectBaselineTask.createMany({
            data: tasks.map((task) => ({
              baselineId: baseline.id,
              taskId: task.id,
              name: task.name,
              status: task.status,
              planStart: task.planStart,
              planEnd: task.planEnd,
              progressPercent: task.progressPercent,
              createdBy,
            })),
            skipDuplicates: true,
          });
        }
        return baseline;
      });
      return { ...baseline, taskCount: tasks.length };
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
