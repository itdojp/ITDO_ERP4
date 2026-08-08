import { Prisma } from '@prisma/client';
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
  resolveChatAckProjectIdForRoom,
  resolveChatAckRequiredRecipientUserIds,
  validateChatAckRequiredRecipientsForRoom,
} from '../../services/chatAckRecipients.js';
import { getChatAckLimits } from '../../services/chatAckLimits.js';
import { ensureChatRoomContentAccess } from '../../services/chatRoomAccess.js';
import { defaultChatNotificationPort } from '../../adapters/notifications/chatNotificationAdapter.js';
import { prismaChatThreadRepository } from '../../adapters/chat/prismaChatThreadAdapter.js';
import { createChatThreadMutationService } from '../../application/chat/chatThreadUseCases.js';
import {
  chatAckMutationService,
  type ChatAckMutationResult,
} from '../../application/chat/chatAckMutationService.js';
import {
  tryCreateChatMentionNotificationEffects,
  tryCreateChatMessageNotificationEffects,
} from '../../application/chat/chatNotificationEffects.js';
import { normalizeStringArray } from './shared/inputParsers.js';
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

function chatActorFromRequest(req: FastifyRequest, userId: string) {
  return {
    userId,
    roles: normalizeStringArray(req.user?.roles, { dedupe: true }),
    projectIds: normalizeStringArray(req.user?.projectIds, { dedupe: true }),
    groupIds: normalizeStringArray(req.user?.groupIds, { dedupe: true }),
    groupAccountIds: normalizeStringArray(req.user?.groupAccountIds, {
      dedupe: true,
    }),
  };
}

