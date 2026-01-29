import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { submitApprovalWithUpdate } from '../services/approval.js';
import { FlowTypeValue, TimeStatusValue } from '../types.js';
import { requireRole } from '../services/rbac.js';
import { leaveRequestSchema } from './validators.js';
import { endOfDay, parseDateParam } from '../utils/date.js';
import { evaluateActionPolicyWithFallback } from '../services/actionPolicy.js';
import { logActionPolicyOverrideIfNeeded } from '../services/actionPolicyAudit.js';

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
      const leave = await prisma.leaveRequest.create({
        data: {
          userId: body.userId,
          leaveType: body.leaveType,
          notes: body.notes,
          startDate,
          endDate,
          hours: hours ?? undefined,
        },
      });
      return leave;
    },
  );

  app.post(
    '/leave-requests/:id/submit',
    { preHandler: requireRole(['admin', 'mgmt', 'user']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      const reasonText =
        typeof body?.reasonText === 'string' ? body.reasonText.trim() : '';
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
            code: 'ACTION_POLICY_DENIED',
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
      const { updated } = await submitApprovalWithUpdate({
        flowType: FlowTypeValue.leave,
        targetTable: 'leave_requests',
        targetId: id,
        update: (tx) =>
          tx.leaveRequest.update({
            where: { id },
            data: { status: 'pending_manager' },
          }),
        payload: { hours: leave.hours || 0 },
        createdBy: userId,
      });
      return updated;
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
