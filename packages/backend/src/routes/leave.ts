import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { submitApprovalWithUpdate } from '../services/approval.js';
import { FlowTypeValue, TimeStatusValue } from '../types.js';
import { requireRole } from '../services/rbac.js';
import { leaveRequestSchema } from './validators.js';
import { endOfDay, parseDateParam } from '../utils/date.js';

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
            error: { code: 'INVALID_HOURS', message: 'hours must be integer' },
          });
        }
      }
      const leave = await prisma.leaveRequest.create({
        data: {
          ...body,
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
      const conflicts = await prisma.timeEntry.findMany({
        where: {
          userId: leave.userId,
          deletedAt: null,
          status: { in: [TimeStatusValue.submitted, TimeStatusValue.approved] },
          minutes: { gt: 0 },
          workDate: { gte: leave.startDate, lte: endOfDay(leave.endDate) },
        },
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
      if (conflicts.length) {
        return reply.status(409).send({
          error: {
            code: 'TIME_ENTRY_CONFLICT',
            message: 'Time entries exist in leave period',
            conflictCount: conflicts.length,
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
