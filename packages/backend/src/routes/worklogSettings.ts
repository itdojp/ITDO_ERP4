import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { worklogSettingPatchSchema } from './validators.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';

const WORKLOG_SETTING_ID = 'default';

export async function registerWorklogSettingRoutes(app: FastifyInstance) {
  app.get(
    '/worklog-settings',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async () => {
      const existing = await prisma.worklogSetting.findUnique({
        where: { id: WORKLOG_SETTING_ID },
      });
      if (existing) return existing;
      return prisma.worklogSetting.create({
        data: { id: WORKLOG_SETTING_ID, editableDays: 14 },
      });
    },
  );

  app.patch(
    '/worklog-settings',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: worklogSettingPatchSchema,
    },
    async (req) => {
      const userId = req.user?.userId || null;
      const body = req.body as { editableDays?: number };
      const updated = await prisma.worklogSetting.upsert({
        where: { id: WORKLOG_SETTING_ID },
        create: {
          id: WORKLOG_SETTING_ID,
          editableDays: body.editableDays ?? 14,
          createdBy: userId,
          updatedBy: userId,
        },
        update: {
          ...(body.editableDays !== undefined
            ? { editableDays: body.editableDays }
            : {}),
          updatedBy: userId,
        },
      });

      await logAudit({
        action: 'worklog_setting_updated',
        targetTable: 'worklog_settings',
        targetId: updated.id,
        metadata: { editableDays: updated.editableDays },
        ...auditContextFromRequest(req),
      });

      return updated;
    },
  );
}
