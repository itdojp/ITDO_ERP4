import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { ensureChatRoomContentAccess } from '../services/chatRoomAccess.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import {
  createChatMentionNotifications,
  createChatMessageNotifications,
} from '../services/appNotifications.js';
import {
  logChatAckRequestCreated,
  tryCreateChatAckRequiredNotificationsWithAudit,
} from '../services/chatAckNotifications.js';
import { searchChatAckCandidates } from '../services/chatAckCandidates.js';
import {
  resolveChatAckRequiredRecipientUserIds,
  validateChatAckRequiredRecipientsForRoom,
  previewChatAckRecipients,
} from '../services/chatAckRecipients.js';
import { getChatAckLimits } from '../services/chatAckLimits.js';
import { buildChatMentionCandidates } from '../services/chatMentionCandidates.js';
import {
  expandRoomMentionRecipients,
  resolveRoomAudienceUserIds,
} from '../services/chatMentionRecipients.js';
import {
  getChatUnreadSummary,
  markChatAsRead,
} from '../services/chatReadState.js';
import {
  getChatExternalLlmConfig,
  getChatExternalLlmRateLimit,
  summarizeWithExternalLlm,
} from '../services/chatExternalLlm.js';
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
  chatAckPreviewSchema,
  projectChatAckRequestSchema,
  projectChatMessageSchema,
  projectChatSummarySchema,
} from './validators.js';
import { CHAT_ADMIN_ROLES, CHAT_ROLES } from './chat/shared/constants.js';
import {
  normalizeStringArray,
  parseLimit,
  parseLimitNumber,
  parseNonNegativeInt,
} from './chat/shared/inputParsers.js';
import { normalizeMentions } from './chat/shared/mentions.js';
import { requireUserId } from './chat/shared/requireUserId.js';
import { parseDateParam } from '../utils/date.js';
import { getRouteRateLimitOptions } from '../services/rateLimitOverrides.js';

