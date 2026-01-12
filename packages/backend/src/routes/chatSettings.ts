import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { chatSettingPatchSchema } from './validators.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';

const CHAT_SETTING_ID = 'default';

export async function registerChatSettingRoutes(app: FastifyInstance) {
  app.get(
    '/chat-settings',
    { preHandler: requireRole(['admin', 'mgmt']) },
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
      preHandler: requireRole(['admin', 'mgmt']),
      schema: chatSettingPatchSchema,
    },
    async (req) => {
      const userId = req.user?.userId || null;
      const body = req.body as {
        allowUserPrivateGroupCreation?: boolean;
        allowDmCreation?: boolean;
      };

      const updated = await prisma.chatSetting.upsert({
        where: { id: CHAT_SETTING_ID },
        create: {
          id: CHAT_SETTING_ID,
          allowUserPrivateGroupCreation:
            body.allowUserPrivateGroupCreation ?? true,
          allowDmCreation: body.allowDmCreation ?? true,
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
        },
        ...auditContextFromRequest(req),
      });

      return updated;
    },
  );
}
