import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { searchChatAckCandidates } from '../services/chatAckCandidates.js';
import { buildChatMentionCandidates } from '../services/chatMentionCandidates.js';
import { ensureChatRoomContentAccess } from '../services/chatRoomAccess.js';
import {
  getChatUnreadSummary,
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

export async function registerChatRoomRoutes(app: FastifyInstance) {
  const chatRoles = CHAT_ROLES;
  const chatSettingId = 'default';
  const companyRoomId = COMPANY_ROOM_ID;
  async function resolveSearchRoomIds(options: {
    userId: string;
    roles: string[];
    projectIds: string[];
    groupIds: string[];
    groupAccountIds: string[];
  }) {
    const roomIds = new Set<string>();
    const groupSelectors = Array.from(
      new Set(
        [...options.groupIds, ...options.groupAccountIds]
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );
    const groupAccessSet = new Set(groupSelectors);
    const normalizeRoomGroupIds = (value: unknown) => {
      if (!Array.isArray(value)) return [];
      return value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean);
    };
    const hasViewerAccess = (value: unknown) => {
      const viewerGroupIds = normalizeRoomGroupIds(value);
      return (
        viewerGroupIds.length === 0 ||
        viewerGroupIds.some((groupId) => groupAccessSet.has(groupId))
      );
    };

    const companyRoom = await prisma.chatRoom.findUnique({
      where: { id: companyRoomId },
      select: { id: true, deletedAt: true, viewerGroupIds: true },
    });
    if (companyRoom && !companyRoom.deletedAt) {
      if (hasViewerAccess(companyRoom.viewerGroupIds)) {
        roomIds.add(companyRoom.id);
      }
    }

    if (groupSelectors.length > 0) {
      const departmentRooms = await prisma.chatRoom.findMany({
        where: {
          type: 'department',
          deletedAt: null,
          groupId: { in: groupSelectors },
        },
        select: { id: true, viewerGroupIds: true },
        take: 200,
      });
      departmentRooms.forEach((room) => {
        if (hasViewerAccess(room.viewerGroupIds)) {
          roomIds.add(room.id);
        }
      });
    }

    const canSeeAllProjects =
      options.roles.includes('admin') ||
      options.roles.includes('mgmt') ||
      options.roles.includes('exec');
    if (canSeeAllProjects) {
      const projectRooms = await prisma.chatRoom.findMany({
        where: { type: 'project', deletedAt: null },
        select: { id: true, viewerGroupIds: true },
        take: 500,
      });
      projectRooms.forEach((room) => {
        if (hasViewerAccess(room.viewerGroupIds)) {
          roomIds.add(room.id);
        }
      });
    } else if (options.projectIds.length > 0) {
      const projectRooms = await prisma.chatRoom.findMany({
        where: {
          type: 'project',
          deletedAt: null,
          id: { in: options.projectIds },
        },
        select: { id: true, viewerGroupIds: true },
        take: 200,
      });
      projectRooms.forEach((room) => {
        if (hasViewerAccess(room.viewerGroupIds)) {
          roomIds.add(room.id);
        }
      });
    }

    const memberRooms = await prisma.chatRoomMember.findMany({
      where: {
        userId: options.userId,
        deletedAt: null,
        room: { deletedAt: null },
      },
      select: {
        roomId: true,
        room: {
          select: {
            type: true,
            isOfficial: true,
            allowExternalUsers: true,
            viewerGroupIds: true,
          },
        },
      },
      take: 200,
    });
    memberRooms.forEach((row) => {
      const room = row.room;
      if (!room) return;
      if (room.type === 'project' && !room.allowExternalUsers) return;
      if (
        !(room.type === 'private_group' && room.isOfficial) &&
        !hasViewerAccess(room.viewerGroupIds)
      ) {
        return;
      }
      roomIds.add(row.roomId);
    });

    return Array.from(roomIds);
  }

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
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { q, limit, before } = req.query as {
        q?: string;
        limit?: string;
        before?: string;
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

      const roomIds = await resolveSearchRoomIds({
        userId,
        roles,
        projectIds,
        groupIds,
        groupAccountIds,
      });
      if (roomIds.length === 0) {
        return { items: [] };
      }

      const where: Prisma.ChatMessageWhereInput = {
        roomId: { in: roomIds },
        deletedAt: null,
        body: { contains: trimmedQuery, mode: 'insensitive' },
        room: { deletedAt: null },
      };
      if (beforeDate) {
        where.createdAt = { lt: beforeDate };
      }

      const items = await prisma.chatMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
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

      const responseItems = items.map((item) => {
        const room = item.room;
        const projectCode = room.project?.code || null;
        const projectName = room.project?.name || null;
        return {
          id: item.id,
          roomId: item.roomId,
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
          query: trimmedQuery.slice(0, 100),
          resultCount: responseItems.length,
          limit: take,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return { items: responseItems };
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
        return reply.status(access.reason === 'not_found' ? 404 : 403).send({
          error: {
            code:
              access.reason === 'not_found'
                ? 'NOT_FOUND'
                : access.reason === 'forbidden_project'
                  ? 'FORBIDDEN_PROJECT'
                  : access.reason === 'forbidden_external_room'
                    ? 'FORBIDDEN_EXTERNAL_ROOM'
                    : 'FORBIDDEN_ROOM_MEMBER',
            message: 'Access to this room is forbidden',
          },
        });
      }

      const excerpt = message.body.replace(/\s+/g, ' ').trim().slice(0, 140);

      await logAudit({
        action: 'chat_message_deeplink_resolved',
        targetTable: 'chat_messages',
        targetId: message.id,
        metadata: {
          roomId: message.roomId,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return {
        id: message.id,
        roomId: message.roomId,
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
      return markChatAsRead({ roomId: access.room.id, userId });
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
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const { limit, before, tag, q } = req.query as {
        limit?: string;
        before?: string;
        tag?: string;
        q?: string;
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
      const where: Prisma.ChatMessageWhereInput = {
        roomId: access.room.id,
        deletedAt: null,
      };
      if (beforeDate) {
        where.createdAt = { lt: beforeDate };
      }
      const trimmedTag = typeof tag === 'string' ? tag.trim() : '';
      if (trimmedTag.length > 32) {
        return reply.status(400).send({
          error: { code: 'INVALID_TAG', message: 'Tag is too long' },
        });
      }
      if (trimmedTag) {
        where.tags = { array_contains: [trimmedTag] };
      }
      const trimmedQuery = typeof q === 'string' ? q.trim() : '';
      if (trimmedQuery.length > 100) {
        return reply.status(400).send({
          error: { code: 'INVALID_QUERY', message: 'query is too long' },
        });
      }
      if (trimmedQuery && trimmedQuery.length < 2) {
        return reply.status(400).send({
          error: { code: 'INVALID_QUERY', message: 'query is too short' },
        });
      }
      if (trimmedQuery) {
        where.body = { contains: trimmedQuery, mode: 'insensitive' };
      }
      const items = await prisma.chatMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        include: {
          ackRequest: {
            include: {
              acks: true,
            },
          },
          attachments: {
            select: {
              id: true,
              originalName: true,
              mimeType: true,
              sizeBytes: true,
              createdAt: true,
              createdBy: true,
            },
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      return { items };
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
