import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import {
  projectChatMessageSchema,
  projectChatAckRequestSchema,
  projectChatReactionSchema,
  projectChatSummarySchema,
} from './validators.js';
import { prisma } from '../services/db.js';
import {
  hasProjectAccess,
  requireProjectAccess,
  requireRole,
} from '../services/rbac.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import {
  openAttachment,
  storeAttachment,
} from '../services/chatAttachments.js';
import { createChatMentionNotifications } from '../services/appNotifications.js';

function parseDateParam(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseLimit(value?: string, fallback = 50) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return Math.min(parsed, 200);
}

function parseLimitNumber(value: unknown, fallback = 100) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  if (!Number.isInteger(normalized) || normalized <= 0) return null;
  return Math.min(normalized, 200);
}

function normalizeStringArray(
  value: unknown,
  options?: { dedupe?: boolean; max?: number },
) {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
  const deduped = options?.dedupe ? Array.from(new Set(items)) : items;
  return typeof options?.max === 'number'
    ? deduped.slice(0, options.max)
    : deduped;
}

function parseMaxBytes(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseNonNegativeInt(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

async function readFileBuffer(
  stream: AsyncIterable<Buffer>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error('FILE_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function registerChatRoutes(app: FastifyInstance) {
  const chatRoles = ['admin', 'mgmt', 'user', 'hr', 'exec', 'external_chat'];

  type AllMentionRateLimit =
    | { allowed: true }
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
      };

  function normalizeMentions(value: unknown) {
    if (!value || typeof value !== 'object') {
      return {
        mentions: undefined as Prisma.InputJsonValue | undefined,
        mentionsAll: false,
        mentionUserIds: [] as string[],
        mentionGroupIds: [] as string[],
      };
    }
    const record = value as {
      userIds?: unknown;
      groupIds?: unknown;
      all?: unknown;
    };
    const mentionUserIds = normalizeStringArray(record.userIds, {
      dedupe: true,
      max: 50,
    });
    const mentionGroupIds = normalizeStringArray(record.groupIds, {
      dedupe: true,
      max: 20,
    });
    const mentionsAll = record.all === true;
    const mentions =
      mentionUserIds.length || mentionGroupIds.length
        ? ({
            userIds: mentionUserIds.length ? mentionUserIds : undefined,
            groupIds: mentionGroupIds.length ? mentionGroupIds : undefined,
          } as Prisma.InputJsonValue)
        : undefined;
    return { mentions, mentionsAll, mentionUserIds, mentionGroupIds };
  }

  async function enforceAllMentionRateLimit(options: {
    projectId: string;
    userId: string;
    now: Date;
  }): Promise<AllMentionRateLimit> {
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
        ? prisma.projectChatMessage.findFirst({
            where: {
              projectId: options.projectId,
              userId: options.userId,
              mentionsAll: true,
              deletedAt: null,
            },
            select: { createdAt: true },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve(null),
      maxPer24h > 0
        ? prisma.projectChatMessage.count({
            where: {
              projectId: options.projectId,
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
        allowed: false,
        reason: 'min_interval',
        minIntervalSeconds,
        lastAt: lastAll.createdAt,
      };
    }
    if (maxPer24h > 0 && count24h >= maxPer24h) {
      return {
        allowed: false,
        reason: 'max_24h',
        maxPer24h,
        windowStart: since24h,
      };
    }
    return { allowed: true };
  }

  function buildAllMentionBlockedMetadata(
    projectId: string,
    rateLimit: Exclude<AllMentionRateLimit, { allowed: true }>,
  ) {
    const metadata: Record<string, unknown> = {
      projectId,
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
    projectId: string;
    userId: string;
  }) {
    const roles = options.req.user?.roles || [];
    if (roles.includes('external_chat')) {
      options.reply.status(403).send({
        error: {
          code: 'FORBIDDEN_ALL_MENTION',
          message: 'external_chat cannot use @all',
        },
      });
      return false;
    }

    const rateLimit = await enforceAllMentionRateLimit({
      projectId: options.projectId,
      userId: options.userId,
      now: new Date(),
    });
    if (!rateLimit.allowed) {
      await logAudit({
        action: 'chat_all_mention_blocked',
        targetTable: 'project_chat_messages',
        metadata: buildAllMentionBlockedMetadata(
          options.projectId,
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
      targetTable: 'project_chat_messages',
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
        targetTable: 'project_chat_messages',
        targetId: options.messageId,
        metadata: { projectId: options.projectId } as Prisma.InputJsonValue,
        ...auditContextFromRequest(options.req),
      });
    }
  }

  async function tryCreateChatMentionNotifications(options: {
    req: any;
    projectId: string;
    messageId: string;
    messageBody: string;
    senderUserId: string;
    mentionsAll: boolean;
    mentionUserIds: string[];
    mentionGroupIds: string[];
  }) {
    try {
      const notificationResult = await createChatMentionNotifications({
        projectId: options.projectId,
        messageId: options.messageId,
        messageBody: options.messageBody,
        senderUserId: options.senderUserId,
        mentionUserIds: options.mentionUserIds,
        mentionGroupIds: options.mentionGroupIds,
        mentionAll: options.mentionsAll,
      });
      if (notificationResult.created <= 0) return;

      await logAudit({
        action: 'chat_mention_notifications_created',
        targetTable: 'project_chat_messages',
        targetId: options.messageId,
        metadata: {
          projectId: options.projectId,
          messageId: options.messageId,
          createdCount: notificationResult.created,
          recipientCount: notificationResult.recipients.length,
          recipientUserIds: notificationResult.recipients.slice(0, 20),
          recipientsTruncated: notificationResult.truncated,
          mentionAll: options.mentionsAll,
          mentionUserCount: options.mentionUserIds.length,
          mentionGroupCount: options.mentionGroupIds.length,
          usesProjectMemberFallback: notificationResult.usesProjectMemberFallback,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(options.req),
      });
    } catch (err) {
      options.req.log?.warn(
        { err },
        'Failed to create chat mention notifications',
      );
    }
  }

  app.get(
    '/projects/:projectId/chat-messages',
    {
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
      const where: Prisma.ProjectChatMessageWhereInput = {
        projectId,
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
      const items = await prisma.projectChatMessage.findMany({
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
      schema: projectChatSummarySchema,
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

      const createdAt =
        since && until
          ? { gte: since, lte: until }
          : since
            ? { gte: since }
            : until
              ? { lte: until }
              : undefined;

      const items = await prisma.projectChatMessage.findMany({
        where: {
          projectId,
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
        `- projectId: ${projectId}`,
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
        targetTable: 'project_chat_messages',
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
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req) => {
      const { projectId } = req.params as { projectId: string };
      const currentUserId = req.user?.userId || '';
      const groupIds = Array.isArray(req.user?.groupIds)
        ? req.user.groupIds
        : [];
      const members = await prisma.projectMember.findMany({
        where: { projectId },
        select: { userId: true, role: true },
        orderBy: { userId: 'asc' },
      });
      const userIdSet = new Set(members.map((member) => member.userId));
      if (currentUserId) {
        userIdSet.add(currentUserId);
      }
      const userIds = Array.from(userIdSet);
      const accounts = userIds.length
        ? await prisma.userAccount.findMany({
            where: {
              userName: { in: userIds },
              deletedAt: null,
              active: true,
            },
            select: { userName: true, displayName: true },
          })
        : [];
      const displayMap = new Map(
        accounts.map((account) => [
          account.userName,
          account.displayName || null,
        ]),
      );
      const users = userIds
        .map((userId) => ({
          userId,
          displayName: displayMap.get(userId) || null,
        }))
        .sort((a, b) => a.userId.localeCompare(b.userId));
      const groups = Array.from(
        new Set(
          groupIds
            .map((groupId) =>
              typeof groupId === 'string' ? groupId.trim() : '',
            )
            .filter(Boolean),
        ),
      ).map((groupId) => ({ groupId }));
      const allowAll = !(req.user?.roles || []).includes('external_chat');
      return { users, groups, allowAll };
    },
  );

  app.get(
    '/projects/:projectId/chat-unread',
    {
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const state = await prisma.projectChatReadState.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { lastReadAt: true },
      });
      const unreadCount = await prisma.projectChatMessage.count({
        where: {
          projectId,
          deletedAt: null,
          createdAt: state?.lastReadAt ? { gt: state.lastReadAt } : undefined,
        },
      });
      return {
        unreadCount,
        lastReadAt: state?.lastReadAt ? state.lastReadAt.toISOString() : null,
      };
    },
  );

  app.post(
    '/projects/:projectId/chat-read',
    {
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const now = new Date();
      const updated = await prisma.projectChatReadState.upsert({
        where: { projectId_userId: { projectId, userId } },
        update: { lastReadAt: now },
        create: {
          projectId,
          userId,
          lastReadAt: now,
        },
        select: { lastReadAt: true },
      });
      return { lastReadAt: updated.lastReadAt.toISOString() };
    },
  );

  app.post(
    '/projects/:projectId/chat-messages',
    {
      schema: projectChatMessageSchema,
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

      if (mentionsAll) {
        const ok = await ensureAllMentionAllowed({
          req,
          reply,
          projectId,
          userId,
        });
        if (!ok) return;
      }
      const message = await prisma.projectChatMessage.create({
        data: {
          projectId,
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
      await tryCreateChatMentionNotifications({
        req,
        projectId,
        messageId: message.id,
        messageBody: message.body,
        senderUserId: userId,
        mentionsAll,
        mentionUserIds,
        mentionGroupIds,
      });
      return message;
    },
  );

  app.post(
    '/projects/:projectId/chat-ack-requests',
    {
      schema: projectChatAckRequestSchema,
      preHandler: [
        requireRole(chatRoles),
        requireProjectAccess((req) => (req.params as any)?.projectId),
      ],
    },
    async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = req.body as {
        body: string;
        requiredUserIds: string[];
        dueAt?: string;
        tags?: string[];
        mentions?: unknown;
      };
      const userId = req.user?.userId || 'demo-user';
      const requiredUserIds = normalizeStringArray(body.requiredUserIds, {
        dedupe: true,
        max: 50,
      });
      if (!requiredUserIds.length) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_REQUIRED_USERS',
            message: 'requiredUserIds must contain at least one userId',
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
          projectId,
          userId,
        });
        if (!ok) return;
      }

      const message = await prisma.projectChatMessage.create({
        data: {
          projectId,
          userId,
          body: body.body,
          tags: normalizeStringArray(body.tags, { max: 8 }) || undefined,
          mentions,
          mentionsAll,
          createdBy: userId,
          updatedBy: userId,
          ackRequest: {
            create: {
              projectId,
              requiredUserIds,
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
      await logChatMessageMentions({
        req,
        messageId: message.id,
        projectId,
        mentionsAll,
        mentionUserIds,
        mentionGroupIds,
      });
      await tryCreateChatMentionNotifications({
        req,
        projectId,
        messageId: message.id,
        messageBody: message.body,
        senderUserId: userId,
        mentionsAll,
        mentionUserIds,
        mentionGroupIds,
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
      const requestItem = await prisma.projectChatAckRequest.findUnique({
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

      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      if (!hasProjectAccess(roles, projectIds, requestItem.projectId)) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN_PROJECT',
            message: 'Access to this project is forbidden',
          },
        });
      }

      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const requiredUserIds = normalizeStringArray(
        requestItem.requiredUserIds,
        {
          dedupe: true,
        },
      );
      if (!requiredUserIds.includes(userId)) {
        return reply.status(403).send({
          error: {
            code: 'NOT_REQUIRED',
            message: 'User is not in requiredUserIds',
          },
        });
      }

      await prisma.projectChatAck.upsert({
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

      const updated = await prisma.projectChatAckRequest.findUnique({
        where: { id: requestItem.id },
        include: { acks: true },
      });
      return updated;
    },
  );

  app.post(
    '/chat-messages/:id/reactions',
    {
      schema: projectChatReactionSchema,
      preHandler: requireRole(chatRoles),
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { emoji: string };
      const message = await prisma.projectChatMessage.findUnique({
        where: { id },
      });
      if (!message || message.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Message not found' },
        });
      }
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      if (!hasProjectAccess(roles, projectIds, message.projectId)) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN_PROJECT',
            message: 'Access to this project is forbidden',
          },
        });
      }
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
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
        | number
        | { count: number; userIds: string[] }
        | undefined;
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
      const updated = await prisma.projectChatMessage.update({
        where: { id },
        data: {
          reactions: next,
          updatedBy: userId,
        },
      });
      return updated;
    },
  );

  app.post(
    '/chat-messages/:id/attachments',
    {
      preHandler: requireRole(chatRoles),
      bodyLimit: parseMaxBytes(
        process.env.CHAT_ATTACHMENT_MAX_BYTES,
        10 * 1024 * 1024,
      ),
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const message = await prisma.projectChatMessage.findUnique({
        where: { id },
      });
      if (!message || message.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Message not found' },
        });
      }
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      if (!hasProjectAccess(roles, projectIds, message.projectId)) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN_PROJECT',
            message: 'Access to this project is forbidden',
          },
        });
      }
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }

      const maxBytes = parseMaxBytes(
        process.env.CHAT_ATTACHMENT_MAX_BYTES,
        10 * 1024 * 1024,
      );
      const file = await (req as any).file?.();
      if (!file) {
        return reply.status(400).send({
          error: { code: 'MISSING_FILE', message: 'file is required' },
        });
      }
      const filename = typeof file.filename === 'string' ? file.filename : '';
      if (!filename) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_FILENAME',
            message: 'filename is required',
          },
        });
      }
      const mimetype = typeof file.mimetype === 'string' ? file.mimetype : null;

      let buffer: Buffer;
      try {
        buffer = await readFileBuffer(file.file, maxBytes);
      } catch (err) {
        if (err instanceof Error && err.message === 'FILE_TOO_LARGE') {
          return reply.status(413).send({
            error: {
              code: 'FILE_TOO_LARGE',
              message: `file exceeds ${maxBytes} bytes`,
            },
          });
        }
        throw err;
      }

      const stored = await storeAttachment({
        buffer,
        originalName: filename,
        mimeType: mimetype,
      });

      const attachment = await prisma.projectChatAttachment.create({
        data: {
          messageId: message.id,
          provider: stored.provider,
          providerKey: stored.providerKey,
          sha256: stored.sha256,
          sizeBytes: stored.sizeBytes,
          mimeType: stored.mimeType,
          originalName: stored.originalName,
          createdBy: userId,
        },
        select: {
          id: true,
          messageId: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
          createdBy: true,
        },
      });
      await logAudit({
        action: 'chat_attachment_uploaded',
        targetTable: 'project_chat_attachments',
        targetId: attachment.id,
        metadata: {
          messageId: message.id,
          projectId: message.projectId,
          provider: stored.provider,
          sizeBytes: stored.sizeBytes,
          mimeType: stored.mimeType,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });
      return attachment;
    },
  );

  app.get(
    '/chat-attachments/:id',
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const attachment = await prisma.projectChatAttachment.findUnique({
        where: { id },
        include: { message: true },
      });
      if (!attachment || attachment.deletedAt || attachment.message.deletedAt) {
        return reply
          .status(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      }
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      if (!hasProjectAccess(roles, projectIds, attachment.message.projectId)) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN_PROJECT',
            message: 'Access to this project is forbidden',
          },
        });
      }

      const safeFilename = attachment.originalName.replace(/["\\\r\n]/g, '_');
      reply.header(
        'Content-Disposition',
        `attachment; filename="${safeFilename}"`,
      );
      reply.type(attachment.mimeType || 'application/octet-stream');

      const opened = await openAttachment(
        attachment.provider === 'gdrive' ? 'gdrive' : 'local',
        attachment.providerKey,
      );
      opened.stream.on('error', (err) => {
        opened.stream.destroy();
        if (req.log && typeof req.log.error === 'function') {
          req.log.error({ err }, 'Error while streaming attachment');
        }
        if (!reply.raw.headersSent) {
          reply.status(500).send({ error: 'internal_error' });
        }
      });

      await logAudit({
        action: 'chat_attachment_downloaded',
        targetTable: 'project_chat_attachments',
        targetId: attachment.id,
        metadata: {
          messageId: attachment.messageId,
          projectId: attachment.message.projectId,
          provider: attachment.provider,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });
      return reply.send(opened.stream);
    },
  );
}
