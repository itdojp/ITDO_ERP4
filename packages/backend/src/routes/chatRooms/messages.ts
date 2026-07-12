import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';

import { defaultChatNotificationPort } from '../../adapters/notifications/chatNotificationAdapter.js';
import {
  tryCreateChatMentionNotificationEffects,
  tryCreateChatMessageNotificationEffects,
} from '../../application/chat/chatNotificationEffects.js';
import { prisma } from '../../services/db.js';
import { requireRole } from '../../services/rbac.js';
import {
  getChatExternalLlmConfig,
  getChatExternalLlmRateLimit,
  summarizeWithExternalLlm,
} from '../../services/chatExternalLlm.js';
import {
  logChatAckRequestCreated,
  tryCreateChatAckRequiredNotificationsWithAudit,
} from '../../services/chatAckNotifications.js';
import {
  resolveChatAckRequiredRecipientUserIds,
  validateChatAckRequiredRecipientsForRoom,
  previewChatAckRecipients,
} from '../../services/chatAckRecipients.js';
import { getChatAckLimits } from '../../services/chatAckLimits.js';
import { auditContextFromRequest, logAudit } from '../../services/audit.js';
import { getRouteRateLimitOptions } from '../../services/rateLimitOverrides.js';
import {
  chatAckPreviewSchema,
  projectChatAckRequestSchema,
  projectChatMessageSchema,
  projectChatSummarySchema,
} from '../validators.js';
import { CHAT_ROLES } from '../chat/shared/constants.js';
import {
  normalizeStringArray,
  parseLimitNumber,
} from '../chat/shared/inputParsers.js';
import {
  buildAllMentionRateLimitMetadata,
  enforceAllMentionRateLimit,
} from '../chat/shared/allMentionRateLimit.js';
import { normalizeMentions } from '../chat/shared/mentions.js';
import { requireUserId } from '../chat/shared/requireUserId.js';
import { parseDateParam } from '../../utils/date.js';
import {
  ensureRoomAccessWithReasonError,
  readRoomAccessContext,
} from './shared.js';

