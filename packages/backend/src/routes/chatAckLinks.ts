import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import {
  isAllowedChatAckLinkTargetTable,
  validateChatAckLinkTarget,
} from '../services/chatAckLinkTargets.js';
import { CHAT_ADMIN_ROLES } from './chat/shared/constants.js';
import {
  chatAckLinkCreateSchema,
  chatAckLinkQuerySchema,
} from './validators.js';

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalString(value: unknown) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeLimit(value: unknown) {
  if (value === undefined || value === null) return 50;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

export async function registerChatAckLinkRoutes(app: FastifyInstance) {
  app.get(
    '/chat-ack-links',
    {
      preHandler: requireRole(CHAT_ADMIN_ROLES),
      schema: chatAckLinkQuerySchema,
    },
    async (req, reply) => {
      const query = req.query as {
        ackRequestId?: string;
        messageId?: string;
        targetTable?: string;
        targetId?: string;
        limit?: number;
      };
      const ackRequestId = normalizeString(query.ackRequestId);
      const messageId = normalizeString(query.messageId);
      const targetTable = normalizeString(query.targetTable);
      const targetId = normalizeString(query.targetId);
      if (!ackRequestId && !messageId && !targetTable) {
        return reply.status(400).send({
          error: {
            code: 'MISSING_QUERY',
            message:
              'ackRequestId or messageId or (targetTable and targetId) is required',
          },
        });
      }
      if (targetTable && !targetId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_QUERY',
            message: 'targetId is required when targetTable is provided',
          },
        });
      }
      if (targetTable && !isAllowedChatAckLinkTargetTable(targetTable)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_TARGET_TABLE',
            message: 'targetTable is not allowed',
          },
        });
      }
      const where: Prisma.ChatAckLinkWhereInput = {};
      if (ackRequestId) where.ackRequestId = ackRequestId;
      if (messageId) where.messageId = messageId;
      if (targetTable) {
        where.targetTable = targetTable;
        where.targetId = targetId;
      }
      const items = await prisma.chatAckLink.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: normalizeLimit(query.limit),
      });
      return { items };
    },
  );

  app.post(
    '/chat-ack-links',
    {
      preHandler: requireRole(CHAT_ADMIN_ROLES),
      schema: chatAckLinkCreateSchema,
    },
    async (req, reply) => {
      const body = req.body as {
        ackRequestId?: string;
        messageId?: string;
        targetTable: string;
        targetId: string;
        flowType?: string;
        actionKey?: string;
      };
      const userId = req.user?.userId || null;
      const ackRequestId = normalizeString(body.ackRequestId);
      const messageId = normalizeString(body.messageId);
      const targetTable = normalizeString(body.targetTable);
      const targetId = normalizeString(body.targetId);
      if (!ackRequestId && !messageId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_INPUT',
            message: 'ackRequestId or messageId is required',
          },
        });
      }
      if (!targetTable || !targetId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_INPUT',
            message: 'targetTable/targetId is required',
          },
        });
      }

      const targetValidation = await validateChatAckLinkTarget({
        targetTable,
        targetId,
      });
      if (!targetValidation.ok) {
        const statusCode =
          targetValidation.reason === 'target_not_found' ? 404 : 400;
        return reply.status(statusCode).send({
          error: {
            code:
              targetValidation.reason === 'target_not_found'
                ? 'TARGET_NOT_FOUND'
                : 'INVALID_TARGET_TABLE',
            message:
              targetValidation.reason === 'target_not_found'
                ? 'Target not found'
                : 'targetTable is not allowed',
          },
        });
      }

      const ackRequest = ackRequestId
        ? await prisma.chatAckRequest.findUnique({
            where: { id: ackRequestId },
            select: {
              id: true,
              messageId: true,
              canceledAt: true,
              message: { select: { deletedAt: true } },
            },
          })
        : await prisma.chatAckRequest.findUnique({
            where: { messageId },
            select: {
              id: true,
              messageId: true,
              canceledAt: true,
              message: { select: { deletedAt: true } },
            },
          });
      if (!ackRequest) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Ack request not found' },
        });
      }
      if (ackRequest.message?.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Ack request not found' },
        });
      }
      if (ackRequest.canceledAt) {
        return reply.status(409).send({
          error: {
            code: 'ACK_REQUEST_CANCELED',
            message: 'Ack request has been canceled',
          },
        });
      }

      const flowType = normalizeOptionalString(body.flowType);
      const actionKey = normalizeOptionalString(body.actionKey);

      try {
        const created = await prisma.chatAckLink.create({
          data: {
            ackRequestId: ackRequest.id,
            messageId: ackRequest.messageId,
            targetTable: targetValidation.targetTable,
            targetId: targetValidation.targetId,
            flowType: flowType ?? undefined,
            actionKey: actionKey ?? undefined,
            createdBy: userId,
            updatedBy: userId,
          },
        });

        await logAudit({
          action: 'chat_ack_link_created',
          targetTable: 'chat_ack_links',
          targetId: created.id,
          metadata: {
            ackRequestId: created.ackRequestId,
            messageId: created.messageId,
            targetTable: created.targetTable,
            targetId: created.targetId,
            flowType: created.flowType ?? null,
            actionKey: created.actionKey ?? null,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req),
        });

        return created;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return reply.status(409).send({
            error: {
              code: 'DUPLICATE_LINK',
              message: 'Link already exists',
            },
          });
        }
        throw error;
      }
    },
  );

  app.delete(
    '/chat-ack-links/:id',
    { preHandler: requireRole(CHAT_ADMIN_ROLES) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = await prisma.chatAckLink.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Link not found' },
        });
      }
      await prisma.chatAckLink.delete({ where: { id } });

      await logAudit({
        action: 'chat_ack_link_deleted',
        targetTable: 'chat_ack_links',
        targetId: existing.id,
        metadata: {
          ackRequestId: existing.ackRequestId,
          messageId: existing.messageId,
          targetTable: existing.targetTable,
          targetId: existing.targetId,
          flowType: existing.flowType ?? null,
          actionKey: existing.actionKey ?? null,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return { ok: true };
    },
  );
}
