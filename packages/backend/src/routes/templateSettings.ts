import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { templateSettingPatchSchema, templateSettingSchema } from './validators.js';

type TemplateSettingBody = {
  kind: string;
  templateId: string;
  numberRule: string;
  layoutConfig?: unknown;
  logoUrl?: string | null;
  signatureText?: string | null;
  isDefault?: boolean | null;
};

async function ensureDefault(
  tx: any,
  kind: string,
  targetId: string,
) {
  await tx.docTemplateSetting.updateMany({
    where: { kind, id: { not: targetId } },
    data: { isDefault: false },
  });
}

export async function registerTemplateSettingRoutes(app: FastifyInstance) {
  app.get(
    '/template-settings',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req) => {
      const { kind } = req.query as { kind?: string };
      const items = await prisma.docTemplateSetting.findMany({
        where: kind ? { kind } : undefined,
        orderBy: { createdAt: 'desc' },
      });
      return { items };
    },
  );

  app.post(
    '/template-settings',
    { preHandler: requireRole(['admin', 'mgmt']), schema: templateSettingSchema },
    async (req) => {
      const body = req.body as TemplateSettingBody;
      return prisma.$transaction(async (tx) => {
        const created = await tx.docTemplateSetting.create({ data: body });
        if (body.isDefault) {
          await ensureDefault(tx, created.kind, created.id);
        }
        return created;
      });
    },
  );

  app.patch(
    '/template-settings/:id',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: templateSettingPatchSchema,
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as Partial<TemplateSettingBody>;
      return prisma.$transaction(async (tx) => {
        const updated = await tx.docTemplateSetting.update({
          where: { id },
          data: body,
        });
        if (body.isDefault) {
          await ensureDefault(tx, updated.kind, updated.id);
        }
        return updated;
      });
    },
  );
}