export async function registerChatRoomMessageRoutes(app: FastifyInstance) {
  const chatRoles = CHAT_ROLES;
  const aiSummaryRateLimit = getRouteRateLimitOptions('RATE_LIMIT_AI_SUMMARY', {
    max: 20,
    timeWindow: '1 hour',
  });
  async function ensureAllMentionAllowed(options: {
    req: any;
    reply: any;
    roomId: string;
    userId: string;
  }) {
    const rateLimit = await enforceAllMentionRateLimit({
      roomId: options.roomId,
      userId: options.userId,
      now: new Date(),
    });
    if (!rateLimit.allowed) {
      await logAudit({
        action: 'chat_all_mention_blocked',
        targetTable: 'chat_messages',
        metadata: {
          roomId: options.roomId,
          ...buildAllMentionRateLimitMetadata(rateLimit),
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(options.req),
      });
      options.reply.status(429).send({
        error: {
          code: 'ALL_MENTION_RATE_LIMIT',
          message: 'Too many @all posts',
        },
      });
      return false;
    }

    return true;
  }

  app.post(
    '/chat-rooms/:roomId/ai-summary',
    {
      preHandler: requireRole(chatRoles),
      schema: projectChatSummarySchema,
      config: { rateLimit: aiSummaryRateLimit },
    },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const body = req.body as {
        since?: string;
        until?: string;
        limit?: number;
      };

      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;

      const config = getChatExternalLlmConfig();
      if (config.provider === 'disabled') {
        await logAudit({
          action: 'chat_external_llm_blocked',
          targetTable: 'chat_rooms',
          targetId: roomId,
          metadata: {
            reason: 'provider_not_configured',
            roomId,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req),
        });
        return reply.status(503).send({
          error: {
            code: 'EXTERNAL_LLM_NOT_CONFIGURED',
            message: 'external LLM provider is not configured',
          },
        });
      }

      const accessContext = readRoomAccessContext(req);
      const access = await ensureRoomAccessWithReasonError({
        reply,
        roomId,
        userId,
        accessContext,
        accessLevel: 'read',
      });
      if (!access) return reply;

      const room = await prisma.chatRoom.findUnique({
        where: { id: access.room.id },
        select: {
          id: true,
          type: true,
          isOfficial: true,
          allowExternalIntegrations: true,
          deletedAt: true,
        },
      });
      if (!room || room.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Room not found' },
        });
      }
      if (!room.isOfficial || !room.allowExternalIntegrations) {
        await logAudit({
          action: 'chat_external_llm_blocked',
          targetTable: 'chat_rooms',
          targetId: room.id,
          metadata: {
            reason: 'external_integrations_disabled',
            roomId: room.id,
            roomType: room.type,
            isOfficial: room.isOfficial,
            allowExternalIntegrations: room.allowExternalIntegrations,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req),
        });
        return reply.status(403).send({
          error: {
            code: 'EXTERNAL_INTEGRATIONS_DISABLED',
            message: 'external integrations are disabled for this room',
          },
        });
      }

      const sinceRaw = typeof body.since === 'string' ? body.since : undefined;
      const untilRaw = typeof body.until === 'string' ? body.until : undefined;
      let since = parseDateParam(sinceRaw);
      if (sinceRaw && !since) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid since date-time' },
        });
      }
      let until = parseDateParam(untilRaw);
      if (untilRaw && !until) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid until date-time' },
        });
      }

      const now = new Date();
      if (!since && !until) {
        until = now;
        since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      }

      const take = parseLimitNumber(body.limit, 120);
      if (!take) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_LIMIT',
            message: 'limit must be a positive number',
          },
        });
      }

      const createdAt =
        since && until
          ? { gte: since, lte: until }
          : since
            ? { gte: since }
            : until
              ? { lte: until }
              : undefined;

      const limits = getChatExternalLlmRateLimit();
      const windowStart = new Date(Date.now() - 60 * 60 * 1000);
      const [userCount, roomCount] = await Promise.all([
        prisma.auditLog.count({
          where: {
            action: 'chat_external_llm_requested',
            userId,
            createdAt: { gte: windowStart },
          },
        }),
        prisma.auditLog.count({
          where: {
            action: 'chat_external_llm_requested',
            targetTable: 'chat_rooms',
            targetId: room.id,
            createdAt: { gte: windowStart },
          },
        }),
      ]);
      if (userCount >= limits.userPerHour || roomCount >= limits.roomPerHour) {
        await logAudit({
          action: 'chat_external_llm_rate_limited',
          targetTable: 'chat_rooms',
          targetId: room.id,
          metadata: {
            roomId: room.id,
            roomType: room.type,
            userCount,
            roomCount,
            userPerHour: limits.userPerHour,
            roomPerHour: limits.roomPerHour,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req),
        });
        return reply.status(429).send({
          error: {
            code: 'RATE_LIMITED',
            message: 'external LLM rate limit exceeded',
          },
        });
      }

      const items = await prisma.chatMessage.findMany({
        where: {
          roomId: room.id,
          deletedAt: null,
          createdAt,
        },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          body: true,
        },
      });
      const bodies = items
        .slice()
        .reverse()
        .map((item) => item.body);

      const fromLabel = since ? since.toISOString() : null;
      const toLabel = until ? until.toISOString() : null;

      await logAudit({
        action: 'chat_external_llm_requested',
        targetTable: 'chat_rooms',
        targetId: room.id,
        metadata: {
          kind: 'room_summary',
          roomId: room.id,
          roomType: room.type,
          provider: config.provider,
          model: config.model,
          limit: take,
          since: fromLabel,
          until: toLabel,
          messageCount: bodies.length,
          resultStored: false,
          rateLimit: limits,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      const startedAt = Date.now();
      try {
        const result = await summarizeWithExternalLlm({ bodies });
        const elapsedMs = Date.now() - startedAt;
        await logAudit({
          action: 'chat_external_llm_succeeded',
          targetTable: 'chat_rooms',
          targetId: room.id,
          metadata: {
            kind: 'room_summary',
            provider: result.provider,
            model: result.model,
            elapsedMs,
            outputChars: result.summary.length,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req),
        });

        return {
          summary: result.summary,
          provider: result.provider,
          model: result.model,
          stats: {
            roomId: room.id,
            roomType: room.type,
            messageCount: bodies.length,
            since: fromLabel,
            until: toLabel,
          },
        };
      } catch (err) {
        const elapsedMs = Date.now() - startedAt;
        const message = err instanceof Error ? err.message : String(err);
        await logAudit({
          action: 'chat_external_llm_failed',
          targetTable: 'chat_rooms',
          targetId: room.id,
          metadata: {
            kind: 'room_summary',
            provider: config.provider,
            model: config.model,
            elapsedMs,
            error: message.slice(0, 300),
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req),
        });
        return reply.status(502).send({
          error: {
            code: 'EXTERNAL_LLM_FAILED',
            message: 'external LLM request failed',
          },
        });
      }
    },
  );

  app.post(
    '/chat-rooms/:roomId/messages',
    { preHandler: requireRole(chatRoles), schema: projectChatMessageSchema },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const body = req.body as {
        body: string;
        tags?: string[];
        mentions?: unknown;
      };
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const accessContext = readRoomAccessContext(req);
      const access = await ensureRoomAccessWithReasonError({
        reply,
        roomId,
        userId,
        accessContext,
        accessLevel: 'post',
      });
      if (!access) return reply;

      const { mentions, mentionsAll, mentionUserIds, mentionGroupIds } =
        normalizeMentions(body.mentions);
      if (mentionsAll) {
        const ok = await ensureAllMentionAllowed({
          req,
          reply,
          roomId: access.room.id,
          userId,
        });
        if (!ok) return;
      }

      const message = await prisma.chatMessage.create({
        data: {
          roomId: access.room.id,
          userId,
          body: body.body,
          tags: normalizeStringArray(body.tags, { max: 8 }) || undefined,
          mentions,
          mentionsAll,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      let mentionRecipients: string[] = [];
      if (mentionsAll || mentionUserIds.length || mentionGroupIds.length) {
        await logAudit({
          action: 'chat_message_posted_with_mentions',
          targetTable: 'chat_messages',
          targetId: message.id,
          metadata: {
            roomId: access.room.id,
            mentionAll: mentionsAll,
            mentionUserCount: mentionUserIds.length,
            mentionGroupCount: mentionGroupIds.length,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req),
        });
        mentionRecipients = await tryCreateChatMentionNotificationEffects({
          auditContext: auditContextFromRequest(req),
          logger: req.log,
          failureMessage: 'Failed to create room chat mention notifications',
          notificationPort: defaultChatNotificationPort,
          room: access.room,
          messageId: message.id,
          messageBody: message.body,
          senderUserId: userId,
          mentionsAll,
          mentionUserIds,
          mentionGroupIds,
        });
      }

      await tryCreateChatMessageNotificationEffects({
        auditContext: auditContextFromRequest(req),
        logger: req.log,
        failureMessage: 'Failed to create room chat message notifications',
        notificationPort: defaultChatNotificationPort,
        room: access.room,
        messageId: message.id,
        messageBody: message.body,
        senderUserId: userId,
        excludeUserIds: mentionRecipients,
      });

      if (access.postWithoutView) {
        return {
          ...message,
          warning: {
            code: 'POST_WITHOUT_VIEW',
            message:
              '投稿後、このルームを閲覧できません。閲覧権限を管理者に確認してください。',
          },
        };
      }
      return message;
    },
  );

  app.post(
    '/chat-rooms/:roomId/ack-requests/preview',
    { preHandler: requireRole(chatRoles), schema: chatAckPreviewSchema },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const body = req.body as {
        requiredUserIds?: string[];
        requiredGroupIds?: string[];
        requiredRoles?: string[];
      };
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const accessContext = readRoomAccessContext(req);
      const access = await ensureRoomAccessWithReasonError({
        reply,
        roomId,
        userId,
        accessContext,
        accessLevel: 'post',
      });
      if (!access) return reply;

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

      const preview = await previewChatAckRecipients({
        room: access.room,
        requiredUserIds,
        requiredGroupIds,
        requiredRoles,
        maxResolvedUsers: limits.maxUsers,
      });
      return preview;
    },
  );

  app.post(
    '/chat-rooms/:roomId/ack-requests',
    { preHandler: requireRole(chatRoles), schema: projectChatAckRequestSchema },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const body = req.body as {
        body: string;
        requiredUserIds?: string[];
        requiredGroupIds?: string[];
        requiredRoles?: string[];
        dueAt?: string;
        tags?: string[];
        mentions?: unknown;
      };
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const accessContext = readRoomAccessContext(req);
      const access = await ensureRoomAccessWithReasonError({
        reply,
        roomId,
        userId,
        accessContext,
        accessLevel: 'post',
      });
      if (!access) return reply;

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
      const dueAt = parseDateParam(body.dueAt);
      if (body.dueAt && !dueAt) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid dueAt date-time' },
        });
      }

      const { mentions, mentionsAll, mentionUserIds, mentionGroupIds } =
        normalizeMentions(body.mentions);
      if (mentionsAll) {
        const ok = await ensureAllMentionAllowed({
          req,
          reply,
          roomId: access.room.id,
          userId,
        });
        if (!ok) return;
      }

      const recipientValidation =
        await validateChatAckRequiredRecipientsForRoom({
          room: access.room,
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
          roomId: access.room.id,
          userId,
          body: body.body,
          tags: normalizeStringArray(body.tags, { max: 8 }) || undefined,
          mentions,
          mentionsAll,
          createdBy: userId,
          updatedBy: userId,
          ackRequest: {
            create: {
              roomId: access.room.id,
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

      const projectId = access.room.type === 'project' ? access.room.id : null;

      if (!message.ackRequest) {
        throw new Error('Expected ackRequest to be created for chat message');
      }

      await logChatAckRequestCreated({
        auditContext: auditContextFromRequest(req, { userId }),
        actorUserId: userId,
        projectId,
        roomId: access.room.id,
        messageId: message.id,
        ackRequestId: message.ackRequest.id,
        requiredUserIds: validatedRequiredUserIds,
        requestedUserIds,
        requestedGroupIds,
        requestedRoles,
        dueAt: message.ackRequest.dueAt,
      });

      await tryCreateChatAckRequiredNotificationsWithAudit({
        auditContext: auditContextFromRequest(req, { userId }),
        logger: req.log,
        actorUserId: userId,
        projectId,
        roomId: access.room.id,
        messageId: message.id,
        messageBody: message.body,
        requiredUserIds: validatedRequiredUserIds,
        dueAt: message.ackRequest.dueAt,
      });

      if (mentionsAll || mentionUserIds.length || mentionGroupIds.length) {
        await logAudit({
          action: 'chat_message_posted_with_mentions',
          targetTable: 'chat_messages',
          targetId: message.id,
          metadata: {
            roomId: access.room.id,
            mentionAll: mentionsAll,
            mentionUserCount: mentionUserIds.length,
            mentionGroupCount: mentionGroupIds.length,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req),
        });
      }

      if (access.postWithoutView) {
        return {
          ...message,
          warning: {
            code: 'POST_WITHOUT_VIEW',
            message:
              '投稿後、このルームを閲覧できません。閲覧権限を管理者に確認してください。',
          },
        };
      }
      return message;
    },
  );
}
