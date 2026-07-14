import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  chatAckPreviewSchema,
  chatAckRequestCancelSchema,
  projectChatAckRequestSchema,
} from '../validators.js';
import { prisma } from '../../services/db.js';
import { requireProjectAccess, requireRole } from '../../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../../services/audit.js';
import {
  logChatAckRequestCreated,
  tryCreateChatAckRequiredNotificationsWithAudit,
} from '../../services/chatAckNotifications.js';
import {
  previewChatAckRecipients,
  resolveChatAckRequiredRecipientUserIds,
  validateChatAckRequiredRecipientsForRoom,
} from '../../services/chatAckRecipients.js';
import { getChatAckLimits } from '../../services/chatAckLimits.js';
import { defaultChatNotificationPort } from '../../adapters/notifications/chatNotificationAdapter.js';
import { tryCreateChatMentionNotificationEffects } from '../../application/chat/chatNotificationEffects.js';
import { normalizeStringArray } from './shared/inputParsers.js';
import { resolveAckRequiredTarget } from './shared/ackRequiredTarget.js';
import { normalizeMentions } from './shared/mentions.js';
import { requireUserId } from './shared/requireUserId.js';
import { parseDateParam } from '../../utils/date.js';

type ResolveActiveProjectRoom = (options: {
  projectId: string;
  userId: string | null;
  reply: FastifyReply;
  req?: FastifyRequest;
  accessLevel?: 'read' | 'post';
}) => Promise<any | null>;

type EnsureAllMentionAllowed = (options: {
  req: FastifyRequest;
  reply: FastifyReply;
  roomId: string;
  userId: string;
}) => Promise<boolean>;

type EnsureRoomContentAccessFromRequest = (options: {
  req: FastifyRequest;
  reply: FastifyReply;
  roomId: string;
  userId: string;
  accessLevel?: 'read' | 'post';
}) => Promise<any | null>;

type LogChatMessageMentions = (options: {
  req: FastifyRequest;
  messageId: string;
  projectId: string;
  mentionsAll: boolean;
  mentionUserIds: string[];
  mentionGroupIds: string[];
}) => Promise<void>;

