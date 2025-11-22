import { FastifyInstance } from 'fastify';
import { timeEntryPatchSchema, timeEntrySchema } from './validators.js';
import { TimeStatusValue } from '../types.js';
import { requireProjectAccess, requireRole, requireRoleOrSelf } from '../services/rbac.js';
import { prisma } from '../services/db.js';
import { createApproval } from '../services/approval.js';
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
      const data = { ...before, ...body } as any;
      if (changed) {
        data.status = TimeStatusValue.submitted;
      }
      const entry = await prisma.timeEntry.update({ where: { id }, data });
      if (changed) {
        await createApproval(FlowTypeValue.time, 'time_entries', id, [{ approverGroupId: 'mgmt' }]);
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
      }
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
      const { projectId, userId } = req.query as { projectId?: string; userId?: string };
    const roles = req.user?.roles || [];
    const currentUserId = req.user?.userId;
    const where: any = {};
    if (projectId) where.projectId = projectId;
    if (!roles.includes('admin') && !roles.includes('mgmt')) {
      where.userId = currentUserId;
    } else if (userId) {
      where.userId = userId;
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
