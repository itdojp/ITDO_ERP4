import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import {
  projectChatMessageSchema,
  projectChatReactionSchema,
  projectChatSummarySchema,
} from './validators.js';
import { prisma } from '../services/db.js';
import { requireProjectAccess, requireRole } from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { searchChatAckCandidates } from '../services/chatAckCandidates.js';
import { buildChatMentionCandidates } from '../services/chatMentionCandidates.js';
import { defaultChatNotificationPort } from '../adapters/notifications/chatNotificationAdapter.js';
import {
  tryCreateChatMentionNotificationEffects,
  tryCreateChatMessageNotificationEffects,
} from '../application/chat/chatNotificationEffects.js';
import {
  getChatUnreadSummary,
  markChatAsRead,
} from '../services/chatReadState.js';
import { CHAT_ROLES } from './chat/shared/constants.js';
import {
  normalizeStringArray,
  parseLimit,
  parseLimitNumber,
} from './chat/shared/inputParsers.js';
import {
  buildAllMentionBlockedMetadata,
  enforceAllMentionRateLimit,
} from './chat/shared/allMentionRateLimit.js';
import { normalizeMentions } from './chat/shared/mentions.js';
import { ensureRoomAccessWithReasonError } from './chat/shared/roomAccessGuard.js';
import { requireUserId } from './chat/shared/requireUserId.js';
import { parseDateParam } from '../utils/date.js';

import { registerChatAckRequestRoutes } from './chat/ackRequests.js';
import { registerChatAttachmentRoutes } from './chat/attachments.js';

function isUniqueConstraintError(err: unknown) {
  return (
    Boolean(err) && typeof err === 'object' && (err as any).code === 'P2002'
  );
}

