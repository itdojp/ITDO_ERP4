import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  timeEntryPatchSchema,
  timeEntryReassignSchema,
  timeEntrySchema,
} from './validators.js';
import { TimeStatusValue } from '../types.js';
import { requireProjectAccess, requireRole } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import {
  patchTimeEntry,
  reassignTimeEntry,
  submitTimeEntry,
  type TimeEntryActorContext,
  type TimeEntryApplicationResult,
} from '../application/timeEntries/useCases.js';
import { auditContextFromRequest } from '../services/audit.js';
import { parseDateParam } from '../utils/date.js';

async function validateTaskId(
  taskId: unknown,
  projectId: string | undefined,
  reply: FastifyReply,
): Promise<string | FastifyReply> {
  if (taskId == null) {
    return reply.status(400).send({
      error: { code: 'INVALID_TASK', message: 'Task id is missing' },
    });
  }
  const trimmed = String(taskId).trim();
  if (!trimmed) {
    return reply.status(400).send({
      error: { code: 'INVALID_TASK', message: 'Task id is empty' },
    });
  }
  const task = await prisma.projectTask.findUnique({
    where: { id: trimmed },
    select: { projectId: true, deletedAt: true },
  });
  if (!task || task.deletedAt) {
    return reply.status(400).send({
      error: { code: 'INVALID_TASK', message: 'Task not found' },
    });
  }
  if (projectId && task.projectId !== projectId) {
    return reply.status(400).send({
      error: {
        code: 'TASK_PROJECT_MISMATCH',
        message: 'Task does not belong to project',
      },
    });
  }
  return trimmed;
}

function timeEntryActorFromRequest(req: FastifyRequest): TimeEntryActorContext {
  return {
    userId: req.user?.userId ?? null,
    roles: req.user?.roles ?? [],
    groupIds: req.user?.groupIds ?? [],
    groupAccountIds: req.user?.groupAccountIds ?? [],
    projectIds: req.user?.projectIds ?? [],
  };
}

function sendTimeEntryApplicationResult<T>(
  reply: FastifyReply,
  result: TimeEntryApplicationResult<T>,
): T | FastifyReply {
  if (!result.ok) {
    return reply.status(result.statusCode).send(result.body);
  }
  return result.value;
}

export async function registerTimeEntryRoutes(app: FastifyInstance) {
  app.post(
    '/time-entries',
    {
      schema: timeEntrySchema,
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        requireProjectAccess((req) => (req.body as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const body = req.body as any;
      const roles = req.user?.roles || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      const currentUserId = req.user?.userId;
      if (!isPrivileged) {
        if (!currentUserId) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        body.userId = currentUserId;
      }
      const workDate = parseDateParam(body.workDate);
      if (!workDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid workDate' },
        });
      }
      let taskId = undefined as string | undefined;
      if (body.taskId !== undefined) {
        const resolved = await validateTaskId(
          body.taskId,
          body.projectId,
          reply,
        );
        if (typeof resolved !== 'string') return resolved;
        taskId = resolved;
      }
      const entry = await prisma.timeEntry.create({
        data: { ...body, taskId, workDate, status: TimeStatusValue.submitted },
      });
      return entry;
    },
  );

  app.patch(
    '/time-entries/:id',
    {
      schema: timeEntryPatchSchema,
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        requireProjectAccess((req) => (req.body as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await patchTimeEntry({
        id,
        body: req.body as Record<string, unknown>,
        actor: timeEntryActorFromRequest(req),
        auditContext: auditContextFromRequest(req, {
          userId: req.user?.userId,
        }),
      });
      return sendTimeEntryApplicationResult(reply, result);
    },
  );

  app.get(
    '/time-entries',
    {
      preHandler: [
        requireRole(['admin', 'mgmt', 'user']),
        requireProjectAccess((req) => (req.query as any)?.projectId),
      ],
    },
    async (req) => {
      const { projectId, userId, from, to } = req.query as {
        projectId?: string;
        userId?: string;
        from?: string;
        to?: string;
      };
      const roles = req.user?.roles || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      const currentUserId = req.user?.userId;
      const projectIds = req.user?.projectIds || [];
      const where: any = {};
      if (projectId) {
        where.projectId = projectId;
      } else if (!isPrivileged) {
        if (!projectIds.length) return { items: [] };
        where.projectId = { in: projectIds };
      }
      if (!isPrivileged) {
        where.userId = currentUserId;
      } else if (userId) {
        where.userId = userId;
      }
      if (from || to) {
        where.workDate = {};
        if (from) where.workDate.gte = new Date(from);
        if (to) where.workDate.lte = new Date(to);
      }
      const entries = await prisma.timeEntry.findMany({
        where,
        orderBy: { workDate: 'desc' },
        take: 200,
      });
      return { items: entries };
    },
  );

  app.post(
    '/time-entries/:id/submit',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await submitTimeEntry({
        id,
        body: req.body as Record<string, unknown> | null | undefined,
        actor: timeEntryActorFromRequest(req),
        auditContext: auditContextFromRequest(req),
      });
      return sendTimeEntryApplicationResult(reply, result);
    },
  );

  app.post(
    '/time-entries/:id/reassign',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: timeEntryReassignSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await reassignTimeEntry({
        id,
        body: req.body as Record<string, unknown>,
        actor: timeEntryActorFromRequest(req),
        auditContext: auditContextFromRequest(req),
      });
      return sendTimeEntryApplicationResult(reply, result);
    },
  );
}
