import {
  FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { searchChatAckCandidates } from '../services/chatAckCandidates.js';
import { buildChatMentionCandidates } from '../services/chatMentionCandidates.js';
import { ensureChatRoomContentAccess } from '../services/chatRoomAccess.js';
import {
  getChatUnreadSummary,
  InvalidChatReadBoundaryError,
  markChatAsRead,
} from '../services/chatReadState.js';
import {
  COMPANY_ROOM_ID,
  createPrivateGroupRoomWithMembers,
  ensureDmRoomWithMembers,
} from '../services/chatRoomProvisioning.js';
import {
  listChatRoomsForUser,
  updateManagedChatRoom,
} from '../services/chatRoomLifecycle.js';
import { addChatRoomMembers } from '../services/chatRoomMembership.js';
import { ensurePersonalGeneralAffairsChatRoom } from '../services/personalGaChatRoom.js';
import {
  chatRoomCreateSchema,
  chatRoomMemberAddSchema,
  chatRoomNotificationSettingPatchSchema,
  chatRoomPatchSchema,
  projectChatSummarySchema,
} from './validators.js';
import { CHAT_ADMIN_ROLES, CHAT_ROLES } from './chat/shared/constants.js';
import { registerChatRoomMessageRoutes } from './chatRooms/messages.js';
import {
  ensureRoomAccessWithReasonError,
  readRoomAccessContext,
} from './chatRooms/shared.js';
import {
  normalizeStringArray,
  parseLimit,
  parseLimitNumber,
} from './chat/shared/inputParsers.js';
import { requireUserId } from './chat/shared/requireUserId.js';
import { parseDateParam } from '../utils/date.js';
import {
  normalizeBodylessChatReadState,
  parseChatReadStateInput,
} from './chat/shared/readStateInput.js';
import { resolveAccessibleChatSearchRoomIds } from '../services/chatSearchAccess.js';
import { prismaChatThreadRepository } from '../adapters/chat/prismaChatThreadAdapter.js';
import {
  chatKnowledgeShareSummaryResponse,
  chatRootTimelineMessageResponse,
} from './chatThreadResponses.js';
import {
  chatApiErrorResponseSchema,
  chatKnowledgeShareSummaryQuerySchema,
  chatKnowledgeShareSummaryListResponseSchema,
  chatMessageSearchSchema,
  chatRoomReadStateSchema,
  chatRoomTimelineParamsSchema,
  chatRoomTimelineQuerySchema,
  chatRootTimelineListResponseSchema,
  chatTimelineNotFoundResponseSchema,
} from './chatThreadSchemas.js';

const CHAT_MESSAGE_ID_DIRECTIONAL_CODE_POINTS = new Set([
  0x061c, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d,
  0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
]);

function isValidChatMessageId(value: string) {
  const codePoints = [...value];
  if (
    codePoints.length === 0 ||
    codePoints.length > 200 ||
    Buffer.byteLength(value, 'utf8') > 800
  ) {
    return false;
  }
  return codePoints.every((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      codePoint >= 0x20 &&
      !(codePoint >= 0x7f && codePoint <= 0x9f) &&
      !(codePoint >= 0xd800 && codePoint <= 0xdfff) &&
      !CHAT_MESSAGE_ID_DIRECTIONAL_CODE_POINTS.has(codePoint)
    );
  });
}

