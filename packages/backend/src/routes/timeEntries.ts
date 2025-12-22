import { FastifyInstance } from 'fastify';
import { timeEntryPatchSchema, timeEntrySchema } from './validators.js';
import { TimeStatusValue } from '../types.js';
import { requireProjectAccess, requireRole, requireRoleOrSelf } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { submitApprovalWithUpdate } from '../services/approval.js';
import { FlowTypeValue } from '../types.js';

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
    async (req) => {
      const body = req.body as any;
      const entry = await prisma.timeEntry.create({ data: { ...body, status: TimeStatusValue.submitted } });
      return entry;
    },
  );

  app.patch(
    '/time-entries/:id',
    {
      schema: timeEntryPatchSchema,
      preHandler: [
        requireRoleOrSelf(['admin', 'mgmt'], (req) => (req.body as any)?.userId),
        requireProjectAccess((req) => (req.body as any)?.projectId),
      ],
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      const before = await prisma.timeEntry.findUnique({ where: { id } });
      if (!before) {
        return { error: 'not_found' };
      }
      const changed = ['minutes', 'workDate', 'taskId', 'projectId'].some((k) => body[k] !== undefined && (body as any)[k] !== (before as any)[k]);
      const data = { ...body } as any;
      if (changed) {
        data.status = TimeStatusValue.submitted;
        const { updated } = await submitApprovalWithUpdate({
          flowType: FlowTypeValue.time,
          targetTable: 'time_entries',
          targetId: id,
          update: (tx) => tx.timeEntry.update({ where: { id }, data }),
        });
        // 監査ログ: 修正が承認待ちになったことを記録
        const userId = req.user?.userId;
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
      const { projectId, userId, from, to } = req.query as { projectId?: string; userId?: string; from?: string; to?: string };
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

  app.post('/time-entries/:id/submit', { preHandler: requireRole(['admin', 'mgmt']) }, async (req) => {
    const { id } = req.params as { id: string };
    const entry = await prisma.timeEntry.update({ where: { id }, data: { status: TimeStatusValue.submitted } });
    return entry;
  });
}
