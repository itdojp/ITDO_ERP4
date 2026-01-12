import { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { requireRole } from '../services/rbac.js';
import { ensureChatRoomContentAccess } from '../services/chatRoomAccess.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import {
  chatRoomCreateSchema,
  chatRoomMemberAddSchema,
  projectChatAckRequestSchema,
  projectChatMessageSchema,
} from './validators.js';

export async function registerChatRoomRoutes(app: FastifyInstance) {
  const chatRoles = ['admin', 'mgmt', 'user', 'hr', 'exec', 'external_chat'];
  const chatSettingId = 'default';

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

  function parseNonNegativeInt(raw: string | undefined, fallback: number) {
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.floor(parsed);
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

  function buildDmRoomId(userA: string, userB: string) {
    const [left, right] = [userA.trim(), userB.trim()].sort((a, b) =>
      a.localeCompare(b),
    );
    const digest = crypto
      .createHash('sha256')
      .update(`${left}\n${right}`)
      .digest('hex')
      .slice(0, 32);
    return `dm_${digest}`;
  }

  function buildDmRoomName(userA: string, userB: string) {
    const [left, right] = [userA.trim(), userB.trim()].sort((a, b) =>
      a.localeCompare(b),
    );
    return `dm:${left}:${right}`;
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

  app.get(
    '/chat-rooms',
    { preHandler: requireRole(chatRoles) },
    async (req) => {
      const roles = req.user?.roles || [];
      const userId = req.user?.userId;
      const projectIds = req.user?.projectIds || [];
      const canSeeAllMeta =
        roles.includes('admin') ||
        roles.includes('mgmt') ||
        roles.includes('exec');

      const canSeeAllProjects = canSeeAllMeta;

      const projects =
        canSeeAllProjects || projectIds.length > 0
          ? await prisma.project.findMany({
              where: canSeeAllProjects
                ? { deletedAt: null }
                : { id: { in: projectIds }, deletedAt: null },
              orderBy: { createdAt: 'desc' },
              take: 200,
              select: {
                id: true,
                code: true,
                name: true,
                createdAt: true,
              },
            })
          : [];

      const targetProjectIds = projects.map((project) => project.id);
      if (targetProjectIds.length > 0) {
        const existing = await prisma.chatRoom.findMany({
          where: {
            type: 'project',
            projectId: { in: targetProjectIds },
            deletedAt: null,
          },
          select: {
            id: true,
            projectId: true,
          },
        });

        const existingByProject = new Set(
          existing
            .filter(
              (room) => typeof room.projectId === 'string' && room.projectId,
            )
            .map((room) => room.projectId as string),
        );

        const missingProjects = projects.filter(
          (project) => !existingByProject.has(project.id),
        );

        if (missingProjects.length > 0) {
          await prisma.chatRoom.createMany({
            data: missingProjects.map((project) => ({
              id: project.id,
              type: 'project',
              name: project.code,
              isOfficial: true,
              projectId: project.id,
              createdBy: userId || null,
            })),
            skipDuplicates: true,
          });
        }
      }

      const [projectRooms, otherRooms] = await Promise.all([
        targetProjectIds.length > 0
          ? prisma.chatRoom.findMany({
              where: {
                type: 'project',
                projectId: { in: targetProjectIds },
                deletedAt: null,
              },
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                type: true,
                name: true,
                isOfficial: true,
                projectId: true,
                groupId: true,
                allowExternalUsers: true,
                allowExternalIntegrations: true,
                createdAt: true,
                createdBy: true,
                updatedAt: true,
                updatedBy: true,
              },
            })
          : Promise.resolve([]),
        canSeeAllMeta
          ? prisma.chatRoom.findMany({
              where: { type: { not: 'project' }, deletedAt: null },
              orderBy: { createdAt: 'desc' },
              take: 200,
              select: {
                id: true,
                type: true,
                name: true,
                isOfficial: true,
                projectId: true,
                groupId: true,
                allowExternalUsers: true,
                allowExternalIntegrations: true,
                createdAt: true,
                createdBy: true,
                updatedAt: true,
                updatedBy: true,
              },
            })
          : userId
            ? prisma.chatRoomMember
                .findMany({
                  where: {
                    userId,
                    deletedAt: null,
                    room: {
                      deletedAt: null,
                      type: { not: 'project' },
                      ...(roles.includes('external_chat')
                        ? { allowExternalUsers: true }
                        : {}),
                    },
                  },
                  orderBy: { createdAt: 'desc' },
                  take: 200,
                  select: {
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
                        createdAt: true,
                        createdBy: true,
                        updatedAt: true,
                        updatedBy: true,
                      },
                    },
                  },
                })
                .then((rows) => rows.map((row) => row.room))
            : Promise.resolve([]),
      ]);

      const projectMap = new Map(
        projects.map((project) => [
          project.id,
          { code: project.code, name: project.name },
        ]),
      );

      const memberRoleByRoom =
        canSeeAllMeta && userId && otherRooms.length
          ? new Map(
              (
                await prisma.chatRoomMember.findMany({
                  where: {
                    userId,
                    roomId: { in: otherRooms.map((room) => room.id) },
                    deletedAt: null,
                  },
                  select: { roomId: true, role: true },
                })
              ).map((row) => [row.roomId, row.role]),
            )
          : new Map<string, string>();

      const items = [
        ...projectRooms.map((room) => {
          const projectId = room.projectId || null;
          const project = projectId ? projectMap.get(projectId) : undefined;
          return {
            id: room.id,
            type: room.type,
            name: room.name,
            isOfficial: room.isOfficial,
            projectId,
            projectCode: project?.code || null,
            projectName: project?.name || null,
            groupId: room.groupId || null,
            allowExternalUsers: room.allowExternalUsers,
            allowExternalIntegrations: room.allowExternalIntegrations,
            createdAt: room.createdAt,
            createdBy: room.createdBy || null,
            updatedAt: room.updatedAt,
            updatedBy: room.updatedBy || null,
          };
        }),
        ...otherRooms.map((room) => ({
          id: room.id,
          type: room.type,
          name: room.name,
          isOfficial: room.isOfficial,
          isMember: canSeeAllMeta ? memberRoleByRoom.has(room.id) : true,
          memberRole: canSeeAllMeta
            ? memberRoleByRoom.get(room.id) || null
            : null,
          projectId: null,
          projectCode: null,
          projectName: null,
          groupId: room.groupId || null,
          allowExternalUsers: room.allowExternalUsers,
          allowExternalIntegrations: room.allowExternalIntegrations,
          createdAt: room.createdAt,
          createdBy: room.createdBy || null,
          updatedAt: room.updatedAt,
          updatedBy: room.updatedBy || null,
        })),
      ];

      return { items };
    },
  );

  app.post(
    '/chat-rooms',
    { preHandler: requireRole(chatRoles), schema: chatRoomCreateSchema },
    async (req, reply) => {
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const roles = req.user?.roles || [];
      if (roles.includes('external_chat')) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN_EXTERNAL',
            message: 'external_chat cannot create rooms',
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

        const created = await prisma.chatRoom.create({
          data: {
            type: 'private_group',
            name,
            isOfficial: false,
            allowExternalUsers: false,
            allowExternalIntegrations: false,
            createdBy: userId,
            updatedBy: userId,
          },
        });

        const now = new Date();
        const members: Prisma.ChatRoomMemberCreateManyInput[] = [
          {
            roomId: created.id,
            userId,
            role: 'owner',
            createdBy: userId,
            updatedBy: userId,
            createdAt: now,
            updatedAt: now,
          },
          ...memberUserIds.map((memberId) => ({
            roomId: created.id,
            userId: memberId,
            role: 'member',
            createdBy: userId,
            updatedBy: userId,
            createdAt: now,
            updatedAt: now,
          })),
        ];
        await prisma.chatRoomMember.createMany({
          data: members,
          skipDuplicates: true,
        });

        await logAudit({
          action: 'chat_room_created',
          targetTable: 'chat_rooms',
          targetId: created.id,
          metadata: {
            type: created.type,
            isOfficial: created.isOfficial,
            memberCount: 1 + memberUserIds.length,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req),
        });

        return created;
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

      const roomId = buildDmRoomId(userId, partnerUserId);
      const roomName = buildDmRoomName(userId, partnerUserId);
      const existing = await prisma.chatRoom.findUnique({
        where: { id: roomId },
        select: { id: true },
      });
      const room = existing
        ? await prisma.chatRoom.update({
            where: { id: roomId },
            data: { updatedBy: userId },
          })
        : await prisma.chatRoom.create({
            data: {
              id: roomId,
              type: 'dm',
              name: roomName,
              isOfficial: false,
              allowExternalUsers: false,
              allowExternalIntegrations: false,
              createdBy: userId,
              updatedBy: userId,
            },
          });

      await Promise.all([
        prisma.chatRoomMember.upsert({
          where: { roomId_userId: { roomId, userId } },
          create: {
            roomId,
            userId,
            role: 'owner',
            createdBy: userId,
            updatedBy: userId,
          },
          update: {
            role: 'owner',
            deletedAt: null,
            deletedReason: null,
            updatedBy: userId,
          },
        }),
        prisma.chatRoomMember.upsert({
          where: { roomId_userId: { roomId, userId: partnerUserId } },
          create: {
            roomId,
            userId: partnerUserId,
            role: 'owner',
            createdBy: userId,
            updatedBy: userId,
          },
          update: {
            role: 'owner',
            deletedAt: null,
            deletedReason: null,
            updatedBy: userId,
          },
        }),
      ]);

      if (!existing) {
        await logAudit({
          action: 'chat_room_created',
          targetTable: 'chat_rooms',
          targetId: room.id,
          metadata: {
            type: room.type,
            isOfficial: room.isOfficial,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req),
        });
      }

      return room;
    },
  );

  app.post(
    '/chat-rooms/:roomId/members',
    { preHandler: requireRole(chatRoles), schema: chatRoomMemberAddSchema },
    async (req, reply) => {
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const roles = req.user?.roles || [];
      if (roles.includes('external_chat')) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN_EXTERNAL',
            message: 'external_chat cannot manage members',
          },
        });
      }
      const { roomId } = req.params as { roomId: string };
      const room = await prisma.chatRoom.findUnique({
        where: { id: roomId },
        select: { id: true, type: true, deletedAt: true },
      });
      if (!room || room.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Room not found' },
        });
      }
      if (room.type !== 'private_group') {
        return reply.status(400).send({
          error: {
            code: 'INVALID_ROOM_TYPE',
            message: 'room type is not private_group',
          },
        });
      }
      const membership = await prisma.chatRoomMember.findFirst({
        where: { roomId: room.id, userId, deletedAt: null },
        select: { role: true },
      });
      if (!membership || !['owner', 'admin'].includes(membership.role)) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN_ROOM_MEMBER',
            message: 'only room owner/admin can manage members',
          },
        });
      }

      const body = req.body as { userIds: string[] };
      const userIds = normalizeStringArray(body.userIds, {
        dedupe: true,
        max: 200,
      }).filter((entry) => entry !== userId);
      if (userIds.length === 0) {
        return { ok: true, added: 0 };
      }

      const now = new Date();
      const members: Prisma.ChatRoomMemberCreateManyInput[] = userIds.map(
        (memberId) => ({
          roomId: room.id,
          userId: memberId,
          role: 'member',
          createdBy: userId,
          updatedBy: userId,
          createdAt: now,
          updatedAt: now,
        }),
      );
      await prisma.chatRoomMember.createMany({
        data: members,
        skipDuplicates: true,
      });

      await logAudit({
        action: 'chat_room_members_added',
        targetTable: 'chat_room_members',
        metadata: {
          roomId: room.id,
          addedCount: userIds.length,
          addedUserIds: userIds.slice(0, 20),
          truncated: userIds.length > 20,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return { ok: true, added: userIds.length };
    },
  );

  app.get(
    '/chat-rooms/:roomId/mention-candidates',
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      const access = await ensureChatRoomContentAccess({
        roomId,
        userId,
        roles,
        projectIds,
      });
      if (!access.ok) {
        return reply
          .status(access.reason === 'not_found' ? 404 : 403)
          .send({ error: access.reason });
      }

      const groupIds = Array.isArray(req.user?.groupIds)
        ? req.user.groupIds
        : [];
      const members =
        access.room.type === 'project'
          ? []
          : await prisma.chatRoomMember.findMany({
              where: { roomId: access.room.id, deletedAt: null },
              select: { userId: true },
              orderBy: { userId: 'asc' },
            });
      const userIdSet = new Set(members.map((member) => member.userId));
      userIdSet.add(userId);
      const userIds = Array.from(userIdSet);
      const accounts = userIds.length
        ? await prisma.userAccount.findMany({
            where: { userName: { in: userIds }, deletedAt: null, active: true },
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
        .map((entry) => ({
          userId: entry,
          displayName: displayMap.get(entry) || null,
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
      const allowAll = !roles.includes('external_chat');
      return { users, groups, allowAll };
    },
  );

  app.get(
    '/chat-rooms/:roomId/unread',
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      const access = await ensureChatRoomContentAccess({
        roomId,
        userId,
        roles,
        projectIds,
      });
      if (!access.ok) {
        return reply
          .status(access.reason === 'not_found' ? 404 : 403)
          .send({ error: access.reason });
      }
      const state = await prisma.chatReadState.findUnique({
        where: { roomId_userId: { roomId: access.room.id, userId } },
        select: { lastReadAt: true },
      });
      const unreadCount = await prisma.chatMessage.count({
        where: {
          roomId: access.room.id,
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
    '/chat-rooms/:roomId/read',
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      const access = await ensureChatRoomContentAccess({
        roomId,
        userId,
        roles,
        projectIds,
      });
      if (!access.ok) {
        return reply
          .status(access.reason === 'not_found' ? 404 : 403)
          .send({ error: access.reason });
      }
      const now = new Date();
      const updated = await prisma.chatReadState.upsert({
        where: { roomId_userId: { roomId: access.room.id, userId } },
        update: { lastReadAt: now },
        create: {
          roomId: access.room.id,
          userId,
          lastReadAt: now,
        },
        select: { lastReadAt: true },
      });
      return { lastReadAt: updated.lastReadAt.toISOString() };
    },
  );

  app.get(
    '/chat-rooms/:roomId/messages',
    { preHandler: requireRole(chatRoles) },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const { limit, before, tag } = req.query as {
        limit?: string;
        before?: string;
        tag?: string;
      };
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      const access = await ensureChatRoomContentAccess({
        roomId,
        userId,
        roles,
        projectIds,
      });
      if (!access.ok) {
        return reply
          .status(access.reason === 'not_found' ? 404 : 403)
          .send({ error: access.reason });
      }

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
    '/chat-rooms/:roomId/messages',
    { preHandler: requireRole(chatRoles), schema: projectChatMessageSchema },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const body = req.body as {
        body: string;
        tags?: string[];
        mentions?: unknown;
      };
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      const access = await ensureChatRoomContentAccess({
        roomId,
        userId,
        roles,
        projectIds,
      });
      if (!access.ok) {
        return reply
          .status(access.reason === 'not_found' ? 404 : 403)
          .send({ error: access.reason });
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

      return message;
    },
  );

  app.post(
    '/chat-rooms/:roomId/ack-requests',
    { preHandler: requireRole(chatRoles), schema: projectChatAckRequestSchema },
    async (req, reply) => {
      const { roomId } = req.params as { roomId: string };
      const body = req.body as {
        body: string;
        requiredUserIds: string[];
        dueAt?: string;
        tags?: string[];
        mentions?: unknown;
      };
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(400).send({
          error: { code: 'MISSING_USER_ID', message: 'user id is required' },
        });
      }
      const roles = req.user?.roles || [];
      const projectIds = req.user?.projectIds || [];
      const access = await ensureChatRoomContentAccess({
        roomId,
        userId,
        roles,
        projectIds,
      });
      if (!access.ok) {
        return reply
          .status(access.reason === 'not_found' ? 404 : 403)
          .send({ error: access.reason });
      }

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
          ackRequest: {
            create: {
              roomId: access.room.id,
              requiredUserIds,
              dueAt: dueAt ?? undefined,
              createdBy: userId,
            },
          },
        },
        include: { ackRequest: { include: { acks: true } } },
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

      return message;
    },
  );
}