async function findVisibleAckRequest(options: {
  requestId: string;
  actor: ReturnType<typeof chatActorFromRequest>;
}) {
  return prisma.$transaction(
    async (transaction) => {
      const target = await transaction.chatAckRequest.findUnique({
        where: { id: options.requestId },
        select: {
          id: true,
          roomId: true,
          message: {
            select: {
              id: true,
              roomId: true,
              deletedAt: true,
            },
          },
        },
      });
      if (
        !target ||
        target.message.deletedAt ||
        target.roomId !== target.message.roomId
      ) {
        return null;
      }

      const access = await ensureChatRoomContentAccess({
        roomId: target.message.roomId,
        userId: options.actor.userId,
        roles: options.actor.roles,
        projectIds: options.actor.projectIds,
        groupIds: options.actor.groupIds,
        groupAccountIds: options.actor.groupAccountIds,
        accessLevel: 'read',
        client: transaction as unknown as typeof prisma,
      });
      if (!access.ok) return null;

      const requestItem = await transaction.chatAckRequest.findUnique({
        where: { id: target.id },
        select: {
          id: true,
          messageId: true,
          roomId: true,
          requiredUserIds: true,
          requestedUserIds: true,
          requestedGroupIds: true,
          requestedRoles: true,
          dueAt: true,
          remindIntervalHours: true,
          escalationAfterHours: true,
          escalationUserIds: true,
          escalationGroupIds: true,
          escalationRoles: true,
          templateId: true,
          canceledAt: true,
          canceledBy: true,
          createdAt: true,
          createdBy: true,
        },
      });
      if (!requestItem) return null;
      const message = await transaction.chatMessage.findUnique({
        where: { id: target.message.id },
        select: {
          id: true,
          roomId: true,
          messageType: true,
          parentMessageId: true,
          threadRootId: true,
          userId: true,
          body: true,
          tags: true,
          reactions: true,
          mentions: true,
          mentionsAll: true,
          createdAt: true,
          createdBy: true,
          updatedAt: true,
          updatedBy: true,
          deletedAt: true,
          deletedReason: true,
        },
      });
      if (
        !message ||
        message.deletedAt ||
        message.roomId !== requestItem.roomId
      ) {
        return null;
      }
      const acks = await transaction.chatAck.findMany({
        where: { requestId: requestItem.id },
      });
      const links = await transaction.chatAckLink.findMany({
        where: { ackRequestId: requestItem.id },
      });
      return { ...requestItem, message, acks, links };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

function sendAckMutationError(
  reply: FastifyReply,
  reason: Extract<ChatAckMutationResult, { ok: false }>['reason'],
) {
  if (reason === 'not_found') {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'Ack request not found' },
    });
  }
  if (reason === 'canceled') {
    return reply.status(409).send({
      error: { code: 'CANCELED', message: 'Ack request is canceled' },
    });
  }
  if (reason === 'not_required') {
    return reply.status(403).send({
      error: {
        code: 'NOT_REQUIRED',
        message: 'User is not in requiredUserIds',
      },
    });
  }
  return reply.status(403).send({
    error: { code: 'FORBIDDEN', message: 'Cannot cancel this request' },
  });
}

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
  const threadMutationService = createChatThreadMutationService({
    repository: prismaChatThreadRepository,
  });
  const {
    chatRoles,
    resolveActiveProjectRoom,
    ensureAllMentionAllowed,
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
        parentMessageId?: string;
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
      const canonicalProjectId =
        resolveChatAckProjectIdForRoom(room) ?? projectId;
      const threadActor = {
        userId,
        roles: req.user?.roles ?? [],
        projectIds: req.user?.projectIds ?? [],
        groupIds: req.user?.groupIds ?? [],
        groupAccountIds: req.user?.groupAccountIds ?? [],
      };
      if (body.parentMessageId) {
        const target = await threadMutationService.prepareReply({
          actor: threadActor,
          rootMessageId: body.parentMessageId,
          expectedRoomId: room.id,
        });
        if (!target.ok) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Chat thread not found' },
          });
        }
      }
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

      const replyCreation = body.parentMessageId
        ? await threadMutationService.createReply({
            actor: threadActor,
            rootMessageId: body.parentMessageId,
            expectedRoomId: room.id,
            draft: {
              body: body.body,
              tags: normalizeStringArray(body.tags, { max: 8 }) || undefined,
              mentions,
              mentionsAll,
              ackRequest: {
                requiredUserIds: validatedRequiredUserIds,
                requestedUserIds,
                requestedGroupIds,
                requestedRoles,
                dueAt: dueAt ?? undefined,
              },
            },
          })
        : null;
      if (body.parentMessageId && !replyCreation?.ok) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Chat thread not found' },
        });
      }
      const message = replyCreation?.ok
        ? replyCreation.value.message
        : await prisma.chatMessage.create({
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
            include: { ackRequest: { include: { acks: true } } },
          });
      if (!message.ackRequest) {
        throw new Error('Expected ackRequest to be created for chat message');
      }
      await logChatAckRequestCreated({
        auditContext: auditContextFromRequest(req, { userId }),
        actorUserId: userId,
        projectId: canonicalProjectId,
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
        projectId: canonicalProjectId,
        mentionsAll,
        mentionUserIds,
        mentionGroupIds,
      });
      const mentionRecipients = await tryCreateChatMentionNotificationEffects({
        auditContext: auditContextFromRequest(req),
        logger: req.log,
        notificationPort: defaultChatNotificationPort,
        projectId: canonicalProjectId,
        room,
        messageId: message.id,
        messageBody: message.body ?? '',
        senderUserId: userId,
        mentionsAll,
        mentionUserIds,
        mentionGroupIds,
      });
      if (body.parentMessageId) {
        await tryCreateChatMessageNotificationEffects({
          auditContext: auditContextFromRequest(req),
          logger: req.log,
          failureMessage: 'Failed to create project chat reply notifications',
          notificationPort: defaultChatNotificationPort,
          projectId: canonicalProjectId,
          room,
          messageId: message.id,
          messageBody: message.body ?? '',
          senderUserId: userId,
          excludeUserIds: mentionRecipients,
        });
      }
      await tryCreateChatAckRequiredNotificationsWithAudit({
        auditContext: auditContextFromRequest(req, { userId }),
        logger: req.log,
        actorUserId: userId,
        projectId: canonicalProjectId,
        roomId: room.id,
        messageId: message.id,
        messageBody: message.body ?? '',
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
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const result = await chatAckMutationService.acknowledge({
        requestId: id,
        actor: chatActorFromRequest(req, userId),
      });
      if (!result.ok) return sendAckMutationError(reply, result.reason);
      if (result.value.changed) {
        await logAudit({
          action: 'chat_ack_added',
          targetTable: 'chat_ack_requests',
          targetId: result.value.request.id,
          metadata: {
            requiredUserCount: result.value.requiredUserCount,
            ackedCount: result.value.ackedCount,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req, { userId }),
        });
      }
      return result.value.request;
    },
  );

  app.get(
    '/chat-ack-requests/:id',
    {
      preHandler: requireRole(chatRoles),
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const requestItem = await findVisibleAckRequest({
        requestId: id,
        actor: chatActorFromRequest(req, userId),
      });
      if (!requestItem) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Ack request not found' },
        });
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

      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const result = await chatAckMutationService.cancel({
        requestId: id,
        actor: chatActorFromRequest(req, userId),
      });
      if (!result.ok) return sendAckMutationError(reply, result.reason);
      if (result.value.changed) {
        await logAudit({
          action: 'chat_ack_request_canceled',
          targetTable: 'chat_ack_requests',
          targetId: result.value.request.id,
          metadata: {
            canceledAt: result.value.request.canceledAt?.toISOString() ?? null,
            isPrivileged: result.value.isPrivileged === true,
            requiredUserCount: result.value.requiredUserCount,
            ackedCount: result.value.ackedCount,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req, {
            userId,
            reasonText: reason || undefined,
          }),
        });
      }
      return result.value.request;
    },
  );

  app.post(
    '/chat-ack-requests/:id/revoke',
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const result = await chatAckMutationService.revoke({
        requestId: id,
        actor: chatActorFromRequest(req, userId),
      });
      if (!result.ok) return sendAckMutationError(reply, result.reason);
      if (result.value.changed) {
        await logAudit({
          action: 'chat_ack_revoked',
          targetTable: 'chat_ack_requests',
          targetId: result.value.request.id,
          metadata: {
            requiredUserCount: result.value.requiredUserCount,
            ackedCount: result.value.ackedCount,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req, { userId }),
        });
      }
      return result.value.request;
    },
  );
}
