import { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
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
import {
  expandRoomMentionRecipients,
  resolveRoomAudienceUserIds,
} from '../services/chatMentionRecipients.js';
import { resolveGroupCandidatesBySelector } from '../services/groupCandidates.js';
import {
  getChatExternalLlmConfig,
  getChatExternalLlmRateLimit,
  summarizeWithExternalLlm,
} from '../services/chatExternalLlm.js';
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

export async function registerChatRoomRoutes(app: FastifyInstance) {
  const chatRoles = CHAT_ROLES;
  const chatSettingId = 'default';
  const companyRoomId = 'company';
  const companyRoomName = '全社';

  type DepartmentRoomTarget = {
    roomId: string;
    groupId: string;
    displayName: string;
  };

  function buildDepartmentRoomId(groupId: string) {
    const digest = crypto
      .createHash('sha256')
      .update(groupId.trim())
      .digest('hex')
      .slice(0, 32);
    return `dept_${digest}`;
  }

  async function resolveDepartmentGroupAccounts(options: {
    groupIds: string[];
    groupAccountIds: string[];
  }) {
    if (!options.groupIds.length && !options.groupAccountIds.length) {
      return [];
    }
    const conditions: Prisma.GroupAccountWhereInput[] = [];
    if (options.groupAccountIds.length > 0) {
      conditions.push({ id: { in: options.groupAccountIds } });
    }
    if (options.groupIds.length > 0) {
      conditions.push({ displayName: { in: options.groupIds } });
    }
    const rows = await prisma.groupAccount.findMany({
      where: {
        active: true,
        OR: conditions,
      },
      select: { id: true, displayName: true },
    });
    const byId = new Map<string, { id: string; displayName: string }>();
    for (const row of rows) {
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      const name =
        typeof row.displayName === 'string' ? row.displayName.trim() : '';
      if (!id || !name) continue;
      if (!byId.has(id)) {
        byId.set(id, { id, displayName: name });
      }
    }
    return Array.from(byId.values());
  }

  async function ensureCompanyRoom(userId: string | null) {
    const existing = await prisma.chatRoom.findUnique({
      where: { id: companyRoomId },
      select: { id: true, deletedAt: true },
    });
    if (existing) return;

    try {
      await prisma.chatRoom.create({
        data: {
          id: companyRoomId,
          type: 'company',
          name: companyRoomName,
          isOfficial: true,
          allowExternalUsers: false,
          allowExternalIntegrations: false,
          createdBy: userId,
          updatedBy: userId,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return;
      }
      throw err;
    }
  }

  async function ensureDepartmentRooms(
    userId: string | null,
    targets: DepartmentRoomTarget[],
  ) {
    if (!targets.length) return;
    const targetGroupIds = targets.map((target) => target.groupId);
    const targetDisplayNames = targets.map((target) => target.displayName);
    const existing = await prisma.chatRoom.findMany({
      where: {
        type: 'department',
        deletedAt: null,
        OR: [
          { groupId: { in: targetGroupIds } },
          // Migration fallback: legacy rooms stored displayName in groupId.
          { groupId: { in: targetDisplayNames } },
        ],
      },
      select: { id: true, groupId: true, name: true },
    });
    const existingByGroupId = new Map<string, (typeof existing)[number]>();
    const existingIds = new Set<string>();
    for (const room of existing) {
      if (typeof room.groupId === 'string') {
        existingByGroupId.set(room.groupId, room);
      }
      existingIds.add(room.id);
    }

    const updates: Promise<unknown>[] = [];
    const createData: Prisma.ChatRoomCreateManyInput[] = [];
    for (const target of targets) {
      const matched =
        existingByGroupId.get(target.groupId) ||
        existingByGroupId.get(target.displayName);
      if (matched) {
        if (
          matched.groupId !== target.groupId ||
          matched.name !== target.displayName
        ) {
          // Migration: keep the existing roomId, but normalize groupId/name to the latest target.
          updates.push(
            prisma.chatRoom.update({
              where: { id: matched.id },
              data: {
                groupId: target.groupId,
                name: target.displayName,
                updatedBy: userId,
              },
            }),
          );
        }
        continue;
      }
      if (existingIds.has(target.roomId)) continue;
      createData.push({
        id: target.roomId,
        type: 'department',
        name: target.displayName,
        groupId: target.groupId,
        isOfficial: true,
        allowExternalUsers: false,
        allowExternalIntegrations: false,
        createdBy: userId,
        updatedBy: userId,
      });
    }

    if (updates.length) {
      await Promise.all(updates);
    }
    if (createData.length) {
      await prisma.chatRoom.createMany({
        data: createData,
        skipDuplicates: true,
      });
    }
  }

  function normalizeGroupIdList(value: unknown, max = 200) {
    return normalizeStringArray(value, { dedupe: true, max });
  }

  function normalizeSortedUnique(values: string[]) {
    return Array.from(
      new Set(values.map((value) => value.trim()).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));
  }

  function areSameStringSet(a: string[], b: string[]) {
    const left = normalizeSortedUnique(a);
    const right = normalizeSortedUnique(b);
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  }

  async function resolveGroupAccountIdsBySelector(selectors: string[]) {
    const normalized = normalizeGroupIdList(selectors);
    if (!normalized.length) {
      return { ids: [] as string[], unresolved: [] as string[] };
    }
    const rows = await prisma.groupAccount.findMany({
      where: {
        active: true,
        OR: [{ id: { in: normalized } }, { displayName: { in: normalized } }],
      },
      select: { id: true, displayName: true },
    });
    const selectorMap = new Map<string, string>();
    for (const row of rows) {
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      const name =
        typeof row.displayName === 'string' ? row.displayName.trim() : '';
      if (id) selectorMap.set(id, id);
      // Prefer earlier mappings (typically exact id) over displayName matches.
      if (name && !selectorMap.has(name)) selectorMap.set(name, id);
    }
    const ids = new Set<string>();
    const unresolved: string[] = [];
    for (const selector of normalized) {
      const id = selectorMap.get(selector);
      if (id) {
        ids.add(id);
      } else {
        unresolved.push(selector);
      }
    }
    return { ids: Array.from(ids), unresolved };
  }

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
      if (!hasViewerAccess(room.viewerGroupIds)) return;
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
      const roles = req.user?.roles || [];
      const userId = req.user?.userId;
      const projectIds = req.user?.projectIds || [];
      const rawGroupIds = Array.isArray(req.user?.groupIds)
        ? req.user.groupIds
        : [];
      const groupIds = normalizeStringArray(rawGroupIds, {
        dedupe: true,
        max: 50,
      });
      const groupAccountIds = normalizeStringArray(req.user?.groupAccountIds, {
        dedupe: true,
        max: 50,
      });
      const groupIdSet = new Set([...groupIds, ...groupAccountIds]);
      const hasViewerAccess = (room: { viewerGroupIds?: unknown }) => {
        const viewerGroupIds = normalizeStringArray(room.viewerGroupIds);
        return (
          viewerGroupIds.length === 0 ||
          viewerGroupIds.some((groupId) => groupIdSet.has(groupId))
        );
      };
      const canSeeAllMeta =
        roles.includes('admin') ||
        roles.includes('mgmt') ||
        roles.includes('exec');
      const canBootstrapOfficialRooms = true;
      const resolvedDepartmentGroups = await resolveDepartmentGroupAccounts({
        groupIds,
        groupAccountIds,
      });
      const resolvedDisplayNameSet = new Set(
        resolvedDepartmentGroups.map((group) => group.displayName),
      );
      const departmentTargets: DepartmentRoomTarget[] = [];
      const seenDepartmentGroupIds = new Set<string>();
      for (const group of resolvedDepartmentGroups) {
        if (seenDepartmentGroupIds.has(group.id)) continue;
        seenDepartmentGroupIds.add(group.id);
        departmentTargets.push({
          groupId: group.id,
          displayName: group.displayName,
          roomId: buildDepartmentRoomId(group.id),
        });
      }
      for (const groupId of groupIds) {
        if (resolvedDisplayNameSet.has(groupId)) continue;
        if (seenDepartmentGroupIds.has(groupId)) continue;
        seenDepartmentGroupIds.add(groupId);
        departmentTargets.push({
          // Legacy fallback: when JWT groupIds are displayName-only, keep using displayName
          // as groupId until GroupAccount resolution catches up.
          groupId,
          displayName: groupId,
          roomId: buildDepartmentRoomId(groupId),
        });
      }
      const departmentGroupIds = departmentTargets.map(
        (target) => target.groupId,
      );

      const canSeeAllProjects = canSeeAllMeta;
      const invitedProjectIds =
        !canSeeAllProjects && userId
          ? Array.from(
              new Set(
                (
                  await prisma.chatRoomMember.findMany({
                    where: {
                      userId,
                      deletedAt: null,
                      room: {
                        deletedAt: null,
                        type: 'project',
                        allowExternalUsers: true,
                      },
                    },
                    take: 200,
                    select: { roomId: true },
                  })
                )
                  .map((row) => row.roomId)
                  .filter(Boolean),
              ),
            )
          : [];

      const effectiveProjectIds = canSeeAllProjects
        ? []
        : Array.from(new Set([...projectIds, ...invitedProjectIds]));

      const projects =
        canSeeAllProjects || effectiveProjectIds.length > 0
          ? await prisma.project.findMany({
              where: canSeeAllProjects
                ? { deletedAt: null }
                : { id: { in: effectiveProjectIds }, deletedAt: null },
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

      if (canBootstrapOfficialRooms) {
        await ensureCompanyRoom(userId || null);
        await ensureDepartmentRooms(userId || null, departmentTargets);
      }

      const roomSelect = {
        id: true,
        type: true,
        name: true,
        isOfficial: true,
        projectId: true,
        groupId: true,
        viewerGroupIds: true,
        posterGroupIds: true,
        allowExternalUsers: true,
        allowExternalIntegrations: true,
        createdAt: true,
        createdBy: true,
        updatedAt: true,
        updatedBy: true,
      } as const;

      const projectRoomsPromise =
        targetProjectIds.length > 0
          ? prisma.chatRoom.findMany({
              where: {
                type: 'project',
                projectId: { in: targetProjectIds },
                deletedAt: null,
              },
              orderBy: { createdAt: 'desc' },
              select: roomSelect,
            })
          : Promise.resolve([]);

      const metaRoomsPromise = canSeeAllMeta
        ? prisma.chatRoom.findMany({
            where: { type: { not: 'project' }, deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 200,
            select: roomSelect,
          })
        : Promise.resolve([]);

      const memberRoomsPromise =
        !canSeeAllMeta && userId
          ? prisma.chatRoomMember
              .findMany({
                where: {
                  userId,
                  deletedAt: null,
                  room: {
                    deletedAt: null,
                    type: { not: 'project' },
                  },
                },
                orderBy: { createdAt: 'desc' },
                take: 200,
                select: { room: { select: roomSelect } },
              })
              .then((rows) => rows.map((row) => row.room))
          : Promise.resolve([]);

      const officialRoomsPromise =
        !canSeeAllMeta && canBootstrapOfficialRooms
          ? prisma.chatRoom.findMany({
              where: {
                deletedAt: null,
                OR: (() => {
                  const conditions: Prisma.ChatRoomWhereInput[] = [
                    { id: companyRoomId },
                  ];
                  if (departmentGroupIds.length > 0) {
                    conditions.push({
                      type: 'department',
                      groupId: { in: departmentGroupIds },
                    });
                  }
                  return conditions;
                })(),
              },
              orderBy: { createdAt: 'desc' },
              select: roomSelect,
            })
          : Promise.resolve([]);

      const [projectRooms, metaRooms, memberRooms, officialRooms] =
        await Promise.all([
          projectRoomsPromise,
          metaRoomsPromise,
          memberRoomsPromise,
          officialRoomsPromise,
        ]);

      const filteredProjectRooms = projectRooms.filter(hasViewerAccess);
      const filteredMetaRooms = metaRooms.filter(hasViewerAccess);
      const filteredMemberRooms = memberRooms.filter(hasViewerAccess);
      const filteredOfficialRooms = officialRooms.filter(hasViewerAccess);

      const otherRoomsRaw = canSeeAllMeta
        ? filteredMetaRooms
        : [...filteredMemberRooms, ...filteredOfficialRooms];

      const otherRooms = (() => {
        if (otherRoomsRaw.length <= 1) return otherRoomsRaw;
        const seen = new Set<string>();
        const merged: typeof otherRoomsRaw = [];
        for (const room of otherRoomsRaw) {
          if (seen.has(room.id)) continue;
          seen.add(room.id);
          merged.push(room);
        }
        merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return merged;
      })();

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
        ...filteredProjectRooms.map((room) => {
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
        ...otherRooms.map((room) => {
          const deptGroupId =
            typeof room.groupId === 'string' ? room.groupId.trim() : '';
          const implicitAccess =
            room.type === 'company'
              ? canBootstrapOfficialRooms
              : room.type === 'department'
                ? deptGroupId !== '' && groupIdSet.has(deptGroupId)
                : false;
          const isMember = canSeeAllMeta
            ? implicitAccess || memberRoleByRoom.has(room.id)
            : true;
          return {
            id: room.id,
            type: room.type,
            name: room.name,
            isOfficial: room.isOfficial,
            isMember,
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
          };
        }),
      ];

      return { items };
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

      const room = await prisma.chatRoom.findUnique({
        where: { id: roomId },
        select: {
          id: true,
          type: true,
          name: true,
          isOfficial: true,
          allowExternalUsers: true,
          allowExternalIntegrations: true,
          viewerGroupIds: true,
          posterGroupIds: true,
          deletedAt: true,
        },
      });
      if (!room || room.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Room not found' },
        });
      }
      if (room.type === 'dm') {
        return reply.status(400).send({
          error: { code: 'INVALID_ROOM_TYPE', message: 'dm cannot be updated' },
        });
      }

      const update: Prisma.ChatRoomUpdateInput = { updatedBy: userId };
      const changes: Record<string, { from: unknown; to: unknown }> = {};

      if (body.name !== undefined) {
        const nextName = typeof body.name === 'string' ? body.name.trim() : '';
        if (!nextName) {
          return reply.status(400).send({
            error: { code: 'INVALID_NAME', message: 'name is required' },
          });
        }
        if (!room.isOfficial) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_ROOM',
              message: 'non-official room name cannot be updated by this API',
            },
          });
        }
        if (room.type === 'project') {
          return reply.status(400).send({
            error: {
              code: 'INVALID_ROOM_TYPE',
              message: 'project room name cannot be updated',
            },
          });
        }
        if (nextName !== room.name) {
          update.name = nextName;
          changes.name = { from: room.name, to: nextName };
        }
      }

      if (body.allowExternalUsers !== undefined) {
        if (body.allowExternalUsers && !room.isOfficial) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_ROOM',
              message:
                'allowExternalUsers can be enabled only for official rooms',
            },
          });
        }
        if (body.allowExternalUsers !== room.allowExternalUsers) {
          update.allowExternalUsers = body.allowExternalUsers;
          changes.allowExternalUsers = {
            from: room.allowExternalUsers,
            to: body.allowExternalUsers,
          };
        }
      }

      if (body.allowExternalIntegrations !== undefined) {
        if (body.allowExternalIntegrations && !room.isOfficial) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_ROOM',
              message:
                'allowExternalIntegrations can be enabled only for official rooms',
            },
          });
        }
        if (body.allowExternalIntegrations !== room.allowExternalIntegrations) {
          update.allowExternalIntegrations = body.allowExternalIntegrations;
          changes.allowExternalIntegrations = {
            from: room.allowExternalIntegrations,
            to: body.allowExternalIntegrations,
          };
        }
      }

      if (body.viewerGroupIds !== undefined) {
        const requested = normalizeGroupIdList(body.viewerGroupIds);
        const { ids, unresolved } =
          await resolveGroupAccountIdsBySelector(requested);
        if (unresolved.length > 0) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_GROUP_IDS',
              message: 'viewerGroupIds contains unknown group ids',
              details: { groupIds: unresolved },
            },
          });
        }
        const current = normalizeGroupIdList(room.viewerGroupIds);
        if (!areSameStringSet(current, ids)) {
          update.viewerGroupIds = ids.length ? ids : Prisma.DbNull;
          changes.viewerGroupIds = { from: current, to: ids };
        }
      }

      if (body.posterGroupIds !== undefined) {
        const requested = normalizeGroupIdList(body.posterGroupIds);
        const { ids, unresolved } =
          await resolveGroupAccountIdsBySelector(requested);
        if (unresolved.length > 0) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_GROUP_IDS',
              message: 'posterGroupIds contains unknown group ids',
              details: { groupIds: unresolved },
            },
          });
        }
        const current = normalizeGroupIdList(room.posterGroupIds);
        if (!areSameStringSet(current, ids)) {
          update.posterGroupIds = ids.length ? ids : Prisma.DbNull;
          changes.posterGroupIds = { from: current, to: ids };
        }
      }

      if (Object.keys(changes).length === 0) {
        return room;
      }

      const updated = await prisma.chatRoom.update({
        where: { id: room.id },
        data: update,
      });

      await logAudit({
        action: 'chat_room_updated',
        targetTable: 'chat_rooms',
        targetId: room.id,
        metadata: {
          roomId: room.id,
          roomType: room.type,
          changes,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return updated;
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
      const userId = requireUserId(reply, req.user?.userId);
      if (typeof userId !== 'string') return userId;
      const roles = req.user?.roles || [];
      const { roomId } = req.params as { roomId: string };
      const room = await prisma.chatRoom.findUnique({
        where: { id: roomId },
        select: { id: true, type: true, isOfficial: true, deletedAt: true },
      });
      if (!room || room.deletedAt) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Room not found' },
        });
      }
      if (room.type === 'dm') {
        return reply.status(400).send({
          error: {
            code: 'INVALID_ROOM_TYPE',
            message: 'dm cannot add members',
          },
        });
      }

      if (room.type === 'private_group') {
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
      } else {
        const canManageOfficialMembers =
          roles.includes('admin') || roles.includes('mgmt');
        if (!canManageOfficialMembers) {
          return reply.status(403).send({
            error: {
              code: 'FORBIDDEN_ROLE',
              message: 'only admin/mgmt can manage official room members',
            },
          });
        }
        if (!room.isOfficial) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_ROOM',
              message: 'only official rooms can accept admin-managed members',
            },
          });
        }
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
      if (!access) return;

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
      const groups = await resolveGroupCandidatesBySelector([
        ...accessContext.groupIds,
        ...accessContext.groupAccountIds,
      ]);
      const allowAll = true;
      return { users, groups, allowAll };
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
      if (!access) return;
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
      if (!access) return;
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
      if (!access) return;
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
        accessLevel: 'post',
      });
      if (!access) return;

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
        accessLevel: 'post',
      });
      if (!access) return;

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
      });
      if (!access) return;

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
      });
      if (!access) return;

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
      });
      if (!access) return;

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
      });
      if (!access) return;

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
      if (!access) return;

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
      if (!access) return;

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
