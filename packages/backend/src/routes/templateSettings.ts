import { FastifyInstance } from 'fastify';
import { Prisma, type TemplateKind } from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { getPdfTemplate } from '../services/pdfTemplates.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
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

function normalizeJsonInput(
  value: Prisma.InputJsonValue | null | undefined,
): Prisma.InputJsonValue | Prisma.NullTypes.DbNull | undefined {
  if (value === null) return Prisma.DbNull;
  return value;
}

function normalizeBoolean(value: boolean | null | undefined) {
  if (value === null) return undefined;
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
      const created = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const created = await tx.docTemplateSetting.create({
            data: {
              ...body,
              layoutConfig: normalizeJsonInput(body.layoutConfig),
              isDefault: normalizeBoolean(body.isDefault),
              createdBy: userId,
              updatedBy: userId,
            },
          });
          if (body.isDefault === true) {
            await ensureDefault(tx, created.kind, created.id);
          }
          return created;
        },
      );
      await logAudit({
        action: 'template_setting_created',
        targetTable: 'doc_template_settings',
        targetId: created.id,
        metadata: { kind: created.kind, templateId: created.templateId },
        ...auditContextFromRequest(req),
      });
      return created;
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
      const updatePayload: Prisma.DocTemplateSettingUpdateInput = {
        updatedBy: userId,
      };
      if (Object.prototype.hasOwnProperty.call(body, 'kind')) {
        updatePayload.kind = body.kind;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'templateId')) {
        updatePayload.templateId = body.templateId;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'numberRule')) {
        updatePayload.numberRule = body.numberRule;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'layoutConfig')) {
        updatePayload.layoutConfig = normalizeJsonInput(body.layoutConfig);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'logoUrl')) {
        updatePayload.logoUrl = body.logoUrl ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'signatureText')) {
        updatePayload.signatureText = body.signatureText ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'isDefault')) {
        updatePayload.isDefault = normalizeBoolean(body.isDefault);
      }
      const updated = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const updated = await tx.docTemplateSetting.update({
            where: { id },
            data: updatePayload,
          });
          if (body.isDefault === true) {
            await ensureDefault(tx, updated.kind, updated.id);
          }
          return updated;
        },
      );
      await logAudit({
        action: 'template_setting_updated',
        targetTable: 'doc_template_settings',
        targetId: updated.id,
        metadata: { kind: updated.kind, templateId: updated.templateId },
        ...auditContextFromRequest(req),
      });
      return updated;
    },
  );
}
