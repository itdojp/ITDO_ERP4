import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { annotationSettingPatchSchema } from './validators.js';

const ANNOTATION_SETTING_ID = 'default';

const DEFAULT_LIMITS = {
  maxExternalUrlCount: 20,
  maxExternalUrlLength: 2048,
  maxExternalUrlTotalLength: 16384,
  maxNotesLength: 20000,
} as const;

export async function registerAnnotationSettingRoutes(app: FastifyInstance) {
  app.get(
    '/annotation-settings',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const actorId = req.user?.userId ?? null;
      return prisma.annotationSetting.upsert({
        where: { id: ANNOTATION_SETTING_ID },
        create: {
          id: ANNOTATION_SETTING_ID,
          ...DEFAULT_LIMITS,
          createdBy: actorId,
          updatedBy: actorId,
        },
        update: {},
      });
    },
  );

  app.patch(
    '/annotation-settings',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: annotationSettingPatchSchema,
    },
    async (req) => {
      const body = req.body as Partial<typeof DEFAULT_LIMITS>;
      const actorId = req.user?.userId ?? null;
      const updated = await prisma.annotationSetting.upsert({
        where: { id: ANNOTATION_SETTING_ID },
        create: {
          id: ANNOTATION_SETTING_ID,
          maxExternalUrlCount:
            body.maxExternalUrlCount ?? DEFAULT_LIMITS.maxExternalUrlCount,
          maxExternalUrlLength:
            body.maxExternalUrlLength ?? DEFAULT_LIMITS.maxExternalUrlLength,
          maxExternalUrlTotalLength:
            body.maxExternalUrlTotalLength ??
            DEFAULT_LIMITS.maxExternalUrlTotalLength,
          maxNotesLength: body.maxNotesLength ?? DEFAULT_LIMITS.maxNotesLength,
          createdBy: actorId,
          updatedBy: actorId,
        },
        update: {
          ...(body.maxExternalUrlCount !== undefined
            ? { maxExternalUrlCount: body.maxExternalUrlCount }
            : {}),
          ...(body.maxExternalUrlLength !== undefined
            ? { maxExternalUrlLength: body.maxExternalUrlLength }
            : {}),
          ...(body.maxExternalUrlTotalLength !== undefined
            ? { maxExternalUrlTotalLength: body.maxExternalUrlTotalLength }
            : {}),
          ...(body.maxNotesLength !== undefined
            ? { maxNotesLength: body.maxNotesLength }
            : {}),
          updatedBy: actorId,
        },
      });
      await logAudit({
        action: 'annotation_setting_updated',
        targetTable: 'annotation_settings',
        targetId: updated.id,
        metadata: {
          maxExternalUrlCount: updated.maxExternalUrlCount,
          maxExternalUrlLength: updated.maxExternalUrlLength,
          maxExternalUrlTotalLength: updated.maxExternalUrlTotalLength,
          maxNotesLength: updated.maxNotesLength,
        },
        ...auditContextFromRequest(req),
      });
      return updated;
    },
  );
}
