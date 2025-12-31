import { FastifyInstance } from 'fastify';
import { timeEntryPatchSchema, timeEntrySchema } from './validators.js';
import { TimeStatusValue } from '../types.js';
import {
  requireProjectAccess,
  requireRole,
  requireRoleOrSelf,
} from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { submitApprovalWithUpdate } from '../services/approval.js';
import { FlowTypeValue } from '../types.js';
import { parseDateParam } from '../utils/date.js';

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
      const entry = await prisma.timeEntry.create({
        data: { ...body, workDate, status: TimeStatusValue.submitted },
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
}
