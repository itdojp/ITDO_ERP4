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
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { logReassignment } from '../services/reassignmentLog.js';
import { submitApprovalWithUpdate } from '../services/approval.js';
import { FlowTypeValue } from '../types.js';
import { isWithinEditableDays, parseDateParam } from '../utils/date.js';
import { findPeriodLock, toPeriodKey } from '../services/periodLock.js';
import { getEditableDays } from '../services/worklogSetting.js';
import { evaluateActionPolicyWithFallback } from '../services/actionPolicy.js';

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
      const body = req.body as any;
      const reasonText =
        typeof body.reasonText === 'string' ? body.reasonText.trim() : '';
      const { reasonText: _omitReason, ...rest } = body;
      const roles = req.user?.roles || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      const userId = req.user?.userId;
      const where = isPrivileged ? { id } : { id, userId: userId || 'unknown' };
      const before = await prisma.timeEntry.findFirst({ where });
      if (!before) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (!isPrivileged) {
        const projectIds = req.user?.projectIds || [];
        if (!projectIds.length || !projectIds.includes(before.projectId)) {
          return reply.code(403).send({ error: 'forbidden_project' });
        }
      }
      if (before.billedInvoiceId) {
        const immutableFields = [
          'projectId',
          'taskId',
          'workDate',
          'minutes',
          'workType',
          'userId',
        ] as const;
        const hasImmutableUpdate = immutableFields.some(
          (field) => body[field] !== undefined,
        );
        if (hasImmutableUpdate) {
          return reply.status(400).send({
            error: {
              code: 'BILLED',
              message: 'Time entry already billed and cannot be modified',
            },
          });
        }
      }
      const changed = ['minutes', 'workDate', 'taskId', 'projectId'].some(
        (k) => rest[k] !== undefined && (rest as any)[k] !== (before as any)[k],
      );
      const data = { ...rest } as any;
      if (!isPrivileged) {
        data.userId = userId;
      }
      if (body.taskId !== undefined) {
        const resolved = await validateTaskId(
          body.taskId,
          body.projectId ?? before.projectId,
          reply,
        );
        if (typeof resolved !== 'string') return resolved;
        data.taskId = resolved;
      }
      if (rest.workDate !== undefined) {
        const parsed = parseDateParam(rest.workDate);
        if (!parsed) {
          return reply.status(400).send({
            error: { code: 'INVALID_DATE', message: 'Invalid workDate' },
          });
        }
        data.workDate = parsed;
      }
      const editableDays = await getEditableDays();
      const now = new Date();
      const workDatesToCheck = [
        before.workDate,
        data.workDate ?? undefined,
      ].filter((value): value is Date => value instanceof Date);
      const isEditableByDate = workDatesToCheck.every((date) =>
        isWithinEditableDays(date, editableDays, now),
      );
      const projectIdsToCheck = Array.from(
        new Set(
          [before.projectId, data.projectId]
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        ),
      );
      const closedProjects = projectIdsToCheck.length
        ? await prisma.project.findMany({
            where: { id: { in: projectIdsToCheck }, status: 'closed' },
            select: { id: true },
          })
        : [];
      const hasClosedProject = closedProjects.length > 0;

      const policyRes = await evaluateActionPolicyWithFallback({
        flowType: FlowTypeValue.time,
        actionKey: 'edit',
        actor: {
          userId: req.user?.userId ?? null,
          roles: req.user?.roles || [],
          groupIds: req.user?.groupIds || [],
        },
        reasonText,
        state: {
          status: before.status,
          projectIds: projectIdsToCheck,
          workDates: workDatesToCheck.map((date) => date.toISOString()),
        },
        targetTable: 'time_entries',
        targetId: id,
      });
      if (policyRes.policyApplied && !policyRes.allowed) {
        if (policyRes.reason === 'reason_required') {
          return reply.status(400).send({
            error: {
              code: 'REASON_REQUIRED',
              message: 'reasonText is required for override',
              details: { matchedPolicyId: policyRes.matchedPolicyId ?? null },
            },
          });
        }
        return reply.status(403).send({
          error: {
            code: 'ACTION_POLICY_DENIED',
            message: 'Time entry cannot be modified',
            details: {
              reason: policyRes.reason,
              matchedPolicyId: policyRes.matchedPolicyId ?? null,
              guardFailures: policyRes.guardFailures ?? null,
            },
          },
        });
      }
      if (!isEditableByDate || hasClosedProject) {
        if (!policyRes.policyApplied && !isPrivileged) {
          return reply.status(403).send({
            error: {
              code: 'WORKLOG_LOCKED',
              message: 'Time entry is locked for modification',
              details: {
                editableDays,
                editWindowExpired: !isEditableByDate,
                projectClosed: hasClosedProject,
              },
            },
          });
        }
        if (!policyRes.policyApplied && !reasonText) {
          return reply.status(400).send({
            error: {
              code: 'REASON_REQUIRED',
              message: 'reasonText is required for override',
            },
          });
        }
        await logAudit({
          action: 'time_entry_override',
          targetTable: 'time_entries',
          targetId: id,
          metadata: {
            editableDays,
            editWindowExpired: !isEditableByDate,
            projectClosed: hasClosedProject,
            actionPolicy: policyRes.policyApplied
              ? {
                  matchedPolicyId: policyRes.matchedPolicyId,
                  requireReason: policyRes.requireReason,
                }
              : { matchedPolicyId: null, requireReason: false },
          },
          reasonText: reasonText || undefined,
          ...auditContextFromRequest(req, { userId }),
        });
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
        await logAudit({
          action: 'time_entry_modified',
          targetTable: 'time_entries',
          targetId: id,
          metadata: { changedFields: Object.keys(rest) },
          ...auditContextFromRequest(req, { userId }),
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
      const body = req.body as any;
      const reasonText =
        typeof body?.reasonText === 'string' ? body.reasonText.trim() : '';
      const before = await prisma.timeEntry.findUnique({
        where: { id },
        select: { status: true, projectId: true, workDate: true },
      });
      if (before) {
        const policyRes = await evaluateActionPolicyWithFallback({
          flowType: FlowTypeValue.time,
          actionKey: 'submit',
          actor: {
            userId: req.user?.userId ?? null,
            roles: req.user?.roles || [],
            groupIds: req.user?.groupIds || [],
          },
          reasonText,
          state: {
            status: before.status,
            projectId: before.projectId,
            workDate: before.workDate.toISOString(),
          },
          targetTable: 'time_entries',
          targetId: id,
        });
        if (policyRes.policyApplied && !policyRes.allowed) {
          if (policyRes.reason === 'reason_required') {
            return reply.status(400).send({
              error: {
                code: 'REASON_REQUIRED',
                message: 'reasonText is required for override',
                details: { matchedPolicyId: policyRes.matchedPolicyId ?? null },
              },
            });
          }
          return reply.status(403).send({
            error: {
              code: 'ACTION_POLICY_DENIED',
              message: 'Time entry cannot be submitted',
              details: {
                reason: policyRes.reason,
                matchedPolicyId: policyRes.matchedPolicyId ?? null,
                guardFailures: policyRes.guardFailures ?? null,
              },
            },
          });
        }
      }
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
      if (entry.billedInvoiceId) {
        return reply.status(400).send({
          error: {
            code: 'BILLED',
            message: 'Time entry already billed and cannot be reassigned',
          },
        });
      }
      const editableDays = await getEditableDays();
      const isEditableByDate = isWithinEditableDays(
        entry.workDate,
        editableDays,
      );
      const projectIdsToCheck = Array.from(
        new Set([entry.projectId, body.toProjectId].filter(Boolean)),
      );
      const closedProjects = projectIdsToCheck.length
        ? await prisma.project.findMany({
            where: { id: { in: projectIdsToCheck }, status: 'closed' },
            select: { id: true },
          })
        : [];
      const hasClosedProject = closedProjects.length > 0;
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
      if (
        resolvedTaskId !== undefined &&
        resolvedTaskId !== null &&
        typeof resolvedTaskId !== 'string'
      ) {
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
        targetTable: 'time_entries',
        targetId: id,
        reasonCode: body.reasonCode,
        reasonText,
        metadata: {
          fromProjectId: entry.projectId,
          toProjectId: body.toProjectId,
          fromTaskId: entry.taskId,
          toTaskId: nextTaskId,
          editableDays,
          editWindowExpired: !isEditableByDate,
          projectClosed: hasClosedProject,
        },
        ...auditContextFromRequest(req),
      });
      await logReassignment({
        targetTable: 'time_entries',
        targetId: id,
        fromProjectId: entry.projectId,
        toProjectId: body.toProjectId,
        fromTaskId: entry.taskId,
        toTaskId: nextTaskId,
        reasonCode: body.reasonCode,
        reasonText,
        createdBy: req.user?.userId,
      });
      return updated;
    },
  );
}
