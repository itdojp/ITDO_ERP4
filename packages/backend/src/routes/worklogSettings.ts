import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { worklogSettingPatchSchema } from './validators.js';

const WORKLOG_SETTING_ID = 'default';
const DEFAULT_EDITABLE_DAYS = 14;

export async function registerWorklogSettingRoutes(app: FastifyInstance) {
  app.get(
    '/worklog-settings',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const actorId = req.user?.userId ?? null;
      return prisma.worklogSetting.upsert({
        where: { id: WORKLOG_SETTING_ID },
        create: {
          id: WORKLOG_SETTING_ID,
          editableDays: DEFAULT_EDITABLE_DAYS,
          createdBy: actorId,
          updatedBy: actorId,
        },
        update: {},
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
      const body = req.body as { editableDays?: number };
      const actorId = req.user?.userId ?? null;
      const updated = await prisma.worklogSetting.upsert({
        where: { id: WORKLOG_SETTING_ID },
        create: {
          id: WORKLOG_SETTING_ID,
          editableDays: body.editableDays ?? DEFAULT_EDITABLE_DAYS,
          createdBy: actorId,
          updatedBy: actorId,
        },
        update: {
          ...(body.editableDays !== undefined
            ? { editableDays: body.editableDays }
            : {}),
          updatedBy: actorId,
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
