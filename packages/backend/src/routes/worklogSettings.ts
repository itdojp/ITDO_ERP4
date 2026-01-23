import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { worklogSettingPatchSchema } from './validators.js';

const DEFAULT_SETTING_ID = 'default';
const DEFAULT_EDITABLE_DAYS = 14;

export async function registerWorklogSettingRoutes(app: FastifyInstance) {
  app.get(
    '/worklog-settings',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async () => {
      const setting = await prisma.worklogSetting.findUnique({
        where: { id: DEFAULT_SETTING_ID },
      });
      if (setting) return setting;
      return prisma.worklogSetting.create({
        data: { id: DEFAULT_SETTING_ID, editableDays: DEFAULT_EDITABLE_DAYS },
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
      const body = req.body as { editableDays: number };
      const editableDays = Number(body.editableDays);
      const updated = await prisma.worklogSetting.upsert({
        where: { id: DEFAULT_SETTING_ID },
        create: { id: DEFAULT_SETTING_ID, editableDays },
        update: { editableDays },
      });
      await logAudit({
        action: 'worklog_setting_updated',
        targetTable: 'worklog_settings',
        targetId: updated.id,
        metadata: { editableDays },
        ...auditContextFromRequest(req),
      });
      return updated;
    },
  );
}
