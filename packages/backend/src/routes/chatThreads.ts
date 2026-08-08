import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';

import { prismaChatThreadRepository } from '../adapters/chat/prismaChatThreadAdapter.js';
import { createChatThreadCursorCodec } from '../application/chat/chatThreadCursor.js';
import { createChatThreadService } from '../application/chat/chatThreadUseCases.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { requireRole } from '../services/rbac.js';
import { CHAT_ROLES } from './chat/shared/constants.js';
import { parseLimit } from './chat/shared/inputParsers.js';
import { requireUserId } from './chat/shared/requireUserId.js';
import { chatThreadGetSchema } from './chatThreadSchemas.js';
import { chatThreadMessageResponse } from './chatThreadResponses.js';

export async function registerChatThreadRoutes(app: FastifyInstance) {
  const service = createChatThreadService({
    repository: prismaChatThreadRepository,
    cursorCodec: createChatThreadCursorCodec(),
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
}