export function registerChatAckRequestRoutes(
  app: FastifyInstance,
  deps: {
    chatRoles: readonly string[];
    resolveActiveProjectRoom: ResolveActiveProjectRoom;
    ensureAllMentionAllowed: EnsureAllMentionAllowed;
    ensureRoomContentAccessFromRequest: EnsureRoomContentAccessFromRequest;
    logChatMessageMentions: LogChatMessageMentions;
  },
) {
  const {
    chatRoles,
    resolveActiveProjectRoom,
    ensureAllMentionAllowed,
    ensureRoomContentAccessFromRequest,
    logChatMessageMentions,
  } = deps;

  app.post(
    '/projects/:projectId/chat-ack-requests/preview',
    {
      schema: { ...chatAckPreviewSchema, deprecated: true },
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as {
        requiredUserIds?: string[];
        requiredGroupIds?: string[];
        requiredRoles?: string[];
      };
      const userId = req.user?.userId || 'demo-user';
      const limits = await getChatAckLimits();
      const requiredUserIds = normalizeStringArray(body.requiredUserIds, {
        dedupe: true,
      });
      const requiredGroupIds = normalizeStringArray(body.requiredGroupIds, {
        dedupe: true,
      });
      const requiredRoles = normalizeStringArray(body.requiredRoles, {
        dedupe: true,
      });
      if (requiredUserIds.length > limits.maxUsers) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_REQUIRED_USERS',
            message: `requiredUserIds must be at most ${limits.maxUsers} entries`,
            details: { requestedUserCount: requiredUserIds.length },
          },
        });
      }
      if (requiredGroupIds.length > limits.maxGroups) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_REQUIRED_USERS',
            message: `requiredGroupIds must be at most ${limits.maxGroups} entries`,
            details: { requestedGroupCount: requiredGroupIds.length },
          },
        });
      }
      if (requiredRoles.length > limits.maxRoles) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_REQUIRED_USERS',
            message: `requiredRoles must be at most ${limits.maxRoles} entries`,
            details: { requestedRoleCount: requiredRoles.length },
          },
        });
      }

      const room = await resolveActiveProjectRoom({
        projectId,
        userId,
        reply,
        req,
        accessLevel: 'read',
      });
      if (!room) return reply;

      const preview = await previewChatAckRecipients({
        room,
        requiredUserIds,
        requiredGroupIds,
        requiredRoles,
        maxResolvedUsers: limits.maxUsers,
      });
      return preview;
    },
  );

  app.post(
    '/projects/:projectId/chat-ack-requests',
    {
      schema: { ...projectChatAckRequestSchema, deprecated: true },
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as {
        body: string;
        requiredUserIds?: string[];
        requiredGroupIds?: string[];
        requiredRoles?: string[];
        dueAt?: string;
        tags?: string[];
        mentions?: unknown;
      };
      const userId = req.user?.userId || 'demo-user';
      const limits = await getChatAckLimits();
      const requestedUserIds = normalizeStringArray(body.requiredUserIds, {
        dedupe: true,
      });
      const requestedGroupIds = normalizeStringArray(body.requiredGroupIds, {
        dedupe: true,
      });
      const requestedRoles = normalizeStringArray(body.requiredRoles, {
        dedupe: true,
      });
      if (requestedGroupIds.length > limits.maxGroups) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_REQUIRED_USERS',
            message: `requiredGroupIds must be at most ${limits.maxGroups} entries`,
            details: { requestedGroupCount: requestedGroupIds.length },
          },
        });
      }
      if (requestedRoles.length > limits.maxRoles) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_REQUIRED_USERS',
            message: `requiredRoles must be at most ${limits.maxRoles} entries`,
            details: { requestedRoleCount: requestedRoles.length },
          },
        });
      }
      const dueAt = parseDateParam(body.dueAt);
      if (body.dueAt && !dueAt) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid dueAt date-time' },
        });
      }

      const { mentions, mentionsAll, mentionUserIds, mentionGroupIds } =
        normalizeMentions(body.mentions);
      const room = await resolveActiveProjectRoom({
        projectId,
        userId,
        reply,
        req,
        accessLevel: 'post',
      });
      if (!room) return reply;
      if (mentionsAll) {
        const ok = await ensureAllMentionAllowed({
          req,
          reply,
          roomId: room.id,
          userId,
        });
        if (!ok) return;
      }

      const requiredUserIds = await resolveChatAckRequiredRecipientUserIds({
        requiredUserIds: requestedUserIds,
        requiredGroupIds: requestedGroupIds,
        requiredRoles: requestedRoles,
      });
      if (!requiredUserIds.length) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_REQUIRED_USERS',
            message:
              'requiredUserIds/requiredGroupIds/requiredRoles must contain at least one entry',
          },
        });
      }
      if (requiredUserIds.length > limits.maxUsers) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_REQUIRED_USERS',
            message: `requiredUserIds must be at most ${limits.maxUsers} users after expansion`,
            details: {
              resolvedUserCount: requiredUserIds.length,
              limit: limits.maxUsers,
            },
          },
        });
      }
      const recipientValidation =
        await validateChatAckRequiredRecipientsForRoom({
          room,
          requiredUserIds,
        });
      if (!recipientValidation.ok) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_REQUIRED_USERS',
            message:
              'requiredUserIds must be active users who can access this room',
            details: {
              reason: recipientValidation.reason,
              invalidUserIds: recipientValidation.invalidUserIds.slice(0, 20),
            },
          },
        });
      }
      const validatedRequiredUserIds = recipientValidation.validUserIds;

      const message = await prisma.chatMessage.create({
        data: {
          roomId: room.id,
          userId,
          body: body.body,
          tags: normalizeStringArray(body.tags, { max: 8 }) || undefined,
          mentions,
          mentionsAll,
          createdBy: userId,
          updatedBy: userId,
          ackRequest: {
            create: {
              roomId: room.id,
              requiredUserIds: validatedRequiredUserIds,
              requestedUserIds,
              requestedGroupIds,
              requestedRoles,
              dueAt: dueAt ?? undefined,
              createdBy: userId,
            },
          },
        },
        include: {
          ackRequest: {
            include: { acks: true },
          },
        },
      });
      if (!message.ackRequest) {
        throw new Error('Expected ackRequest to be created for chat message');
      }
      await logChatAckRequestCreated({
        auditContext: auditContextFromRequest(req, { userId }),
        actorUserId: userId,
        projectId,
        roomId: room.id,
        messageId: message.id,
        ackRequestId: message.ackRequest.id,
        requiredUserIds: validatedRequiredUserIds,
        requestedUserIds,
        requestedGroupIds,
        requestedRoles,
        dueAt: message.ackRequest.dueAt,
      });
      await logChatMessageMentions({
        req,
        messageId: message.id,
        projectId,
        mentionsAll,
        mentionUserIds,
        mentionGroupIds,
      });
      await tryCreateChatMentionNotificationEffects({
        auditContext: auditContextFromRequest(req),
        logger: req.log,
        notificationPort: defaultChatNotificationPort,
        projectId,
        room,
        messageId: message.id,
        messageBody: message.body,
        senderUserId: userId,
        mentionsAll,
        mentionUserIds,
        mentionGroupIds,
      });
      await tryCreateChatAckRequiredNotificationsWithAudit({
        auditContext: auditContextFromRequest(req, { userId }),
        logger: req.log,
        actorUserId: userId,
        projectId,
        roomId: room.id,
        messageId: message.id,
        messageBody: message.body,
        requiredUserIds: validatedRequiredUserIds,
        dueAt: message.ackRequest.dueAt,
      });
      return message;
    },
  );

  app.post(
    '/chat-ack-requests/:id/ack',
    {
      preHandler: requireRole(chatRoles),
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const requestItem = await prisma.chatAckRequest.findUnique({
        where: { id },
        include: {
          message: true,
          acks: true,
        },
      });
      if (!requestItem || requestItem.message.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Ack request not found' },
        });
      }
      if (requestItem.canceledAt) {
        return reply.status(409).send({
          error: {
            code: 'CANCELED',
            message: 'Ack request is canceled',
          },
        });
      }

      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      if (
        !(await ensureRoomContentAccessFromRequest({
          req,
          reply,
          roomId: requestItem.roomId,
          userId,
        }))
      ) {
        return;
      }
      const ackTarget = resolveAckRequiredTarget(
        requestItem.requiredUserIds,
        userId,
      );
      if (!ackTarget.isRequired) {
        return reply.status(403).send({
          error: {
            code: 'NOT_REQUIRED',
            message: 'User is not in requiredUserIds',
          },
        });
      }

      const alreadyAcked = requestItem.acks.some(
        (ack) => ack.userId === userId,
      );
      await prisma.chatAck.upsert({
        where: {
          requestId_userId: {
            requestId: requestItem.id,
            userId,
          },
        },
        update: {},
        create: {
          requestId: requestItem.id,
          userId,
        },
      });

      const updated = await prisma.chatAckRequest.findUnique({
        where: { id: requestItem.id },
        include: { acks: true },
      });
      if (!alreadyAcked) {
        await logAudit({
          action: 'chat_ack_added',
          targetTable: 'chat_ack_requests',
          targetId: requestItem.id,
          metadata: {
            roomId: requestItem.roomId,
            messageId: requestItem.messageId,
            userId,
            requiredUserCount: ackTarget.requiredUserCount,
            ackedCount: updated?.acks?.length ?? null,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req, { userId }),
        });
      }
      return updated;
    },
  );

  app.get(
    '/chat-ack-requests/:id',
    {
      preHandler: requireRole(chatRoles),
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const requestItem = await prisma.chatAckRequest.findUnique({
        where: { id },
        include: {
          message: true,
          acks: true,
          links: true,
        },
      });
      if (!requestItem || requestItem.message.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Ack request not found' },
        });
      }

      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      if (
        !(await ensureRoomContentAccessFromRequest({
          req,
          reply,
          roomId: requestItem.roomId,
          userId,
        }))
      ) {
        return;
      }

      return requestItem;
    },
  );

  app.post(
    '/chat-ack-requests/:id/cancel',
    {
      schema: chatAckRequestCancelSchema,
      preHandler: requireRole(chatRoles),
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body || {}) as { reason?: string };
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

      const requestItem = await prisma.chatAckRequest.findUnique({
        where: { id },
        include: {
          message: true,
          acks: true,
        },
      });
      if (!requestItem || requestItem.message.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Ack request not found' },
        });
      }

      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const roles = req.user?.roles || [];
      if (
        !(await ensureRoomContentAccessFromRequest({
          req,
          reply,
          roomId: requestItem.roomId,
          userId,
        }))
      ) {
        return;
      }

      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      const isOwner =
        requestItem.message.userId === userId ||
        requestItem.createdBy === userId;
      if (!isOwner && !isPrivileged) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Cannot cancel this request' },
        });
      }

      if (!requestItem.canceledAt) {
        const canceledAt = new Date();
        const updated = await prisma.chatAckRequest.updateMany({
          where: { id: requestItem.id, canceledAt: null },
          data: { canceledAt, canceledBy: userId },
        });
        if (updated.count > 0) {
          await logAudit({
            action: 'chat_ack_request_canceled',
            targetTable: 'chat_ack_requests',
            targetId: requestItem.id,
            metadata: {
              roomId: requestItem.roomId,
              messageId: requestItem.messageId,
              canceledAt: canceledAt.toISOString(),
              canceledBy: userId,
              isPrivileged,
            } as Prisma.InputJsonValue,
            ...auditContextFromRequest(req, {
              userId,
              reasonText: reason || undefined,
            }),
          });
        }
      }

      return prisma.chatAckRequest.findUnique({
        where: { id: requestItem.id },
        include: { acks: true },
      });
    },
  );

  app.post(
    '/chat-ack-requests/:id/revoke',
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const requestItem = await prisma.chatAckRequest.findUnique({
        where: { id },
        include: {
          message: true,
          acks: true,
        },
      });
      if (!requestItem || requestItem.message.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Ack request not found' },
        });
      }
      if (requestItem.canceledAt) {
        return reply.status(409).send({
          error: {
            code: 'CANCELED',
            message: 'Ack request is canceled',
          },
        });
      }

      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      if (
        !(await ensureRoomContentAccessFromRequest({
          req,
          reply,
          roomId: requestItem.roomId,
          userId,
        }))
      ) {
        return;
      }

      const ackTarget = resolveAckRequiredTarget(
        requestItem.requiredUserIds,
        userId,
      );
      if (!ackTarget.isRequired) {
        return reply.status(403).send({
          error: {
            code: 'NOT_REQUIRED',
            message: 'User is not in requiredUserIds',
          },
        });
      }

      const deleted = await prisma.chatAck.deleteMany({
        where: {
          requestId: requestItem.id,
          userId,
        },
      });
      const updated = await prisma.chatAckRequest.findUnique({
        where: { id: requestItem.id },
        include: { acks: true },
      });
      if (deleted.count > 0) {
        await logAudit({
          action: 'chat_ack_revoked',
          targetTable: 'chat_ack_requests',
          targetId: requestItem.id,
          metadata: {
            roomId: requestItem.roomId,
            messageId: requestItem.messageId,
            userId,
            requiredUserCount: ackTarget.requiredUserCount,
            ackedCount: updated?.acks?.length ?? null,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req, { userId }),
        });
      }

      return updated;
    },
  );
}