export async function registerChatRoutes(app: FastifyInstance) {
  const chatRoles = CHAT_ROLES;
  async function ensureProjectRoom(projectId: string, userId: string | null) {
    const existing = await prisma.chatRoom.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (existing) return true;
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, code: true, deletedAt: true },
    });
    if (!project || project.deletedAt) return false;
    try {
      await prisma.chatRoom.create({
        data: {
          id: project.id,
          type: 'project',
          name: project.code,
          isOfficial: true,
          projectId: project.id,
          createdBy: userId,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return true;
      }
      throw err;
    }
    return true;
  }

  async function resolveActiveProjectRoom(options: {
    projectId: string;
    userId: string | null;
    reply: any;
    req?: any;
    accessLevel?: 'read' | 'post';
  }) {
    const { projectId, userId, reply } = options;
    if (!(await ensureProjectRoom(projectId, userId))) {
      reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Project not found' },
      });
      return null;
    }
    const room = await prisma.chatRoom.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        type: true,
        groupId: true,
        viewerGroupIds: true,
        deletedAt: true,
        allowExternalUsers: true,
      },
    });
    if (!room || room.deletedAt) {
      reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Room not found' },
      });
      return null;
    }
    if (options.req && userId) {
      const access = await ensureRoomContentAccessFromRequest({
        req: options.req,
        reply,
        roomId: room.id,
        userId,
        accessLevel: options.accessLevel ?? 'read',
      });
      if (!access) return null;
    }
    return room;
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

  async function ensureRoomContentAccessFromRequest(options: {
    req: any;
    reply: any;
    roomId: string;
    userId: string;
    accessLevel?: 'read' | 'post';
  }) {
    return ensureRoomAccessWithReasonError({
      req: options.req,
      reply: options.reply,
      roomId: options.roomId,
      userId: options.userId,
      accessLevel: options.accessLevel,
    });
  }

  async function logChatMessageMentions(options: {
    req: any;
    messageId: string;
    projectId: string;
    mentionsAll: boolean;
    mentionUserIds: string[];
    mentionGroupIds: string[];
  }) {
    if (
      !options.mentionsAll &&
      options.mentionUserIds.length === 0 &&
      options.mentionGroupIds.length === 0
    ) {
      return;
    }
    await logAudit({
      action: 'chat_message_posted_with_mentions',
      targetTable: 'chat_messages',
      targetId: options.messageId,
      metadata: {
        projectId: options.projectId,
        mentionAll: options.mentionsAll,
        mentionUserCount: options.mentionUserIds.length,
        mentionGroupCount: options.mentionGroupIds.length,
      } as Prisma.InputJsonValue,
      ...auditContextFromRequest(options.req),
    });
    if (options.mentionsAll) {
      await logAudit({
        action: 'chat_all_mention_posted',
        targetTable: 'chat_messages',
        targetId: options.messageId,
        metadata: { projectId: options.projectId } as Prisma.InputJsonValue,
        ...auditContextFromRequest(options.req),
      });
    }
  }

  app.get(
    '/projects/:projectId/chat-messages',
    {
      schema: { deprecated: true },
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { limit, before, tag } = req.query as {
        limit?: string;
        before?: string;
        tag?: string;
      };
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
      const room = await resolveActiveProjectRoom({
        projectId,
        userId: req.user?.userId || null,
        reply,
        req,
        accessLevel: 'read',
      });
      if (!room) return reply;
      const where: Prisma.ChatMessageWhereInput = {
        roomId: room.id,
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
    '/projects/:projectId/chat-summary',
    {
      schema: { ...projectChatSummarySchema, deprecated: true },
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as {
        since?: string;
        until?: string;
        limit?: number;
      };
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
      const room = await resolveActiveProjectRoom({
        projectId,
        userId: req.user?.userId || null,
        reply,
        req,
        accessLevel: 'read',
      });
      if (!room) return reply;

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
          roomId: room.id,
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
        `- projectId: ${room.id}`,
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
          projectId,
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
          projectId,
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

  app.get(
    '/projects/:projectId/chat-mention-candidates',
    {
      schema: { deprecated: true },
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const room = await resolveActiveProjectRoom({
        projectId,
        userId: req.user?.userId || null,
        reply,
        req,
        accessLevel: 'read',
      });
      if (!room) return reply;
      const currentUserId = req.user?.userId || '';
      const groupIds = Array.isArray(req.user?.groupIds)
        ? req.user.groupIds
        : [];
      const groupAccountIds = Array.isArray(req.user?.groupAccountIds)
        ? req.user.groupAccountIds
        : [];
      return buildChatMentionCandidates({
        // legacy project endpoint keeps project-only candidates during compatibility period.
        room: {
          ...room,
          allowExternalUsers: false,
        },
        requesterUserId: currentUserId,
        groupIds,
        groupAccountIds,
      });
    },
  );

  app.get(
    '/projects/:projectId/chat-ack-candidates',
    {
      schema: { deprecated: true },
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const { q } = req.query as { q?: string };
      const keyword = (q || '').trim();
      if (keyword.length < 2) {
        return { users: [], groups: [] };
      }
      const room = await resolveActiveProjectRoom({
        projectId,
        userId: req.user?.userId || null,
        reply,
        req,
        accessLevel: 'read',
      });
      if (!room) return reply;
      return searchChatAckCandidates({ room, q: keyword });
    },
  );

  app.get(
    '/projects/:projectId/chat-unread',
    {
      schema: { deprecated: true },
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const room = await resolveActiveProjectRoom({
        projectId,
        userId,
        reply,
        req,
        accessLevel: 'read',
      });
      if (!room) return reply;
      return getChatUnreadSummary({ roomId: room.id, userId });
    },
  );

  app.post(
    '/projects/:projectId/chat-read',
    {
      schema: { deprecated: true },
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const room = await resolveActiveProjectRoom({
        projectId,
        userId,
        reply,
        req,
        accessLevel: 'read',
      });
      if (!room) return reply;
      return markChatAsRead({ roomId: room.id, userId });
    },
  );

  app.post(
    '/projects/:projectId/chat-messages',
    {
      schema: { ...projectChatMessageSchema, deprecated: true },
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as {
        body: string;
        tags?: string[];
        mentions?: unknown;
      };
      const userId = req.user?.userId || 'demo-user';
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
        },
      });
      await logChatMessageMentions({
        req,
        messageId: message.id,
        projectId,
        mentionsAll,
        mentionUserIds,
        mentionGroupIds,
      });
      const mentionRecipients = await tryCreateChatMentionNotificationEffects({
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
      await tryCreateChatMessageNotificationEffects({
        auditContext: auditContextFromRequest(req),
        logger: req.log,
        failureMessage: 'Failed to create project chat message notifications',
        notificationPort: defaultChatNotificationPort,
        projectId,
        room,
        messageId: message.id,
        messageBody: message.body,
        senderUserId: userId,
        excludeUserIds: mentionRecipients,
      });
      return message;
    },
  );

  registerChatAckRequestRoutes(app, {
    chatRoles,
    resolveActiveProjectRoom,
    ensureAllMentionAllowed,
    ensureRoomContentAccessFromRequest,
    logChatMessageMentions,
  });

  app.post(
    '/chat-messages/:id/reactions',
    {
      schema: projectChatReactionSchema,
      preHandler: requireRole(chatRoles),
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { emoji: string };
      const message = await prisma.chatMessage.findUnique({
        where: { id },
      });
      if (!message || message.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Message not found' },
        });
      }
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const access = await ensureRoomContentAccessFromRequest({
        req,
        reply,
        roomId: message.roomId,
        userId,
      });
      if (!access) {
        return;
      }
      const trimmedEmoji = body.emoji.trim();
      if (!trimmedEmoji) {
        return reply.status(400).send({
          error: { code: 'INVALID_EMOJI', message: 'emoji is required' },
        });
      }
      const current =
        (message.reactions as Record<string, unknown> | null | undefined) || {};
      const existingEntry = current[trimmedEmoji] as
        number | { count: number; userIds: string[] } | undefined;
      let normalized = { count: 0, userIds: [] as string[] };
      if (typeof existingEntry === 'number') {
        normalized = { count: existingEntry, userIds: [] };
      } else if (
        existingEntry &&
        typeof existingEntry === 'object' &&
        'count' in existingEntry &&
        'userIds' in existingEntry &&
        Array.isArray((existingEntry as { userIds: unknown }).userIds)
      ) {
        normalized = {
          count: (existingEntry as { count: number }).count,
          userIds: (existingEntry as { userIds: string[] }).userIds,
        };
      }
      if (normalized.userIds.includes(userId)) {
        return message;
      }
      normalized = {
        count: normalized.count + 1,
        userIds: [...normalized.userIds, userId],
      };
      const next = {
        ...current,
        [trimmedEmoji]: normalized,
      } as Prisma.InputJsonValue;
      const updated = await prisma.chatMessage.update({
        where: { id },
        data: {
          reactions: next,
          updatedBy: userId,
        },
      });
      return updated;
    },
  );

  registerChatAttachmentRoutes(app, {
    chatRoles,
    ensureRoomContentAccessFromRequest,
  });
}
