import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { chatSettingPatchSchema } from './validators.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { CHAT_ADMIN_ROLES } from './chat/shared/constants.js';

const CHAT_SETTING_ID = 'default';

export async function registerChatSettingRoutes(app: FastifyInstance) {
  app.get(
    '/chat-settings',
    { preHandler: requireRole(CHAT_ADMIN_ROLES) },
    async () => {
      const existing = await prisma.chatSetting.findUnique({
        where: { id: CHAT_SETTING_ID },
      });
      if (existing) return existing;
      return prisma.chatSetting.create({
        data: { id: CHAT_SETTING_ID },
      });
    },
  );

  app.patch(
    '/chat-settings',
    {
      preHandler: requireRole(CHAT_ADMIN_ROLES),
      schema: chatSettingPatchSchema,
    },
    async (req) => {
      const userId = req.user?.userId || null;
      const body = req.body as {
        allowUserPrivateGroupCreation?: boolean;
        allowDmCreation?: boolean;
        ackMaxRequiredUsers?: number;
        ackMaxRequiredGroups?: number;
        ackMaxRequiredRoles?: number;
      };

      const updated = await prisma.chatSetting.upsert({
        where: { id: CHAT_SETTING_ID },
        create: {
          id: CHAT_SETTING_ID,
          allowUserPrivateGroupCreation:
            body.allowUserPrivateGroupCreation ?? true,
          allowDmCreation: body.allowDmCreation ?? true,
          ackMaxRequiredUsers: body.ackMaxRequiredUsers ?? 50,
          ackMaxRequiredGroups: body.ackMaxRequiredGroups ?? 20,
          ackMaxRequiredRoles: body.ackMaxRequiredRoles ?? 20,
          createdBy: userId,
          updatedBy: userId,
        },
        update: {
          ...(body.allowUserPrivateGroupCreation !== undefined
            ? {
                allowUserPrivateGroupCreation:
                  body.allowUserPrivateGroupCreation,
              }
            : {}),
          ...(body.allowDmCreation !== undefined
            ? { allowDmCreation: body.allowDmCreation }
            : {}),
          ...(body.ackMaxRequiredUsers !== undefined
            ? { ackMaxRequiredUsers: body.ackMaxRequiredUsers }
            : {}),
          ...(body.ackMaxRequiredGroups !== undefined
            ? { ackMaxRequiredGroups: body.ackMaxRequiredGroups }
            : {}),
          ...(body.ackMaxRequiredRoles !== undefined
            ? { ackMaxRequiredRoles: body.ackMaxRequiredRoles }
            : {}),
          updatedBy: userId,
        },
      });

      await logAudit({
        action: 'chat_setting_updated',
        targetTable: 'chat_settings',
        targetId: updated.id,
        metadata: {
          allowUserPrivateGroupCreation: updated.allowUserPrivateGroupCreation,
          allowDmCreation: updated.allowDmCreation,
          ackMaxRequiredUsers: updated.ackMaxRequiredUsers,
          ackMaxRequiredGroups: updated.ackMaxRequiredGroups,
          ackMaxRequiredRoles: updated.ackMaxRequiredRoles,
        },
        ...auditContextFromRequest(req),
      });

      return updated;
    },
  );
}
