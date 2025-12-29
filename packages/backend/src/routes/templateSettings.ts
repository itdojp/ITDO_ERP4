import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { getPdfTemplate } from '../services/pdfTemplates.js';
import {
  templateSettingPatchSchema,
  templateSettingSchema,
} from './validators.js';

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
  tx: Prisma.TransactionClient,
  kind: string,
  targetId: string,
) {
  await tx.docTemplateSetting.updateMany({
    where: { kind, id: { not: targetId } },
    data: { isDefault: false },
  });
}

function isValidTemplate(kind: string, templateId: string) {
  const template = getPdfTemplate(templateId);
  return Boolean(template && template.kind === kind);
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
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: templateSettingSchema,
    },
    async (req, reply) => {
      const body = req.body as TemplateSettingBody;
      if (!isValidTemplate(body.kind, body.templateId)) {
        return reply.status(400).send({
          error: { code: 'INVALID_TEMPLATE', message: 'templateId not found' },
        });
      }
      const userId = req.user?.userId;
      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const created = await tx.docTemplateSetting.create({
          data: { ...body, createdBy: userId, updatedBy: userId },
        });
        if (body.isDefault === true) {
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
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as Partial<TemplateSettingBody>;
      const current = await prisma.docTemplateSetting.findUnique({
        where: { id },
      });
      if (!current) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const targetKind = body.kind ?? current.kind;
      const targetTemplateId = body.templateId ?? current.templateId;
      if (!isValidTemplate(targetKind, targetTemplateId)) {
        return reply.status(400).send({
          error: { code: 'INVALID_TEMPLATE', message: 'templateId not found' },
        });
      }
      const userId = req.user?.userId;
      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const updated = await tx.docTemplateSetting.update({
          where: { id },
          data: { ...body, updatedBy: userId },
        });
        if (body.isDefault === true) {
          await ensureDefault(tx, updated.kind, updated.id);
        }
        return updated;
      });
    },
  );
}
