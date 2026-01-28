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
    async (req, reply) => {
      const body = req.body as Partial<typeof DEFAULT_LIMITS>;
      const actorId = req.user?.userId ?? null;
      const current = await prisma.annotationSetting.findUnique({
        where: { id: ANNOTATION_SETTING_ID },
      });
      const currentLimits = current ?? DEFAULT_LIMITS;
      const nextLimits = {
        maxExternalUrlCount:
          body.maxExternalUrlCount ?? currentLimits.maxExternalUrlCount,
        maxExternalUrlLength:
          body.maxExternalUrlLength ?? currentLimits.maxExternalUrlLength,
        maxExternalUrlTotalLength:
          body.maxExternalUrlTotalLength ??
          currentLimits.maxExternalUrlTotalLength,
        maxNotesLength: body.maxNotesLength ?? currentLimits.maxNotesLength,
      } as const;

      if (
        nextLimits.maxExternalUrlCount > 0 &&
        nextLimits.maxExternalUrlTotalLength < nextLimits.maxExternalUrlLength
      ) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_ANNOTATION_SETTING',
            message:
              'maxExternalUrlTotalLength must be >= maxExternalUrlLength when maxExternalUrlCount > 0',
          },
        });
      }
      const updated = await prisma.annotationSetting.upsert({
        where: { id: ANNOTATION_SETTING_ID },
        create: {
          id: ANNOTATION_SETTING_ID,
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
