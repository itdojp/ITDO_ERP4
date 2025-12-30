import { FastifyInstance } from 'fastify';
import { Prisma, type TemplateKind } from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { getPdfTemplate } from '../services/pdfTemplates.js';
import {
  templateSettingPatchSchema,
  templateSettingSchema,
} from './validators.js';

const TEMPLATE_KINDS: TemplateKind[] = [
  'estimate',
  'invoice',
  'purchase_order',
];

type TemplateSettingBody = {
  kind: TemplateKind;
  templateId: string;
  numberRule: string;
  layoutConfig?: Prisma.InputJsonValue | null;
  logoUrl?: string | null;
  signatureText?: string | null;
  isDefault?: boolean | null;
};

async function ensureDefault(
  tx: Prisma.TransactionClient,
  kind: TemplateKind,
  targetId: string,
) {
  await tx.docTemplateSetting.updateMany({
    where: { kind, id: { not: targetId } },
    data: { isDefault: false },
  });
}

function isValidTemplate(kind: TemplateKind, templateId: string) {
  const template = getPdfTemplate(templateId);
  return Boolean(template && template.kind === kind);
}

function parseTemplateKind(value?: string): TemplateKind | null {
  if (!value) return null;
  if (TEMPLATE_KINDS.includes(value as TemplateKind)) {
    return value as TemplateKind;
  }
  return null;
}

function normalizeJsonInput(value: Prisma.InputJsonValue | null | undefined) {
  if (value === null) return Prisma.DbNull;
  return value;
}

export async function registerTemplateSettingRoutes(app: FastifyInstance) {
  app.get(
    '/template-settings',
    { preHandler: requireRole(['admin', 'mgmt']) },
    async (req, reply) => {
      const { kind: rawKind } = req.query as { kind?: string };
      const kind = parseTemplateKind(rawKind);
      if (rawKind && !kind) {
        return reply.status(400).send({
          error: { code: 'INVALID_KIND', message: 'kind is invalid' },
        });
      }
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
          data: {
            ...body,
            layoutConfig: normalizeJsonInput(body.layoutConfig),
            createdBy: userId,
            updatedBy: userId,
          },
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
      const updatePayload = { ...body };
      if (Object.prototype.hasOwnProperty.call(body, 'layoutConfig')) {
        updatePayload.layoutConfig = normalizeJsonInput(body.layoutConfig);
      }
      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const updated = await tx.docTemplateSetting.update({
          where: { id },
          data: { ...updatePayload, updatedBy: userId },
        });
        if (body.isDefault === true) {
          await ensureDefault(tx, updated.kind, updated.id);
        }
        return updated;
      });
    },
  );
}
