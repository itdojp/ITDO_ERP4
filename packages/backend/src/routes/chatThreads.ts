import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';

import { prismaChatThreadRepository } from '../adapters/chat/prismaChatThreadAdapter.js';
import { defaultChatNotificationPort } from '../adapters/notifications/chatNotificationAdapter.js';
import { createChatThreadCursorCodec } from '../application/chat/chatThreadCursor.js';
import {
  createChatThreadMutationService,
  createChatThreadService,
} from '../application/chat/chatThreadUseCases.js';
import {
  tryCreateChatMentionNotificationEffects,
  tryCreateChatMessageNotificationEffects,
} from '../application/chat/chatNotificationEffects.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { requireRole } from '../services/rbac.js';
import { chatMessageLifecycleService } from '../services/chatMessageLifecycle.js';
import { CHAT_ROLES } from './chat/shared/constants.js';
import {
  normalizeStringArray,
  parseLimit,
} from './chat/shared/inputParsers.js';
import {
  buildAllMentionRateLimitMetadata,
  enforceAllMentionRateLimit,
} from './chat/shared/allMentionRateLimit.js';
import { normalizeMentions } from './chat/shared/mentions.js';
import { requireUserId } from './chat/shared/requireUserId.js';
import {
  chatMessageDeleteSchema,
  chatThreadGetSchema,
  chatThreadReplyCreateSchema,
} from './chatThreadSchemas.js';
import { chatThreadMessageResponse } from './chatThreadResponses.js';

