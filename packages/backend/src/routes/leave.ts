import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { submitApprovalWithUpdate } from '../services/approval.js';
import { createApprovalPendingNotifications } from '../services/appNotifications.js';
import { FlowTypeValue, TimeStatusValue } from '../types.js';
import { requireRole } from '../services/rbac.js';
import {
  leaveLeaderListQuerySchema,
  leaveRequestSchema,
  leaveSubmitSchema,
} from './validators.js';
import { endOfDay, parseDateParam } from '../utils/date.js';
import { evaluateActionPolicyWithFallback } from '../services/actionPolicy.js';
import { resolveActionPolicyDeniedCode } from '../services/actionPolicyErrors.js';
import { logActionPolicyOverrideIfNeeded } from '../services/actionPolicyAudit.js';
import { ensureLeaveSetting } from '../services/leaveSettings.js';

function parseTimeToMinutes(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === '24:00') return 24 * 60;
  const match = /^(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23) return null;
  if (minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function normalizeListLimit(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(300, Math.floor(value)));
}

export async function registerLeaveRoutes(app: FastifyInstance) {
  app.post(
    '/leave-requests',
    {
      preHandler: requireRole(['admin', 'mgmt', 'user']),
      schema: leaveRequestSchema,
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
      const startDate = parseDateParam(body.startDate);
      const endDate = parseDateParam(body.endDate);
      if (!startDate || !endDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid startDate/endDate' },
        });
      }
      if (startDate.getTime() > endDate.getTime()) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DATE_RANGE',
            message: 'startDate must be <= endDate',
          },
        });
      }
      const startTimeMinutes = parseTimeToMinutes(body.startTime);
      const endTimeMinutes = parseTimeToMinutes(body.endTime);
      if (
        typeof body.startTime === 'string' &&
        body.startTime.trim() &&
        startTimeMinutes === null
      ) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_TIME_FORMAT',
            message: 'startTime must be in HH:MM format',
          },
        });
      }
      if (
        typeof body.endTime === 'string' &&
        body.endTime.trim() &&
        endTimeMinutes === null
      ) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_TIME_FORMAT',
            message: 'endTime must be in HH:MM format',
          },
        });
      }
      const usesHourlyLeave =
        startTimeMinutes !== null || endTimeMinutes !== null;

      let hours = undefined as number | undefined;
      if (body.hours !== undefined && body.hours !== null) {
        hours = Number(body.hours);
        if (!Number.isFinite(hours) || hours < 0 || !Number.isInteger(hours)) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_HOURS',
              message: 'hours must be a non-negative integer',
            },
          });
        }
      }

      let minutes = undefined as number | undefined;
      let storedStartTimeMinutes = undefined as number | undefined;
      let storedEndTimeMinutes = undefined as number | undefined;
      if (usesHourlyLeave) {
        if (startTimeMinutes === null || endTimeMinutes === null) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_TIME_RANGE',
              message: 'startTime and endTime are required for hourly leave',
            },
          });
        }
        if (startDate.getTime() !== endDate.getTime()) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_DATE_RANGE',
              message:
                'hourly leave must be a single day (startDate == endDate)',
            },
          });
        }
        if (endTimeMinutes <= startTimeMinutes) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_TIME_RANGE',
              message: 'endTime must be after startTime',
            },
          });
        }

        const setting = await ensureLeaveSetting({
          actorId: req.user?.userId ?? null,
        });
        const unit = setting.timeUnitMinutes;
        if (startTimeMinutes % unit !== 0 || endTimeMinutes % unit !== 0) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_TIME_UNIT',
              message: `time must align to ${unit} minutes`,
            },
          });
        }

        storedStartTimeMinutes = startTimeMinutes;
        storedEndTimeMinutes = endTimeMinutes;
        minutes = endTimeMinutes - startTimeMinutes;
        hours = undefined;
      }
      const leave = await prisma.leaveRequest.create({
        data: {
          userId: body.userId,
          leaveType: body.leaveType,
          notes: body.notes,
          startDate,
          endDate,
          hours: hours ?? undefined,
          minutes: minutes ?? undefined,
          startTimeMinutes: storedStartTimeMinutes ?? undefined,
          endTimeMinutes: storedEndTimeMinutes ?? undefined,
        },
      });
      return leave;
    },
  );

  app.post(
    '/leave-requests/:id/submit',
    {
      preHandler: requireRole(['admin', 'mgmt', 'user']),
      schema: leaveSubmitSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      const reasonText =
        typeof body?.reasonText === 'string' ? body.reasonText.trim() : '';
      const noConsultationConfirmed = body?.noConsultationConfirmed === true;
      const noConsultationReason =
        typeof body?.noConsultationReason === 'string'
          ? body.noConsultationReason.trim()
          : '';
      const leave = await prisma.leaveRequest.findUnique({ where: { id } });
      if (!leave) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const roles = req.user?.roles || [];
      const userId = req.user?.userId;
      if (
        !roles.includes('admin') &&
        !roles.includes('mgmt') &&
        leave.userId !== userId
      ) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const policyRes = await evaluateActionPolicyWithFallback({
        flowType: FlowTypeValue.leave,
        actionKey: 'submit',
        actor: {
          userId: req.user?.userId ?? null,
          roles: req.user?.roles || [],
          groupIds: req.user?.groupIds || [],
          groupAccountIds: req.user?.groupAccountIds || [],
        },
        reasonText,
        state: { status: leave.status },
        targetTable: 'leave_requests',
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
            code: resolveActionPolicyDeniedCode(policyRes),
            message: 'LeaveRequest cannot be submitted',
            details: {
              reason: policyRes.reason,
              matchedPolicyId: policyRes.matchedPolicyId ?? null,
              guardFailures: policyRes.guardFailures ?? null,
            },
          },
        });
      }
      await logActionPolicyOverrideIfNeeded({
        req,
        flowType: FlowTypeValue.leave,
        actionKey: 'submit',
        targetTable: 'leave_requests',
        targetId: id,
        reasonText,
        result: policyRes,
      });
      const workDateEnd = endOfDay(leave.endDate);
      const conflictStatuses = [
        TimeStatusValue.submitted,
        TimeStatusValue.approved,
      ];

      const isHourlyLeave =
        leave.startTimeMinutes !== null || leave.endTimeMinutes !== null;
      if (isHourlyLeave) {
        if (
          leave.startTimeMinutes === null ||
          leave.endTimeMinutes === null ||
          leave.minutes === null
        ) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_HOURLY_LEAVE',
              message: 'hourly leave requires start/end time and minutes',
            },
          });
        }
        const setting = await ensureLeaveSetting({
          actorId: req.user?.userId ?? null,
        });
        const dayEnd = endOfDay(leave.startDate);
        const hourlyWhere = {
          userId: leave.userId,
          deletedAt: null,
          status: { in: conflictStatuses },
          minutes: { gt: 0 },
          workDate: { gte: leave.startDate, lte: dayEnd },
        };
        const aggregate = await prisma.timeEntry.aggregate({
          where: hourlyWhere,
          _sum: { minutes: true },
        });
        const existingMinutes = aggregate._sum.minutes ?? 0;
        const totalMinutes = existingMinutes + leave.minutes;
        if (totalMinutes > setting.defaultWorkdayMinutes) {
          const conflictCount = await prisma.timeEntry.count({
            where: hourlyWhere,
          });
          const conflicts = await prisma.timeEntry.findMany({
            where: hourlyWhere,
            select: {
              id: true,
              projectId: true,
              taskId: true,
              workDate: true,
              minutes: true,
            },
            orderBy: { workDate: 'asc' },
            take: 50,
          });
          return reply.status(409).send({
            error: {
              code: 'TIME_ENTRY_OVERBOOKED',
              message:
                'Time entries and hourly leave exceed defaultWorkdayMinutes',
              defaultWorkdayMinutes: setting.defaultWorkdayMinutes,
              existingMinutes,
              requestedLeaveMinutes: leave.minutes,
              totalMinutes,
              conflictCount,
              conflicts: conflicts.map((entry) => ({
                id: entry.id,
                projectId: entry.projectId,
                taskId: entry.taskId,
                workDate: entry.workDate,
                minutes: entry.minutes,
              })),
            },
          });
        }
      } else {
        const conflictWhere = {
          userId: leave.userId,
          deletedAt: null,
          status: { in: conflictStatuses },
          minutes: { gt: 0 },
          workDate: { gte: leave.startDate, lte: workDateEnd },
        };
        const conflictCount = await prisma.timeEntry.count({
          where: conflictWhere,
        });
        if (conflictCount) {
          const conflicts = await prisma.timeEntry.findMany({
            where: conflictWhere,
            select: {
              id: true,
              projectId: true,
              taskId: true,
              workDate: true,
              minutes: true,
            },
            orderBy: { workDate: 'asc' },
            take: 50,
          });
          return reply.status(409).send({
            error: {
              code: 'TIME_ENTRY_CONFLICT',
              message: 'Time entries exist in leave period',
              conflictCount,
              conflicts: conflicts.map((entry) => ({
                id: entry.id,
                projectId: entry.projectId,
                taskId: entry.taskId,
                workDate: entry.workDate,
                minutes: entry.minutes,
              })),
            },
          });
        }
      }

      const annotation = await prisma.annotation.findUnique({
        where: {
          targetKind_targetId: { targetKind: 'leave_request', targetId: id },
        },
        select: { internalRefs: true },
      });
      const internalRefs = Array.isArray(annotation?.internalRefs)
        ? (annotation?.internalRefs as Array<Record<string, unknown>>)
        : [];
      const hasConsultationEvidence = internalRefs.some((ref) => {
        if (!ref || typeof ref !== 'object') return false;
        const kind = typeof ref.kind === 'string' ? ref.kind.trim() : '';
        const refId = typeof ref.id === 'string' ? ref.id.trim() : '';
        return kind === 'chat_message' && Boolean(refId);
      });

      if (!hasConsultationEvidence) {
        if (!noConsultationConfirmed || !noConsultationReason) {
          return reply.status(400).send({
            error: {
              code: 'NO_CONSULTATION_REASON_REQUIRED',
              message:
                'Consultation evidence is missing. Confirm no consultation and provide a reason.',
            },
          });
        }
      }

      const noConsultationUpdate = hasConsultationEvidence
        ? { noConsultationConfirmed: null, noConsultationReason: null }
        : {
            noConsultationConfirmed: true,
            noConsultationReason,
          };
      const actorUserId = req.user?.userId || 'system';
      const { updated, approval } = await submitApprovalWithUpdate({
        flowType: FlowTypeValue.leave,
        targetTable: 'leave_requests',
        targetId: id,
        update: (tx) =>
          tx.leaveRequest.update({
            where: { id },
            data: { status: 'pending_manager', ...noConsultationUpdate },
          }),
        payload: {
          hours: leave.hours || 0,
          minutes: leave.minutes ?? (leave.hours || 0) * 60,
        },
        createdBy: userId,
      });
      await createApprovalPendingNotifications({
        approvalInstanceId: approval.id,
        projectId: approval.projectId,
        requesterUserId: actorUserId,
        actorUserId,
        flowType: approval.flowType,
        targetTable: approval.targetTable,
        targetId: approval.targetId,
        currentStep: approval.currentStep,
        steps: approval.steps,
      });
      return updated;
    },
  );

  app.get(
    '/leave-requests/leader',
    {
      preHandler: requireRole(['admin', 'mgmt', 'user']),
      schema: leaveLeaderListQuerySchema,
    },
    async (req, reply) => {
      const {
        userId: requestedUserId,
        status,
        limit,
      } = req.query as {
        userId?: string;
        status?: 'pending_manager' | 'approved' | 'rejected';
        limit?: number;
      };
      const roles = req.user?.roles || [];
      const currentUserId = req.user?.userId ?? null;
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      const take = normalizeListLimit(limit);

      let allowedUserIds: string[] = [];
      const visibleProjectIdsByUser = new Map<string, Set<string>>();

      if (!isPrivileged) {
        if (!currentUserId) {
          return reply.code(401).send({ error: 'unauthorized' });
        }
        const leaderRows = await prisma.projectMember.findMany({
          where: { userId: currentUserId, role: 'leader' },
          select: { projectId: true },
        });
        const leaderProjectIds = Array.from(
          new Set(
            leaderRows
              .map((row) => row.projectId)
              .filter((projectId): projectId is string => Boolean(projectId)),
          ),
        );
        if (!leaderProjectIds.length) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        const memberRows = await prisma.projectMember.findMany({
          where: { projectId: { in: leaderProjectIds } },
          select: { userId: true, projectId: true },
        });
        for (const row of memberRows) {
          const bucket =
            visibleProjectIdsByUser.get(row.userId) ?? new Set<string>();
          bucket.add(row.projectId);
          visibleProjectIdsByUser.set(row.userId, bucket);
        }
        allowedUserIds = Array.from(visibleProjectIdsByUser.keys());
      }

      if (requestedUserId && !isPrivileged) {
        if (!allowedUserIds.includes(requestedUserId)) {
          return { items: [] as Array<Record<string, unknown>> };
        }
        allowedUserIds = [requestedUserId];
      } else if (requestedUserId) {
        allowedUserIds = [requestedUserId];
      }

      if (!isPrivileged && !allowedUserIds.length) {
        return { items: [] as Array<Record<string, unknown>> };
      }

      const where = {
        ...(status ? { status } : { status: { not: 'draft' as const } }),
        ...(allowedUserIds.length ? { userId: { in: allowedUserIds } } : {}),
      };

      const items = await prisma.leaveRequest.findMany({
        where,
        select: {
          id: true,
          userId: true,
          leaveType: true,
          startDate: true,
          endDate: true,
          hours: true,
          minutes: true,
          startTimeMinutes: true,
          endTimeMinutes: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
        take,
      });

      const userIds = Array.from(
        new Set(items.map((item) => item.userId).filter(Boolean)),
      );
      const userAccounts = userIds.length
        ? await prisma.userAccount.findMany({
            where: { userName: { in: userIds } },
            select: {
              userName: true,
              displayName: true,
            },
          })
        : [];
      const displayNameByUserName = new Map<string, string | null>(
        userAccounts.map((item) => [item.userName, item.displayName]),
      );

      return {
        items: items.map((item) => ({
          ...item,
          userDisplayName: displayNameByUserName.get(item.userId) ?? null,
          visibleProjectIds: Array.from(
            visibleProjectIdsByUser.get(item.userId) ?? new Set<string>(),
          ).sort(),
        })),
      };
    },
  );

  app.get(
    '/leave-requests',
    {
      preHandler: requireRole(['admin', 'mgmt', 'user']),
    },
    async (req, reply) => {
      const { userId } = req.query as { userId?: string };
      const roles = req.user?.roles || [];
      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      const currentUserId = req.user?.userId;
      const where: { userId?: string } = {};
      if (!isPrivileged) {
        if (!currentUserId) {
          return reply.code(401).send({ error: 'unauthorized' });
        }
        if (userId && userId !== currentUserId) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        where.userId = currentUserId;
      } else if (userId) {
        where.userId = userId;
      }
      const items = await prisma.leaveRequest.findMany({
        where,
        orderBy: { startDate: 'desc' },
        take: 100,
      });
      return { items };
    },
  );
}
