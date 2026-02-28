import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import {
  DEFAULT_LEAVE_SETTING,
  LEAVE_SETTING_ID,
  ensureLeaveSetting,
} from '../services/leaveSettings.js';
import { leaveSettingPatchSchema } from './validators.js';

export async function registerLeaveSettingRoutes(app: FastifyInstance) {
  app.get(
    '/leave-settings',
    { preHandler: requireRole(['admin', 'mgmt', 'user']) },
    async (req) => {
      return ensureLeaveSetting({ actorId: req.user?.userId ?? null });
    },
  );

  app.patch(
    '/leave-settings',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: leaveSettingPatchSchema,
    },
    async (req, reply) => {
      const body = req.body as Partial<typeof DEFAULT_LEAVE_SETTING>;
      const actorId = req.user?.userId ?? null;
      const current = await prisma.leaveSetting.findUnique({
        where: { id: LEAVE_SETTING_ID },
      });
      const currentLimits = current ?? DEFAULT_LEAVE_SETTING;
      const nextLimits = {
        timeUnitMinutes: body.timeUnitMinutes ?? currentLimits.timeUnitMinutes,
        defaultWorkdayMinutes:
          body.defaultWorkdayMinutes ?? currentLimits.defaultWorkdayMinutes,
      } as const;

      if (
        !Number.isInteger(nextLimits.timeUnitMinutes) ||
        nextLimits.timeUnitMinutes < 1 ||
        nextLimits.timeUnitMinutes > 60
      ) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_LEAVE_SETTING',
            message: 'timeUnitMinutes must be an integer between 1 and 60',
          },
        });
      }
      if (
        !Number.isInteger(nextLimits.defaultWorkdayMinutes) ||
        nextLimits.defaultWorkdayMinutes < 1 ||
        nextLimits.defaultWorkdayMinutes > 24 * 60
      ) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_LEAVE_SETTING',
            message:
              'defaultWorkdayMinutes must be an integer between 1 and 1440',
          },
        });
      }
      const updated = await prisma.leaveSetting.upsert({
        where: { id: LEAVE_SETTING_ID },
        create: {
          id: LEAVE_SETTING_ID,
          ...nextLimits,
          createdBy: actorId,
          updatedBy: actorId,
        },
        update: {
          ...nextLimits,
          updatedBy: actorId,
        },
      });
      await logAudit({
        action: 'leave_setting_updated',
        targetTable: 'leave_settings',
        targetId: updated.id,
        metadata: {
          timeUnitMinutes: updated.timeUnitMinutes,
          defaultWorkdayMinutes: updated.defaultWorkdayMinutes,
        },
        ...auditContextFromRequest(req),
      });
      return updated;
    },
  );
}