export async function registerChatThreadRoutes(app: FastifyInstance) {
  const service = createChatThreadService({
    repository: prismaChatThreadRepository,
    cursorCodec: createChatThreadCursorCodec(),
  });
  const mutationService = createChatThreadMutationService({
    repository: prismaChatThreadRepository,
  });

  app.get(
    '/chat-messages/:id/thread',
    {
      preHandler: requireRole(CHAT_ROLES),
      schema: chatThreadGetSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const query = req.query as { limit?: string | number; cursor?: string };
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const parsedLimit = parseLimit(
        query.limit === undefined ? undefined : String(query.limit),
      );
      if (!parsedLimit) {
        return reply.status(400).send({
          error: { code: 'INVALID_LIMIT', message: 'Invalid thread limit' },
        });
      }

      const result = await service.getThread({
        actor: {
          userId,
          roles: req.user?.roles ?? [],
          projectIds: req.user?.projectIds ?? [],
          groupIds: req.user?.groupIds ?? [],
          groupAccountIds: req.user?.groupAccountIds ?? [],
        },
        messageId: id,
        limit: parsedLimit,
        cursor: query.cursor,
      });
      if (!result.ok) {
        if (result.reason === 'invalid_cursor') {
          return reply.status(400).send({
            error: { code: 'INVALID_CURSOR', message: 'Invalid cursor' },
          });
        }
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Chat thread not found' },
        });
      }

      await logAudit({
        action: 'chat_thread_viewed',
        targetTable: 'chat_messages',
        targetId: result.value.root.id,
        metadata: {
          replyCount: result.value.replyCount,
          returnedReplyCount: result.value.replies.length,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      const root = chatThreadMessageResponse(result.value.root);
      return {
        root: {
          ...root,
          replyCount: result.value.replyCount,
          lastReplyAt: result.value.lastReplyAt?.toISOString() ?? null,
        },
        replies: result.value.replies.map(chatThreadMessageResponse),
        replyCount: result.value.replyCount,
        lastReplyAt: result.value.lastReplyAt?.toISOString() ?? null,
        nextCursor: result.value.nextCursor,
      };
    },
  );

  app.post(
    '/chat-messages/:id/replies',
    {
      preHandler: requireRole(CHAT_ROLES),
      schema: chatThreadReplyCreateSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        body: string;
        tags?: string[];
        mentions?: unknown;
      };
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const actor = {
        userId,
        roles: req.user?.roles ?? [],
        projectIds: req.user?.projectIds ?? [],
        groupIds: req.user?.groupIds ?? [],
        groupAccountIds: req.user?.groupAccountIds ?? [],
      };
      const prepared = await mutationService.prepareReply({
        actor,
        rootMessageId: id,
      });
      if (!prepared.ok) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Chat thread not found' },
        });
      }

      const { mentions, mentionsAll, mentionUserIds, mentionGroupIds } =
        normalizeMentions(body.mentions);
      if (mentionsAll) {
        const rateLimit = await enforceAllMentionRateLimit({
          roomId: prepared.value.room.id,
          userId,
          now: new Date(),
        });
        if (!rateLimit.allowed) {
          await logAudit({
            action: 'chat_all_mention_blocked',
            targetTable: 'chat_messages',
            metadata: buildAllMentionRateLimitMetadata(
              rateLimit,
            ) as Prisma.InputJsonValue,
            ...auditContextFromRequest(req),
          });
          return reply.status(429).send({
            error: {
              code: 'ALL_MENTION_RATE_LIMIT',
              message: 'Too many @all posts',
            },
          });
        }
      }

      const created = await mutationService.createReply({
        actor,
        rootMessageId: id,
        expectedRoomId: prepared.value.room.id,
        draft: {
          body: body.body,
          tags: normalizeStringArray(body.tags, { max: 8 }) || undefined,
          mentions,
          mentionsAll,
        },
      });
      if (!created.ok) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Chat thread not found' },
        });
      }

      const message = created.value.message;
      await logAudit({
        action: 'chat_reply_created',
        targetTable: 'chat_messages',
        targetId: message.id,
        metadata: {
          mentionAll: mentionsAll,
          mentionUserCount: mentionUserIds.length,
          mentionGroupCount: mentionGroupIds.length,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      let mentionRecipients: string[] = [];
      if (mentionsAll || mentionUserIds.length || mentionGroupIds.length) {
        mentionRecipients = await tryCreateChatMentionNotificationEffects({
          auditContext: auditContextFromRequest(req),
          logger: req.log,
          failureMessage: 'Failed to create chat reply mention notifications',
          notificationPort: defaultChatNotificationPort,
          room: created.value.target.room,
          messageId: message.id,
          messageBody: message.body ?? '',
          senderUserId: userId,
          mentionsAll,
          mentionUserIds,
          mentionGroupIds,
        });
      }
      await tryCreateChatMessageNotificationEffects({
        auditContext: auditContextFromRequest(req),
        logger: req.log,
        failureMessage: 'Failed to create chat reply notifications',
        notificationPort: defaultChatNotificationPort,
        room: created.value.target.room,
        messageId: message.id,
        messageBody: message.body ?? '',
        senderUserId: userId,
        excludeUserIds: mentionRecipients,
      });

      const response = chatThreadMessageResponse(message);
      return reply.status(201).send({
        ...response,
        ...(created.value.target.postWithoutView
          ? {
              warning: {
                code: 'POST_WITHOUT_VIEW' as const,
                message:
                  '投稿後、このルームを閲覧できません。閲覧権限を管理者に確認してください。',
              },
            }
          : {}),
      });
    },
  );

  app.delete(
    '/chat-messages/:id',
    {
      preHandler: requireRole(CHAT_ROLES),
      schema: chatMessageDeleteSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { reason } = req.body as {
        reason: 'user_retract' | 'admin_moderation';
      };
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const deleted = await chatMessageLifecycleService.deleteMessage({
        messageId: id,
        actor: {
          userId,
          roles: req.user?.roles ?? [],
          projectIds: req.user?.projectIds ?? [],
          groupIds: req.user?.groupIds ?? [],
          groupAccountIds: req.user?.groupAccountIds ?? [],
        },
        reason,
      });
      if (!deleted) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Chat message not found' },
        });
      }
      await logAudit({
        action: 'chat_message_deleted',
        targetTable: 'chat_messages',
        targetId: deleted.id,
        metadata: {
          reason: deleted.deletedReason,
          kind: deleted.parentMessageId ? 'reply' : 'root',
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });
      return {
        ...deleted,
        deletedAt: deleted.deletedAt.toISOString(),
      };
    },
  );
}