export async function registerChatRoomRoutes(app: FastifyInstance) {
  const chatRoles = CHAT_ROLES;
  const chatSettingId = 'default';
  const companyRoomId = COMPANY_ROOM_ID;

  async function getChatSettings() {
    const setting = await prisma.chatSetting.findUnique({
      where: { id: chatSettingId },
      select: {
        allowUserPrivateGroupCreation: true,
        allowDmCreation: true,
      },
    });
    return {
      allowUserPrivateGroupCreation:
        setting?.allowUserPrivateGroupCreation ?? true,
      allowDmCreation: setting?.allowDmCreation ?? true,
    };
  }

  app.get(
    '/chat-rooms',
    { preHandler: requireRole(chatRoles) },
    async (req) => {
      return listChatRoomsForUser({
        roles: req.user?.roles || [],
        userId: req.user?.userId,
        projectIds: req.user?.projectIds || [],
        groupIds: req.user?.groupIds,
        groupAccountIds: req.user?.groupAccountIds,
      });
    },
  );

  async function readRootTimeline(req: FastifyRequest, reply: FastifyReply) {
    const { roomId } = req.params as { roomId: string };
    const { limit, before, tag, q } = req.query as {
      limit?: string;
      before?: string;
      tag?: string;
      q?: string;
    };
    const userId = requireUserId(reply, req.user?.userId);
    if (typeof userId !== 'string') return null;
    const accessContext = readRoomAccessContext(req);
    const access = await ensureRoomAccessWithReasonError({
      reply,
      roomId,
      userId,
      accessContext,
      accessLevel: 'read',
    });
    if (!access) return null;

    const take = parseLimit(limit);
    if (!take) {
      reply.status(400).send({
        error: {
          code: 'INVALID_LIMIT',
          message: 'limit must be a positive integer',
        },
      });
      return null;
    }
    const beforeDate = parseDateParam(before);
    if (before && !beforeDate) {
      reply.status(400).send({
        error: { code: 'INVALID_DATE', message: 'Invalid before date' },
      });
      return null;
    }
    const trimmedTag = typeof tag === 'string' ? tag.trim() : '';
    if (trimmedTag.length > 32) {
      reply.status(400).send({
        error: { code: 'INVALID_TAG', message: 'Tag is too long' },
      });
      return null;
    }
    const trimmedQuery = typeof q === 'string' ? q.trim() : '';
    if (trimmedQuery.length > 100) {
      reply.status(400).send({
        error: { code: 'INVALID_QUERY', message: 'query is too long' },
      });
      return null;
    }
    if (trimmedQuery && trimmedQuery.length < 2) {
      reply.status(400).send({
        error: { code: 'INVALID_QUERY', message: 'query is too short' },
      });
      return null;
    }
    const items = await prismaChatThreadRepository.listRootTimeline({
      roomId: access.room.id,
      actor: {
        userId,
        roles: accessContext.roles,
        projectIds: accessContext.projectIds,
        groupIds: accessContext.groupIds,
        groupAccountIds: accessContext.groupAccountIds,
      },
      limit: take,
      before: beforeDate ?? undefined,
      tag: trimmedTag || undefined,
      query: trimmedQuery || undefined,
    });
    if (!items) {
      reply.status(404).send({ error: 'not_found' });
      return null;
    }
    return items;
  }

  app.get(
    '/chat-rooms/personal-general-affairs',
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const actorUserId = requireUserId(reply, req.user?.userId);
      if (typeof actorUserId !== 'string') return actorUserId;

      const normalizedActorUserId = actorUserId.trim();
      const account = await prisma.userAccount.findFirst({
        where: {
          active: true,
          OR: [
            { externalId: normalizedActorUserId },
            { userName: normalizedActorUserId },
          ],
        },
        select: {
          id: true,
          externalId: true,
          userName: true,
          displayName: true,
        },
      });
      if (!account) {
        return reply.status(404).send({
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User account not found',
          },
        });
      }

      const memberUserId = (account.externalId ?? account.userName)?.trim();
      if (!memberUserId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_USER',
            message: 'User identifier is required',
          },
        });
      }

      const ensured = await ensurePersonalGeneralAffairsChatRoom({
        userAccountId: account.id,
        userId: memberUserId,
        userName: account.userName,
        displayName: account.displayName,
        createdBy: normalizedActorUserId,
      });
      const room = await prisma.chatRoom.findUnique({
        where: { id: ensured.roomId },
        select: {
          id: true,
          name: true,
          type: true,
          isOfficial: true,
          viewerGroupIds: true,
          posterGroupIds: true,
        },
      });

      return {
        roomId: ensured.roomId,
        name: room?.name ?? null,
        type: room?.type ?? 'private_group',
        isOfficial: room?.isOfficial ?? true,
        viewerGroupIds: normalizeStringArray(room?.viewerGroupIds, {
          dedupe: true,
        }),
        posterGroupIds: normalizeStringArray(room?.posterGroupIds, {
          dedupe: true,
        }),
      };
    },
  );

  app.get(
    '/chat-messages/search',
    { schema: chatMessageSearchSchema, preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { q, limit, before, beforeId } = req.query as {
        q?: string;
        limit?: string;
        before?: string;
        beforeId?: string;
      };
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;

      const take = parseLimit(limit);
      if (!take) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_LIMIT',
            message: 'limit must be a positive integer',
          },
        });
      }

      const beforeDate = parseDateParam(before);
      if (before && !beforeDate) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid before date' },
        });
      }
      if ((beforeId && !beforeDate) || (beforeId && beforeId.length > 200)) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_CURSOR',
            message: 'Invalid search boundary',
          },
        });
      }

      const trimmedQuery = typeof q === 'string' ? q.trim() : '';
      if (trimmedQuery.length > 100) {
        return reply.status(400).send({
          error: { code: 'INVALID_QUERY', message: 'query is too long' },
        });
      }
      if (trimmedQuery.length < 2) {
        return reply.status(400).send({
          error: { code: 'INVALID_QUERY', message: 'query is too short' },
        });
      }

      const roles = req.user?.roles || [];
      const projectIds = normalizeStringArray(req.user?.projectIds, {
        dedupe: true,
      });
      const groupIds = normalizeStringArray(req.user?.groupIds, {
        dedupe: true,
      });
      const groupAccountIds = normalizeStringArray(req.user?.groupAccountIds, {
        dedupe: true,
      });

      const items = await prisma.$transaction(
        async (tx) => {
          const roomIds = await resolveAccessibleChatSearchRoomIds({
            userId,
            roles,
            projectIds,
            groupIds,
            groupAccountIds,
            client: tx,
          });
          if (roomIds.length === 0) return [];

          const where: Prisma.ChatMessageWhereInput = {
            roomId: { in: roomIds },
            deletedAt: null,
            body: { contains: trimmedQuery, mode: 'insensitive' },
            room: { deletedAt: null },
          };
          if (beforeDate) {
            where.OR = beforeId
              ? [
                  { createdAt: { lt: beforeDate } },
                  { createdAt: beforeDate, id: { lt: beforeId } },
                ]
              : [{ createdAt: { lt: beforeDate } }];
          }

          return tx.chatMessage.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take,
            include: {
              room: {
                select: {
                  id: true,
                  type: true,
                  name: true,
                  isOfficial: true,
                  projectId: true,
                  groupId: true,
                  allowExternalUsers: true,
                  allowExternalIntegrations: true,
                  project: { select: { code: true, name: true } },
                },
              },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );

      const responseItems = items.map((item) => {
        const room = item.room;
        const projectCode = room.project?.code || null;
        const projectName = room.project?.name || null;
        return {
          id: item.id,
          roomId: item.roomId,
          messageType: item.messageType,
          parentMessageId: item.parentMessageId,
          threadRootId: item.threadRootId,
          userId: item.userId,
          body: item.body,
          tags: item.tags,
          createdAt: item.createdAt,
          room: {
            id: room.id,
            type: room.type,
            name: room.name,
            isOfficial: room.isOfficial,
            projectId: room.projectId,
            projectCode,
            projectName,
            groupId: room.groupId,
            allowExternalUsers: room.allowExternalUsers,
            allowExternalIntegrations: room.allowExternalIntegrations,
          },
        };
      });

      await logAudit({
        action: 'chat_messages_search',
        targetTable: 'chat_messages',
        metadata: {
          hasQuery: true,
          queryLength: Array.from(trimmedQuery).length,
          resultCount: responseItems.length,
          limit: take,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      const last = items[items.length - 1];
      return {
        items: responseItems,
        nextBefore: last?.createdAt.toISOString() ?? null,
        nextBeforeId: last?.id ?? null,
      };
    },
  );

  app.get(
    '/chat-messages/:id',
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;

      const message = await prisma.chatMessage.findUnique({
        where: { id },
        include: {
          room: {
            select: {
              id: true,
              type: true,
              projectId: true,
              deletedAt: true,
            },
          },
        },
      });
      if (!message || message.deletedAt || message.room.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Chat message not found' },
        });
      }

      const roles = req.user?.roles || [];
      const projectIds = normalizeStringArray(req.user?.projectIds, {
        dedupe: true,
        max: 500,
      });
      const groupIds = normalizeStringArray(req.user?.groupIds, {
        dedupe: true,
        max: 50,
      });
      const groupAccountIds = normalizeStringArray(req.user?.groupAccountIds, {
        dedupe: true,
        max: 50,
      });

      const access = await ensureChatRoomContentAccess({
        roomId: message.roomId,
        userId,
        roles,
        projectIds,
        groupIds,
        groupAccountIds,
      });
      if (!access.ok) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Chat message not found' },
        });
      }

      const excerpt = message.body.replace(/\s+/g, ' ').trim().slice(0, 140);

      await logAudit({
        action: 'chat_message_deeplink_resolved',
        targetTable: 'chat_messages',
        metadata: {
          messageType: message.messageType,
          isReply: message.parentMessageId !== null,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return {
        id: message.id,
        roomId: message.roomId,
        messageType: message.messageType,
        parentMessageId: message.parentMessageId,
        threadRootId: message.threadRootId,
        createdAt: message.createdAt,
        excerpt,
        room: {
          id: message.room.id,
          type: message.room.type,
          projectId: message.room.projectId,
        },
      };
    },
  );

  app.patch(
    '/chat-rooms/:roomId',
    {
      preHandler: requireRole(CHAT_ADMIN_ROLES),
      schema: chatRoomPatchSchema,
    },
    async (req, reply) => {
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;

      const { roomId } = req.params as { roomId: string };
      const body = req.body as {
        name?: string;
        allowExternalUsers?: boolean;
        allowExternalIntegrations?: boolean;
        viewerGroupIds?: unknown;
        posterGroupIds?: unknown;
      };

      const result = await updateManagedChatRoom({
        roomId,
        userId,
        patch: body,
      });
      if (!result.ok) {
        return reply.status(result.statusCode).send({ error: result.error });
      }

      if (Object.keys(result.changes).length === 0) {
        return result.room;
      }

      await logAudit({
        action: 'chat_room_updated',
        targetTable: 'chat_rooms',
        targetId: result.room.id,
        metadata: {
          roomId: result.room.id,
          roomType: result.room.type,
          changes: result.changes,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return result.room;
    },
  );

  app.post(
    '/chat-rooms',
    { preHandler: requireRole(chatRoles), schema: chatRoomCreateSchema },
    async (req, reply) => {
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const roles = req.user?.roles || [];
      const canCreateRooms =
        roles.includes('admin') ||
        roles.includes('mgmt') ||
        roles.includes('exec') ||
        roles.includes('user') ||
        roles.includes('hr');
      if (!canCreateRooms) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'chat room creation is not allowed for this role',
          },
        });
      }

      const settings = await getChatSettings();
      const body = req.body as {
        type: 'private_group' | 'dm';
        name?: string;
        memberUserIds?: string[];
        partnerUserId?: string;
      };

      if (body.type === 'private_group') {
        if (
          (roles.includes('user') || roles.includes('hr')) &&
          !settings.allowUserPrivateGroupCreation
        ) {
          return reply.status(403).send({
            error: {
              code: 'PRIVATE_GROUP_CREATION_DISABLED',
              message: 'private_group creation is disabled by setting',
            },
          });
        }
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) {
          return reply.status(400).send({
            error: { code: 'INVALID_NAME', message: 'name is required' },
          });
        }
        const memberUserIds = normalizeStringArray(body.memberUserIds, {
          dedupe: true,
          max: 200,
        }).filter((entry) => entry !== userId);

        const created = await createPrivateGroupRoomWithMembers({
          userId,
          name,
          memberUserIds,
        });

        await logAudit({
          action: 'chat_room_created',
          targetTable: 'chat_rooms',
          targetId: created.room.id,
          metadata: {
            type: created.room.type,
            isOfficial: created.room.isOfficial,
            memberCount: created.memberCount,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req),
        });

        return created.room;
      }

      if (!settings.allowDmCreation) {
        return reply.status(403).send({
          error: {
            code: 'DM_CREATION_DISABLED',
            message: 'dm creation is disabled by setting',
          },
        });
      }
      const partnerUserId =
        typeof body.partnerUserId === 'string' ? body.partnerUserId.trim() : '';
      if (!partnerUserId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PARTNER',
            message: 'partnerUserId is required',
          },
        });
      }
      if (partnerUserId === userId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PARTNER',
            message: 'cannot create DM to self',
          },
        });
      }

      const ensured = await ensureDmRoomWithMembers({
        userId,
        partnerUserId,
      });

      if (ensured.created) {
        await logAudit({
          action: 'chat_room_created',
          targetTable: 'chat_rooms',
          targetId: ensured.room.id,
          metadata: {
            type: ensured.room.type,
            isOfficial: ensured.room.isOfficial,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req),
        });
      }

      return ensured.room;
    },
  );

  app.post(
    '/chat-rooms/:roomId/members',
    { preHandler: requireRole(chatRoles), schema: chatRoomMemberAddSchema },
    async (req, reply) => {
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const roles = req.user?.roles || [];
      const { roomId } = req.params as { roomId: string };
      const body = req.body as { userIds: string[] };
      const result = await addChatRoomMembers({
        roomId,
        actorUserId: userId,
        actorRoles: roles,
        userIds: body.userIds,
      });
      if (!result.ok) {
        return reply.status(result.statusCode).send({ error: result.error });
      }
      if (result.added === 0) {
        return { ok: true, added: 0 };
      }

      await logAudit({
        action: 'chat_room_members_added',
        targetTable: 'chat_room_members',
        metadata: {
          roomId: result.roomId,
          addedCount: result.added,
          addedUserIds: result.addedUserIds.slice(0, 20),
          truncated: result.addedUserIds.length > 20,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return { ok: true, added: result.added };
    },
  );

  app.get(
    '/chat-rooms/:roomId/mention-candidates',
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const accessContext = readRoomAccessContext(req);
      const access = await ensureRoomAccessWithReasonError({
        reply,
        roomId,
        userId,
        accessContext,
        accessLevel: 'read',
      });
      if (!access) return reply;
      return buildChatMentionCandidates({
        room: {
          id: access.room.id,
          type: access.room.type,
          allowExternalUsers: access.room.allowExternalUsers,
        },
        requesterUserId: userId,
        groupIds: accessContext.groupIds,
        groupAccountIds: accessContext.groupAccountIds,
      });
    },
  );

  app.get(
    '/chat-rooms/:roomId/ack-candidates',
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const { q } = req.query as { q?: string };
      const keyword = (q || '').trim();
      if (keyword.length < 2) {
        return { users: [], groups: [] };
      }
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const accessContext = readRoomAccessContext(req);
      const access = await ensureRoomAccessWithReasonError({
        reply,
        roomId,
        userId,
        accessContext,
        accessLevel: 'read',
      });
      if (!access) return reply;
      return searchChatAckCandidates({ room: access.room, q: keyword });
    },
  );

  app.get(
    '/chat-rooms/:roomId/unread',
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const accessContext = readRoomAccessContext(req);
      const access = await ensureRoomAccessWithReasonError({
        reply,
        roomId,
        userId,
        accessContext,
        accessLevel: 'read',
      });
      if (!access) return reply;
      return getChatUnreadSummary({ roomId: access.room.id, userId });
    },
  );

  app.post(
    '/chat-rooms/:roomId/read',
    {
      schema: chatRoomReadStateSchema,
      preValidation: normalizeBodylessChatReadState,
      preHandler: requireRole(chatRoles),
    },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const readInput = parseChatReadStateInput(req.body);
      if (!readInput.ok) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid read state input' },
        });
      }
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const accessContext = readRoomAccessContext(req);
      const access = await ensureRoomAccessWithReasonError({
        reply,
        roomId,
        userId,
        accessContext,
        accessLevel: 'read',
      });
      if (!access) return reply;
      try {
        return await markChatAsRead({
          roomId: access.room.id,
          userId,
          through: readInput.through,
          throughMessageId: readInput.throughMessageId,
        });
      } catch (error) {
        if (error instanceof InvalidChatReadBoundaryError) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_READ_BOUNDARY',
              message: 'Invalid read state input',
            },
          });
        }
        throw error;
      }
    },
  );

  app.get(
    '/chat-rooms/:roomId/notification-setting',
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const accessContext = readRoomAccessContext(req);
      const access = await ensureRoomAccessWithReasonError({
        reply,
        roomId,
        userId,
        accessContext,
        accessLevel: 'read',
      });
      if (!access) return reply;

      const current = await prisma.chatRoomNotificationSetting.findUnique({
        where: { roomId_userId: { roomId: access.room.id, userId } },
        select: {
          roomId: true,
          userId: true,
          notifyAllPosts: true,
          notifyMentions: true,
          muteUntil: true,
        },
      });
      if (!current) {
        return {
          roomId: access.room.id,
          userId,
          notifyAllPosts: true,
          notifyMentions: true,
          muteUntil: null,
        };
      }
      return {
        ...current,
        muteUntil: current.muteUntil ? current.muteUntil.toISOString() : null,
      };
    },
  );

  app.patch(
    '/chat-rooms/:roomId/notification-setting',
    {
      preHandler: requireRole(chatRoles),
      schema: chatRoomNotificationSettingPatchSchema,
    },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const accessContext = readRoomAccessContext(req);
      const access = await ensureRoomAccessWithReasonError({
        reply,
        roomId,
        userId,
        accessContext,
        accessLevel: 'read',
      });
      if (!access) return reply;

      const body = req.body as {
        notifyAllPosts?: boolean;
        notifyMentions?: boolean;
        muteUntil?: string | null;
      };

      if (
        body.notifyAllPosts === undefined &&
        body.notifyMentions === undefined &&
        body.muteUntil === undefined
      ) {
        const current = await prisma.chatRoomNotificationSetting.findUnique({
          where: { roomId_userId: { roomId: access.room.id, userId } },
          select: {
            roomId: true,
            userId: true,
            notifyAllPosts: true,
            notifyMentions: true,
            muteUntil: true,
          },
        });
        return current
          ? {
              ...current,
              muteUntil: current.muteUntil
                ? current.muteUntil.toISOString()
                : null,
            }
          : {
              roomId: access.room.id,
              userId,
              notifyAllPosts: true,
              notifyMentions: true,
              muteUntil: null,
            };
      }

      const update: Prisma.ChatRoomNotificationSettingUpdateInput = {
        updatedBy: userId,
      };
      const create: Prisma.ChatRoomNotificationSettingCreateInput = {
        room: { connect: { id: access.room.id } },
        userId,
        notifyAllPosts: true,
        notifyMentions: true,
        createdBy: userId,
        updatedBy: userId,
      };

      if (body.notifyAllPosts !== undefined) {
        update.notifyAllPosts = body.notifyAllPosts;
        create.notifyAllPosts = body.notifyAllPosts;
      }
      if (body.notifyMentions !== undefined) {
        update.notifyMentions = body.notifyMentions;
        create.notifyMentions = body.notifyMentions;
      }
      if (body.muteUntil !== undefined) {
        if (body.muteUntil === null) {
          update.muteUntil = null;
          create.muteUntil = null;
        } else {
          const parsed = parseDateParam(body.muteUntil);
          if (!parsed) {
            return reply.status(400).send({
              error: { code: 'INVALID_DATE', message: 'Invalid muteUntil' },
            });
          }
          update.muteUntil = parsed;
          create.muteUntil = parsed;
        }
      }

      const updated = await prisma.chatRoomNotificationSetting.upsert({
        where: { roomId_userId: { roomId: access.room.id, userId } },
        update,
        create,
        select: {
          roomId: true,
          userId: true,
          notifyAllPosts: true,
          notifyMentions: true,
          muteUntil: true,
        },
      });
      return {
        ...updated,
        muteUntil: updated.muteUntil ? updated.muteUntil.toISOString() : null,
      };
    },
  );

  app.get(
    '/chat-rooms/:roomId/messages',
    {
      preHandler: requireRole(chatRoles),
      schema: {
        params: chatRoomTimelineParamsSchema,
        querystring: chatRoomTimelineQuerySchema,
        response: {
          200: chatRootTimelineListResponseSchema,
          400: chatApiErrorResponseSchema,
          403: chatApiErrorResponseSchema,
          404: chatTimelineNotFoundResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const items = await readRootTimeline(req, reply);
      if (!items) return;
      return { items: items.map(chatRootTimelineMessageResponse) };
    },
  );

  app.get(
    '/chat-rooms/:roomId/knowledge-share-messages',
    {
      preHandler: requireRole(chatRoles),
      schema: {
        tags: ['chat', 'knowledge'],
        params: chatRoomTimelineParamsSchema,
        querystring: chatKnowledgeShareSummaryQuerySchema,
        response: {
          200: chatKnowledgeShareSummaryListResponseSchema,
          400: chatApiErrorResponseSchema,
          403: chatApiErrorResponseSchema,
          404: chatTimelineNotFoundResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const rawMessageIds = (req.query as { messageIds: string }).messageIds;
      const messageIds = [
        ...new Set(rawMessageIds.split(',').map((value) => value.trim())),
      ];
      if (
        messageIds.length === 0 ||
        messageIds.length > 100 ||
        messageIds.some((messageId) => !isValidChatMessageId(messageId))
      ) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_MESSAGE_IDS',
            message: 'messageIds must contain 1 to 100 valid identifiers',
          },
        });
      }
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return;
      const accessContext = readRoomAccessContext(req);
      const access = await ensureRoomAccessWithReasonError({
        reply,
        roomId,
        userId,
        accessContext,
        accessLevel: 'read',
      });
      if (!access) return;
      const summaries =
        await prismaChatThreadRepository.listKnowledgeShareSummaries({
          roomId: access.room.id,
          actor: {
            userId,
            roles: accessContext.roles,
            projectIds: accessContext.projectIds,
            groupIds: accessContext.groupIds,
            groupAccountIds: accessContext.groupAccountIds,
          },
          messageIds,
        });
      if (!summaries) {
        return reply.status(404).send({ error: 'not_found' });
      }
      return {
        items: summaries.map(chatKnowledgeShareSummaryResponse),
      };
    },
  );

  app.post(
    '/chat-rooms/:roomId/summary',
    { preHandler: requireRole(chatRoles), schema: projectChatSummarySchema },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const body = req.body as {
        since?: string;
        until?: string;
        limit?: number;
      };

      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;

      const accessContext = readRoomAccessContext(req);
      const access = await ensureRoomAccessWithReasonError({
        reply,
        roomId,
        userId,
        accessContext,
        accessLevel: 'read',
      });
      if (!access) return reply;

      const since = parseDateParam(body.since);
      if (body.since && !since) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid since date-time' },
        });
      }
      const until = parseDateParam(body.until);
      if (body.until && !until) {
        return reply.status(400).send({
          error: { code: 'INVALID_DATE', message: 'Invalid until date-time' },
        });
      }
      const take = parseLimitNumber(body.limit);
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

      const items = await prisma.chatMessage.findMany({
        where: {
          roomId: access.room.id,
          deletedAt: null,
          createdAt,
        },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true,
          userId: true,
          body: true,
          createdAt: true,
          tags: true,
          mentionsAll: true,
          ackRequest: { select: { id: true } },
        },
      });

      const users = new Set(items.map((item) => item.userId));
      const mentionAllCount = items.filter((item) => item.mentionsAll).length;
      const ackRequestCount = items.filter(
        (item) => item.ackRequest?.id,
      ).length;
      const tagCounts = new Map<string, number>();
      for (const item of items) {
        const tags = Array.isArray(item.tags) ? item.tags : [];
        for (const rawTag of tags) {
          if (typeof rawTag !== 'string') continue;
          const tag = rawTag.trim();
          if (!tag) continue;
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
      const topTags = Array.from(tagCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tag, count]) => `#${tag}(${count})`);

      const latestAt = items[0]?.createdAt || null;
      const earliestAt = items.length
        ? items[items.length - 1].createdAt
        : null;

      const sampleLines = items.slice(0, 5).map((item) => {
        const normalizedBody = item.body.replace(/\s+/g, ' ').trim();
        const excerpt = normalizedBody.slice(0, 80);
        const suffix = normalizedBody.length > 80 ? '…' : '';
        return `- ${item.userId}: ${excerpt}${suffix}`;
      });

      const fromLabel = earliestAt ? earliestAt.toISOString() : null;
      const toLabel = latestAt ? latestAt.toISOString() : null;
      const summaryLines = [
        '（スタブ要約: 集計ベース）',
        `- roomId: ${access.room.id}`,
        `- roomType: ${access.room.type}`,
        access.room.type === 'department' && access.room.groupId
          ? `- groupId: ${access.room.groupId}`
          : null,
        access.room.type === 'project'
          ? `- projectId: ${access.room.id}`
          : null,
        `- 取得件数: ${items.length}件`,
        `- 投稿者数: ${users.size}名`,
        `- @all: ${mentionAllCount}件`,
        `- 確認依頼: ${ackRequestCount}件`,
        fromLabel || toLabel
          ? `- 期間: ${fromLabel || '-'} 〜 ${toLabel || '-'}`
          : null,
        topTags.length ? `- 上位タグ: ${topTags.join(', ')}` : null,
        sampleLines.length ? '- 直近の投稿（最大5件）:' : null,
        ...sampleLines,
      ].filter(Boolean) as string[];

      await logAudit({
        action: 'chat_summary_generated',
        targetTable: 'chat_messages',
        metadata: {
          roomId: access.room.id,
          roomType: access.room.type,
          groupId:
            access.room.type === 'department' ? access.room.groupId : undefined,
          projectId:
            access.room.type === 'project' ? access.room.id : undefined,
          limit: take,
          since: body.since || null,
          until: body.until || null,
          messageCount: items.length,
          userCount: users.size,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return {
        summary: items.length
          ? summaryLines.join('\n')
          : '対象メッセージがありません',
        stats: {
          roomId: access.room.id,
          roomType: access.room.type,
          groupId:
            access.room.type === 'department' ? access.room.groupId : null,
          messageCount: items.length,
          userCount: users.size,
          mentionAllCount,
          ackRequestCount,
          since: fromLabel,
          until: toLabel,
        },
      };
    },
  );

  await registerChatRoomMessageRoutes(app);
}
