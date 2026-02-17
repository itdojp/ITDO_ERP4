import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { FlowTypeValue, type FlowType } from '../types.js';
import { CHAT_ADMIN_ROLES } from './chat/shared/constants.js';
import {
  chatAckTemplatePatchSchema,
  chatAckTemplateSchema,
} from './validators.js';

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((item) => normalizeString(item))
    .filter((item) => item !== '');
  return items.length ? items : [];
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
}

function parseFlowType(value: string): FlowType | null {
  if (Object.prototype.hasOwnProperty.call(FlowTypeValue, value)) {
    return value as FlowType;
  }
  return null;
}

export async function registerChatAckTemplateRoutes(app: FastifyInstance) {
  app.get(
    '/chat-ack-templates',
    { preHandler: requireRole(CHAT_ADMIN_ROLES) },
    async (req, reply) => {
      const { flowType, actionKey } = req.query as {
        flowType?: string;
        actionKey?: string;
      };
      const where: Prisma.ChatAckTemplateWhereInput = {};
      if (flowType) {
        const parsed = parseFlowType(flowType);
        if (!parsed) {
          return reply.status(400).send({
            error: { code: 'INVALID_FLOW_TYPE', message: 'Invalid flowType' },
          });
        }
        where.flowType = parsed;
      }
      if (actionKey) where.actionKey = actionKey;
      const items = await prisma.chatAckTemplate.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
      });
      return { items };
    },
  );

  app.post(
    '/chat-ack-templates',
    {
      preHandler: requireRole(CHAT_ADMIN_ROLES),
      schema: chatAckTemplateSchema,
    },
    async (req, reply) => {
      const body = req.body as any;
      const parsedFlowType = parseFlowType(body.flowType);
      if (!parsedFlowType) {
        return reply.status(400).send({
          error: { code: 'INVALID_FLOW_TYPE', message: 'Invalid flowType' },
        });
      }
      const userId = req.user?.userId;
      const created = await prisma.chatAckTemplate.create({
        data: {
          flowType: parsedFlowType,
          actionKey: body.actionKey,
          messageBody: body.messageBody,
          requiredUserIds:
            normalizeStringArray(body.requiredUserIds) ?? undefined,
          requiredGroupIds:
            normalizeStringArray(body.requiredGroupIds) ?? undefined,
          requiredRoles: normalizeStringArray(body.requiredRoles) ?? undefined,
          dueInHours: normalizeOptionalNumber(body.dueInHours) ?? undefined,
          remindIntervalHours:
            normalizeOptionalNumber(body.remindIntervalHours) ?? undefined,
          escalationAfterHours:
            normalizeOptionalNumber(body.escalationAfterHours) ?? undefined,
          escalationUserIds:
            normalizeStringArray(body.escalationUserIds) ?? undefined,
          escalationGroupIds:
            normalizeStringArray(body.escalationGroupIds) ?? undefined,
          escalationRoles:
            normalizeStringArray(body.escalationRoles) ?? undefined,
          isEnabled: body.isEnabled ?? true,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await logAudit({
        action: 'chat_ack_template_created',
        targetTable: 'chat_ack_templates',
        targetId: created.id,
        metadata: {
          flowType: created.flowType,
          actionKey: created.actionKey,
          isEnabled: created.isEnabled,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });
      return created;
    },
  );

  app.patch(
    '/chat-ack-templates/:id',
    {
      preHandler: requireRole(CHAT_ADMIN_ROLES),
      schema: chatAckTemplatePatchSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as any;
      const current = await prisma.chatAckTemplate.findUnique({
        where: { id },
      });
      if (!current) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'ChatAckTemplate not found' },
        });
      }
      const userId = req.user?.userId;
      const updatePayload: Prisma.ChatAckTemplateUpdateInput = {
        updatedBy: userId,
      };
      if (Object.prototype.hasOwnProperty.call(body, 'flowType')) {
        const parsedFlowType = parseFlowType(body.flowType);
        if (!parsedFlowType) {
          return reply.status(400).send({
            error: { code: 'INVALID_FLOW_TYPE', message: 'Invalid flowType' },
          });
        }
        updatePayload.flowType = parsedFlowType;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'actionKey')) {
        updatePayload.actionKey = body.actionKey;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'messageBody')) {
        updatePayload.messageBody = body.messageBody;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'requiredUserIds')) {
        updatePayload.requiredUserIds =
          normalizeStringArray(body.requiredUserIds) ?? Prisma.DbNull;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'requiredGroupIds')) {
        updatePayload.requiredGroupIds =
          normalizeStringArray(body.requiredGroupIds) ?? Prisma.DbNull;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'requiredRoles')) {
        updatePayload.requiredRoles =
          normalizeStringArray(body.requiredRoles) ?? Prisma.DbNull;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'dueInHours')) {
        updatePayload.dueInHours =
          normalizeOptionalNumber(body.dueInHours) ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'remindIntervalHours')) {
        updatePayload.remindIntervalHours =
          normalizeOptionalNumber(body.remindIntervalHours) ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'escalationAfterHours')) {
        updatePayload.escalationAfterHours =
          normalizeOptionalNumber(body.escalationAfterHours) ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'escalationUserIds')) {
        updatePayload.escalationUserIds =
          normalizeStringArray(body.escalationUserIds) ?? Prisma.DbNull;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'escalationGroupIds')) {
        updatePayload.escalationGroupIds =
          normalizeStringArray(body.escalationGroupIds) ?? Prisma.DbNull;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'escalationRoles')) {
        updatePayload.escalationRoles =
          normalizeStringArray(body.escalationRoles) ?? Prisma.DbNull;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'isEnabled')) {
        updatePayload.isEnabled = body.isEnabled;
      }
      const updated = await prisma.chatAckTemplate.update({
        where: { id },
        data: updatePayload,
      });
      await logAudit({
        action: 'chat_ack_template_updated',
        targetTable: 'chat_ack_templates',
        targetId: updated.id,
        metadata: {
          flowType: updated.flowType,
          actionKey: updated.actionKey,
          isEnabled: updated.isEnabled,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });
      return updated;
    },
  );
}
