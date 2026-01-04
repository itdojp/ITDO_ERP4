import { FastifyInstance, FastifyReply } from 'fastify';
import {
  timeEntryPatchSchema,
  timeEntryReassignSchema,
  timeEntrySchema,
} from './validators.js';
import { DocStatusValue, TimeStatusValue } from '../types.js';
import {
  requireProjectAccess,
  requireRole,
  requireRoleOrSelf,
} from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { logAudit } from '../services/audit.js';
import { submitApprovalWithUpdate } from '../services/approval.js';
import { FlowTypeValue } from '../types.js';
import { parseDateParam } from '../utils/date.js';
import { findPeriodLock, toPeriodKey } from '../services/periodLock.js';

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

async function resolveReassignTaskId(
  value: unknown,
  projectId: string,
  reply: FastifyReply,
): Promise<string | null | undefined | FastifyReply> {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const task = await prisma.projectTask.findUnique({
    where: { id: trimmed },
    select: { projectId: true, deletedAt: true },
  });
  if (!task || task.deletedAt) {
    return reply.status(400).send({
      error: { code: 'INVALID_TASK', message: 'Task not found' },
    });
  }
  if (task.projectId !== projectId) {
    return reply.status(400).send({
      error: {
        code: 'TASK_PROJECT_MISMATCH',
        message: 'Task does not belong to project',
      },
    });
  }
  return trimmed;
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
        requireRoleOrSelf(
          ['admin', 'mgmt'],
          (req) => (req.body as any)?.userId,
        ),
        requireProjectAccess((req) => (req.body as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      const before = await prisma.timeEntry.findUnique({ where: { id } });
      if (!before) {
        return { error: 'not_found' };
      }
      const userId = req.user?.userId;
      const changed = ['minutes', 'workDate', 'taskId', 'projectId'].some(
        (k) => body[k] !== undefined && (body as any)[k] !== (before as any)[k],
      );
      const data = { ...body } as any;
      if (body.taskId !== undefined) {
        const resolved = await validateTaskId(
          body.taskId,
          body.projectId ?? before.projectId,
          reply,
        );
        if (typeof resolved !== 'string') return resolved;
        data.taskId = resolved;
      }
      if (body.workDate !== undefined) {
        const parsed = parseDateParam(body.workDate);
        if (!parsed) {
          return reply.status(400).send({
            error: { code: 'INVALID_DATE', message: 'Invalid workDate' },
          });
        }
        data.workDate = parsed;
      }
      if (changed) {
        data.status = TimeStatusValue.submitted;
        const { updated } = await submitApprovalWithUpdate({
          flowType: FlowTypeValue.time,
          targetTable: 'time_entries',
          targetId: id,
          update: (tx) => tx.timeEntry.update({ where: { id }, data }),
          createdBy: userId,
        });
        // 監査ログ: 修正が承認待ちになったことを記録
        const { logAudit } = await import('../services/audit.js');
        await logAudit({
          action: 'time_entry_modified',
          userId,
          targetTable: 'time_entries',
          targetId: id,
          metadata: { changedFields: Object.keys(body) },
        });
        return updated;
      }
      const entry = await prisma.timeEntry.update({ where: { id }, data });
      return entry;
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
      const currentUserId = req.user?.userId;
      const where: any = {};
      if (projectId) where.projectId = projectId;
      if (!roles.includes('admin') && !roles.includes('mgmt')) {
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
    async (req) => {
      const { id } = req.params as { id: string };
      const entry = await prisma.timeEntry.update({
        where: { id },
        data: { status: TimeStatusValue.submitted },
      });
      return entry;
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
      const body = req.body as any;
      const reasonText =
        typeof body.reasonText === 'string' ? body.reasonText.trim() : '';
      if (!reasonText) {
        return reply.status(400).send({
          error: { code: 'INVALID_REASON', message: 'reasonText is required' },
        });
      }
      const entry = await prisma.timeEntry.findUnique({ where: { id } });
      if (!entry) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Time entry not found' },
        });
      }
      if (entry.deletedAt) {
        return reply.status(400).send({
          error: { code: 'ALREADY_DELETED', message: 'Time entry deleted' },
        });
      }
      if (entry.status === TimeStatusValue.approved) {
        return reply.status(400).send({
          error: { code: 'INVALID_STATUS', message: 'Time entry approved' },
        });
      }
      const pendingApproval = await prisma.approvalInstance.findFirst({
        where: {
          targetTable: 'time_entries',
          targetId: id,
          status: {
            in: [DocStatusValue.pending_qa, DocStatusValue.pending_exec],
          },
        },
        select: { id: true },
      });
      if (pendingApproval) {
        return reply.status(400).send({
          error: { code: 'PENDING_APPROVAL', message: 'Approval in progress' },
        });
      }
      const targetProject = await prisma.project.findUnique({
        where: { id: body.toProjectId },
        select: { id: true, deletedAt: true },
      });
      if (!targetProject || targetProject.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
      }
      const periodKey = toPeriodKey(entry.workDate);
      const fromLock = await findPeriodLock(periodKey, entry.projectId);
      if (fromLock) {
        return reply.status(400).send({
          error: { code: 'PERIOD_LOCKED', message: 'Period is locked' },
        });
      }
      if (body.toProjectId !== entry.projectId) {
        const toLock = await findPeriodLock(periodKey, body.toProjectId);
        if (toLock) {
          return reply.status(400).send({
            error: { code: 'PERIOD_LOCKED', message: 'Period is locked' },
          });
        }
      }
      const resolvedTaskId = await resolveReassignTaskId(
        body.toTaskId,
        body.toProjectId,
        reply,
      );
      if (resolvedTaskId && typeof resolvedTaskId !== 'string') {
        return resolvedTaskId;
      }
      let nextTaskId = entry.taskId;
      if (resolvedTaskId !== undefined) {
        nextTaskId = resolvedTaskId;
      } else if (body.toProjectId !== entry.projectId) {
        nextTaskId = null;
      }
      const updated = await prisma.timeEntry.update({
        where: { id },
        data: { projectId: body.toProjectId, taskId: nextTaskId },
      });
      await logAudit({
        action: 'reassignment',
        userId: req.user?.userId,
        targetTable: 'time_entries',
        targetId: id,
        metadata: {
          fromProjectId: entry.projectId,
          toProjectId: body.toProjectId,
          fromTaskId: entry.taskId,
          toTaskId: nextTaskId,
          reasonCode: body.reasonCode,
          reasonText,
        },
      });
      return updated;
    },
  );
}