export async function registerChatRoomRoutes(app: FastifyInstance) {
  const chatRoles = CHAT_ROLES;
  const chatSettingId = 'default';
  const companyRoomId = COMPANY_ROOM_ID;
  const aiSummaryRateLimit = getRouteRateLimitOptions('RATE_LIMIT_AI_SUMMARY', {
    max: 20,
    timeWindow: '1 hour',
  });

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

  async function enforceAllMentionRateLimit(options: {
    roomId: string;
    userId: string;
    now: Date;
  }) {
    const minIntervalSeconds = parseNonNegativeInt(
      process.env.CHAT_ALL_MENTION_MIN_INTERVAL_SECONDS,
      60 * 60,
    );
    const maxPer24h = parseNonNegativeInt(
      process.env.CHAT_ALL_MENTION_MAX_PER_24H,
      3,
    );

    const since24h = new Date(options.now.getTime() - 24 * 60 * 60 * 1000);

    const [lastAll, count24h] = await Promise.all([
      minIntervalSeconds > 0
        ? prisma.chatMessage.findFirst({
            where: {
              roomId: options.roomId,
              userId: options.userId,
              mentionsAll: true,
              deletedAt: null,
            },
            select: { createdAt: true },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve(null),
      maxPer24h > 0
        ? prisma.chatMessage.count({
            where: {
              roomId: options.roomId,
              userId: options.userId,
              mentionsAll: true,
              deletedAt: null,
              createdAt: { gte: since24h },
            },
          })
        : Promise.resolve(0),
    ]);

    if (
      minIntervalSeconds > 0 &&
      lastAll &&
      options.now.getTime() - lastAll.createdAt.getTime() <
        minIntervalSeconds * 1000
    ) {
      return {
        allowed: false as const,
        reason: 'min_interval' as const,
        minIntervalSeconds,
        lastAt: lastAll.createdAt,
      };
    }
    if (maxPer24h > 0 && count24h >= maxPer24h) {
      return {
        allowed: false as const,
        reason: 'max_24h' as const,
        maxPer24h,
        windowStart: since24h,
      };
    }
    return { allowed: true as const };
  }

  function buildAllMentionBlockedMetadata(
    roomId: string,
    rateLimit:
      | {
          allowed: false;
          reason: 'min_interval';
          minIntervalSeconds: number;
          lastAt: Date;
        }
      | {
          allowed: false;
          reason: 'max_24h';
          maxPer24h: number;
          windowStart: Date;
        },
  ) {
    const metadata: Record<string, unknown> = {
      roomId,
      reason: rateLimit.reason,
    };
    if (rateLimit.reason === 'min_interval') {
      metadata.minIntervalSeconds = rateLimit.minIntervalSeconds;
      metadata.lastAt = rateLimit.lastAt.toISOString();
    }
    if (rateLimit.reason === 'max_24h') {
      metadata.maxPer24h = rateLimit.maxPer24h;
      metadata.windowStart = rateLimit.windowStart.toISOString();
    }
    return metadata;
  }

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
        metadata: buildAllMentionBlockedMetadata(
          options.roomId,
          rateLimit,
        ) as Prisma.InputJsonValue,
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

  async function tryCreateRoomChatMentionNotifications(options: {
    req: any;
    room: {
      id: string;
      type: string;
      groupId: string | null;
      viewerGroupIds?: unknown;
      allowExternalUsers: boolean;
    };
    messageId: string;
    messageBody: string;
    senderUserId: string;
    mentionsAll: boolean;
    mentionUserIds: string[];
    mentionGroupIds: string[];
  }) {
    try {
      const mentionUserIds = await expandRoomMentionRecipients({
        room: options.room,
        mentionUserIds: options.mentionUserIds,
        mentionGroupIds: options.mentionGroupIds,
        mentionsAll: options.mentionsAll,
      });
      const notificationResult = await createChatMentionNotifications({
        projectId: options.room.type === 'project' ? options.room.id : null,
        roomId: options.room.id,
        messageId: options.messageId,
        messageBody: options.messageBody,
        senderUserId: options.senderUserId,
        mentionUserIds,
        mentionGroupIds: options.mentionGroupIds,
        mentionAll: options.mentionsAll,
      });
      if (notificationResult.created <= 0) {
        return notificationResult.recipients;
      }

      await logAudit({
        action: 'chat_mention_notifications_created',
        targetTable: 'chat_messages',
        targetId: options.messageId,
        metadata: {
          roomId: options.room.id,
          projectId: options.room.type === 'project' ? options.room.id : null,
          messageId: options.messageId,
          createdCount: notificationResult.created,
          recipientCount: notificationResult.recipients.length,
          recipientUserIds: notificationResult.recipients.slice(0, 20),
          recipientsTruncated: notificationResult.truncated,
          mentionAll: options.mentionsAll,
          mentionUserCount: mentionUserIds.length,
          mentionGroupCount: options.mentionGroupIds.length,
          usesProjectMemberFallback:
            notificationResult.usesProjectMemberFallback,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(options.req),
      });
      return notificationResult.recipients;
    } catch (err) {
      options.req.log?.warn(
        { err },
        'Failed to create room chat mention notifications',
      );
    }
    return [];
  }

  async function tryCreateRoomChatMessageNotifications(options: {
    req: any;
    room: {
      id: string;
      type: string;
      groupId: string | null;
      viewerGroupIds?: unknown;
      allowExternalUsers: boolean;
    };
    messageId: string;
    messageBody: string;
    senderUserId: string;
    excludeUserIds?: string[];
  }) {
    try {
      const audience = await resolveRoomAudienceUserIds({
        room: options.room,
      });
      if (audience.size === 0) return [];
      const notificationResult = await createChatMessageNotifications({
        projectId: options.room.type === 'project' ? options.room.id : null,
        roomId: options.room.id,
        messageId: options.messageId,
        messageBody: options.messageBody,
        senderUserId: options.senderUserId,
        recipientUserIds: Array.from(audience),
        excludeUserIds: options.excludeUserIds,
      });
      if (notificationResult.created <= 0) {
        return notificationResult.recipients;
      }

      await logAudit({
        action: 'chat_message_notifications_created',
        targetTable: 'chat_messages',
        targetId: options.messageId,
        metadata: {
          roomId: options.room.id,
          projectId: options.room.type === 'project' ? options.room.id : null,
          messageId: options.messageId,
          createdCount: notificationResult.created,
          recipientCount: notificationResult.recipients.length,
          recipientUserIds: notificationResult.recipients.slice(0, 20),
          recipientsTruncated: notificationResult.truncated,
          audienceCount: audience.size,
          excludedCount: options.excludeUserIds?.length ?? 0,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(options.req),
      });
      return notificationResult.recipients;
    } catch (err) {
      options.req.log?.warn(
        { err },
        'Failed to create room chat message notifications',
      );
    }
    return [];
  }

  type RoomAccessContext = {
    roles: string[];
    projectIds: string[];
    groupIds: string[];
    groupAccountIds: string[];
  };

  function readRoomAccessContext(req: any): RoomAccessContext {
    return {
      roles: req.user?.roles || [],
      projectIds: req.user?.projectIds || [],
      groupIds: Array.isArray(req.user?.groupIds) ? req.user.groupIds : [],
      groupAccountIds: Array.isArray(req.user?.groupAccountIds)
        ? req.user.groupAccountIds
        : [],
    };
  }

  async function ensureRoomAccessWithReasonError(options: {
    reply: any;
    roomId: string;
    userId: string;
    accessContext: RoomAccessContext;
    accessLevel?: 'read' | 'post';
  }) {
    const access = await ensureChatRoomContentAccess({
      roomId: options.roomId,
      userId: options.userId,
      roles: options.accessContext.roles,
      projectIds: options.accessContext.projectIds,
      groupIds: options.accessContext.groupIds,
      groupAccountIds: options.accessContext.groupAccountIds,
      accessLevel: options.accessLevel,
    });
    if (access.ok) return access;
    options.reply
      .status(access.reason === 'not_found' ? 404 : 403)
      .send({ error: access.reason });
    return null;
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
        mentionRecipients = await tryCreateRoomChatMentionNotifications({
          req,
          room: access.room,
          messageId: message.id,
          messageBody: message.body,
          senderUserId: userId,
          mentionsAll,
          mentionUserIds,
          mentionGroupIds,
        });
      }

      await tryCreateRoomChatMessageNotifications({
        req,
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
        req,
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
        req,
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
