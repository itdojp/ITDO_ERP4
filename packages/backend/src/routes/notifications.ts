import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { Type } from '@sinclair/typebox';
import { prisma } from '../services/db.js';
import {
  evaluateChatRoomContentAccess,
  type ChatRoomAccessRoom,
} from '../services/chatRoomAccess.js';
import {
  CHAT_MESSAGE_NOTIFICATION_KINDS,
  CHAT_ROOM_NOTIFICATION_KINDS,
  isChatNotificationKind,
  resolveChatNotificationPayloadRoomId,
  resolveChatRoomProjectId,
} from '../services/chatNotificationVisibility.js';
import { requireRole } from '../services/rbac.js';
import { parseDateParam } from '../utils/date.js';
import { notificationPreferencePatchSchema } from './validators.js';

const chatRoomAccessSelect = {
  id: true,
  type: true,
  projectId: true,
  isOfficial: true,
  groupId: true,
  viewerGroupIds: true,
  posterGroupIds: true,
  deletedAt: true,
  allowExternalUsers: true,
} satisfies Prisma.ChatRoomSelect;

const notificationListInclude = {
  project: {
    select: {
      id: true,
      code: true,
      name: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.AppNotificationInclude;

type NotificationListItem = Prisma.AppNotificationGetPayload<{
  include: typeof notificationListInclude;
}>;

type NotificationViewer = {
  userId: string;
  roles: string[];
  projectIds: string[];
  groupIds: string[];
  groupAccountIds: string[];
};

type NotificationListClient = Pick<
  Prisma.TransactionClient,
  'chatMessage' | 'chatRoom' | 'chatRoomMember'
>;

function normalizeReferenceId(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function serializeProject(project: NotificationListItem['project']) {
  if (!project) return null;
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    deletedAt: project.deletedAt,
  };
}

function payloadRecord(value: Prisma.JsonValue) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, Prisma.JsonValue>;
}

function payloadString(
  payload: Record<string, Prisma.JsonValue>,
  key: string,
  maxLength: number,
) {
  const value = payload[key];
  return typeof value === 'string' && value.length <= maxLength
    ? value
    : undefined;
}

function payloadStringList(
  payload: Record<string, Prisma.JsonValue>,
  key: string,
  maxItems: number,
  maxItemLength: number,
) {
  const value = payload[key];
  if (!Array.isArray(value) || value.length > maxItems) return undefined;
  if (
    value.some(
      (item) => typeof item !== 'string' || item.length > maxItemLength,
    )
  ) {
    return undefined;
  }
  return value as string[];
}

function serializeChatNotificationPayload(
  kind: string,
  value: Prisma.JsonValue,
) {
  const payload = payloadRecord(value);
  if (!payload) return null;

  if (kind === 'chat_room_acl_mismatch') {
    return {
      roomId: payloadString(payload, 'roomId', 200),
      roomType: payloadString(payload, 'roomType', 50),
      roomName: payloadString(payload, 'roomName', 500),
      viewerGroupIds: payloadStringList(payload, 'viewerGroupIds', 200, 200),
      posterGroupIds: payloadStringList(payload, 'posterGroupIds', 200, 200),
      mismatchGroupIds: payloadStringList(
        payload,
        'mismatchGroupIds',
        200,
        200,
      ),
    };
  }

  const common = {
    fromUserId: payloadString(payload, 'fromUserId', 200),
    roomId: payloadString(payload, 'roomId', 200),
    excerpt: payloadString(payload, 'excerpt', 140),
  };
  if (kind === 'chat_mention') {
    return {
      ...common,
      mentionAll:
        typeof payload.mentionAll === 'boolean'
          ? payload.mentionAll
          : undefined,
      mentionGroupIds: payloadStringList(payload, 'mentionGroupIds', 20, 200),
    };
  }
  if (kind === 'chat_ack_required' || kind === 'chat_ack_escalation') {
    const requiredCount = payload.requiredCount;
    return {
      ...common,
      dueAt: payloadString(payload, 'dueAt', 100),
      requiredCount:
        typeof requiredCount === 'number' &&
        Number.isSafeInteger(requiredCount) &&
        requiredCount >= 0
          ? requiredCount
          : undefined,
      escalation:
        typeof payload.escalation === 'boolean'
          ? payload.escalation
          : undefined,
    };
  }
  return common;
}

function serializeNotification(
  item: NotificationListItem,
  options?: { redactChatReference?: boolean },
) {
  const redact = options?.redactChatReference === true;
  return {
    id: item.id,
    userId: item.userId,
    kind: item.kind,
    projectId: redact ? null : item.projectId,
    messageId: redact ? null : item.messageId,
    payload: redact
      ? { redacted: true }
      : isChatNotificationKind(item.kind)
        ? serializeChatNotificationPayload(item.kind, item.payload)
        : item.payload,
    readAt: item.readAt,
    createdAt: item.createdAt,
    createdBy: redact ? null : item.createdBy,
    updatedAt: item.updatedAt,
    updatedBy: redact ? null : item.updatedBy,
    project: redact ? null : serializeProject(item.project),
  };
}

function redactChatNotification(item: NotificationListItem) {
  return serializeNotification(item, { redactChatReference: true });
}

function hasConsistentProjectReference(
  item: NotificationListItem,
  room: ChatRoomAccessRoom,
) {
  const expectedProjectId = resolveChatRoomProjectId(room);
  const actualProjectId = normalizeReferenceId(item.projectId);
  if (actualProjectId !== expectedProjectId) return false;
  if (!expectedProjectId) return item.project === null;
  return (
    item.project?.id === expectedProjectId && item.project.deletedAt === null
  );
}

async function revalidateChatNotificationItems(
  items: NotificationListItem[],
  viewer: NotificationViewer,
  client: NotificationListClient,
) {
  const chatItems = items.filter((item) => isChatNotificationKind(item.kind));
  if (!chatItems.length)
    return items.map((item) => serializeNotification(item));

  const messageIds = Array.from(
    new Set(
      chatItems
        .filter((item) => CHAT_MESSAGE_NOTIFICATION_KINDS.has(item.kind))
        .map((item) => normalizeReferenceId(item.messageId))
        .filter((messageId): messageId is string => Boolean(messageId)),
    ),
  );
  const directlyReferencedRoomIds = Array.from(
    new Set(
      chatItems
        .filter((item) => CHAT_ROOM_NOTIFICATION_KINDS.has(item.kind))
        .map((item) => normalizeReferenceId(item.messageId))
        .filter((roomId): roomId is string => Boolean(roomId)),
    ),
  );
  const messages = messageIds.length
    ? await client.chatMessage.findMany({
        where: { id: { in: messageIds } },
        select: {
          id: true,
          roomId: true,
          deletedAt: true,
        },
      })
    : [];
  const roomIds = Array.from(
    new Set([
      ...directlyReferencedRoomIds,
      ...messages
        .filter((message) => !message.deletedAt)
        .map((message) => message.roomId),
    ]),
  );
  const rooms = roomIds.length
    ? await client.chatRoom.findMany({
        where: { id: { in: roomIds } },
        select: chatRoomAccessSelect,
      })
    : [];
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const activeRoomById = new Map<string, ChatRoomAccessRoom>();
  for (const room of rooms) {
    if (!room.deletedAt) activeRoomById.set(room.id, room);
  }

  const accessibleRoomIds = new Set<string>();
  const membershipRequiredRoomIds: string[] = [];
  for (const room of activeRoomById.values()) {
    const access = evaluateChatRoomContentAccess({
      room,
      userId: viewer.userId,
      roles: viewer.roles,
      projectIds: viewer.projectIds,
      groupIds: viewer.groupIds,
      groupAccountIds: viewer.groupAccountIds,
      accessLevel: 'read',
    });
    if (access.ok) {
      accessibleRoomIds.add(room.id);
    } else if (access.reason === 'membership_required') {
      membershipRequiredRoomIds.push(room.id);
    }
  }

  const membershipLookupRoomIds = Array.from(
    new Set([...membershipRequiredRoomIds, ...directlyReferencedRoomIds]),
  );
  const managedAlertRoomIds = new Set<string>();
  if (membershipLookupRoomIds.length) {
    const memberships = await client.chatRoomMember.findMany({
      where: {
        roomId: { in: membershipLookupRoomIds },
        userId: viewer.userId,
        deletedAt: null,
      },
      select: { roomId: true, role: true },
    });
    const memberRoleByRoomId = new Map(
      memberships.map((membership) => [membership.roomId, membership.role]),
    );
    for (const membership of memberships) {
      if (membership.role === 'owner' || membership.role === 'admin') {
        managedAlertRoomIds.add(membership.roomId);
      }
    }
    for (const roomId of membershipRequiredRoomIds) {
      const room = activeRoomById.get(roomId);
      const memberRole = memberRoleByRoomId.get(roomId);
      if (!room || !memberRole) continue;
      const access = evaluateChatRoomContentAccess({
        room,
        userId: viewer.userId,
        roles: viewer.roles,
        projectIds: viewer.projectIds,
        groupIds: viewer.groupIds,
        groupAccountIds: viewer.groupAccountIds,
        accessLevel: 'read',
        memberRole,
      });
      if (access.ok) accessibleRoomIds.add(room.id);
    }
  }

  return items.map((item) => {
    if (
      isChatNotificationKind(item.kind) &&
      !CHAT_MESSAGE_NOTIFICATION_KINDS.has(item.kind) &&
      !CHAT_ROOM_NOTIFICATION_KINDS.has(item.kind)
    ) {
      return redactChatNotification(item);
    }
    if (CHAT_ROOM_NOTIFICATION_KINDS.has(item.kind)) {
      const roomId = normalizeReferenceId(item.messageId);
      const room = roomId ? roomById.get(roomId) : undefined;
      if (!room || room.deletedAt || !managedAlertRoomIds.has(room.id)) {
        return redactChatNotification(item);
      }
      const payloadRoomId = resolveChatNotificationPayloadRoomId(item.payload);
      return (payloadRoomId && payloadRoomId !== room.id) ||
        !hasConsistentProjectReference(item, room)
        ? redactChatNotification(item)
        : serializeNotification(item);
    }
    if (!CHAT_MESSAGE_NOTIFICATION_KINDS.has(item.kind)) {
      return serializeNotification(item);
    }
    const messageId = normalizeReferenceId(item.messageId);
    const message = messageId ? messageById.get(messageId) : undefined;
    const room = message ? roomById.get(message.roomId) : undefined;
    if (
      !message ||
      message.deletedAt ||
      !room ||
      room.deletedAt ||
      !accessibleRoomIds.has(message.roomId) ||
      !hasConsistentProjectReference(item, room)
    ) {
      return redactChatNotification(item);
    }
    const payloadRoomId = resolveChatNotificationPayloadRoomId(item.payload);
    if (payloadRoomId && payloadRoomId !== message.roomId) {
      return redactChatNotification(item);
    }
    return serializeNotification(item);
  });
}

const nullableString = Type.Union([Type.String(), Type.Null()]);
const nullableDateTime = Type.Union([
  Type.String({ format: 'date-time' }),
  Type.Null(),
]);
const notificationListResponseSchema = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          userId: Type.String(),
          kind: Type.String(),
          projectId: nullableString,
          messageId: nullableString,
          payload: Type.Union([Type.Unknown(), Type.Null()]),
          readAt: nullableDateTime,
          createdAt: Type.String({ format: 'date-time' }),
          createdBy: nullableString,
          updatedAt: Type.String({ format: 'date-time' }),
          updatedBy: nullableString,
          project: Type.Union([
            Type.Object(
              {
                id: Type.String(),
                code: Type.String(),
                name: Type.String(),
                deletedAt: nullableDateTime,
              },
              { additionalProperties: false },
            ),
            Type.Null(),
          ]),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
const notificationErrorResponseSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.String(),
        message: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

function parseLimit(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 200);
}

function parseUnreadFlag(value: unknown) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  return Boolean(value);
}

export async function registerNotificationRoutes(app: FastifyInstance) {
  const allowedRoles = ['admin', 'mgmt', 'exec', 'user', 'hr', 'external_chat'];

  app.get(
    '/notifications/unread-count',
    { preHandler: requireRole(allowedRoles) },
    async (req, reply) => {
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'unauthorized' },
        });
      }
      const unreadCount = await prisma.appNotification.count({
        where: { userId, readAt: null },
      });
      return { unreadCount };
    },
  );

  app.get(
    '/notifications',
    {
      schema: {
        response: {
          200: notificationListResponseSchema,
          401: notificationErrorResponseSchema,
        },
      },
      preHandler: requireRole(allowedRoles),
    },
    async (req, reply) => {
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'unauthorized' },
        });
      }
      const query = (req.query || {}) as {
        unread?: string;
        limit?: string;
      };
      const unreadOnly = parseUnreadFlag(query.unread);
      const take = parseLimit(query.limit, 50);
      const items = await prisma.$transaction(
        async (transaction) => {
          const page = await transaction.appNotification.findMany({
            where: {
              userId,
              ...(unreadOnly ? { readAt: null } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take,
            include: notificationListInclude,
          });
          return revalidateChatNotificationItems(
            page,
            {
              userId,
              roles: req.user?.roles ?? [],
              projectIds: req.user?.projectIds ?? [],
              groupIds: req.user?.groupIds ?? [],
              groupAccountIds: req.user?.groupAccountIds ?? [],
            },
            transaction,
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return { items };
    },
  );

  app.post(
    '/notifications/:id/read',
    { preHandler: requireRole(allowedRoles) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'unauthorized' },
        });
      }
      const current = await prisma.appNotification.findUnique({
        where: { id },
        select: { id: true, userId: true, readAt: true },
      });
      if (!current) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'not_found' },
        });
      }
      if (current.userId !== userId) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'forbidden' },
        });
      }
      if (current.readAt) {
        return { ok: true, readAt: current.readAt.toISOString() };
      }
      const updated = await prisma.appNotification.update({
        where: { id },
        data: { readAt: new Date(), updatedBy: userId },
        select: { readAt: true },
      });
      return { ok: true, readAt: updated.readAt?.toISOString() ?? null };
    },
  );

  app.get(
    '/notification-preferences',
    { preHandler: requireRole(allowedRoles) },
    async (req, reply) => {
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'unauthorized' },
        });
      }
      const pref = await prisma.userNotificationPreference.findUnique({
        where: { userId },
        select: {
          userId: true,
          emailMode: true,
          emailDigestIntervalMinutes: true,
          muteAllUntil: true,
        },
      });
      if (pref) {
        return {
          ...pref,
          muteAllUntil: pref.muteAllUntil
            ? pref.muteAllUntil.toISOString()
            : null,
        };
      }
      return {
        userId,
        emailMode: 'digest',
        emailDigestIntervalMinutes: 10,
        muteAllUntil: null,
      };
    },
  );

  app.patch(
    '/notification-preferences',
    {
      preHandler: requireRole(allowedRoles),
      schema: notificationPreferencePatchSchema,
    },
    async (req, reply) => {
      const userId = req.user?.userId;
      if (!userId) {
        return reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'unauthorized' },
        });
      }
      const body = req.body as {
        emailMode?: 'realtime' | 'digest';
        emailDigestIntervalMinutes?: number;
        muteAllUntil?: string | null;
      };

      if (
        body.emailMode === undefined &&
        body.emailDigestIntervalMinutes === undefined &&
        body.muteAllUntil === undefined
      ) {
        const current = await prisma.userNotificationPreference.findUnique({
          where: { userId },
          select: {
            userId: true,
            emailMode: true,
            emailDigestIntervalMinutes: true,
            muteAllUntil: true,
          },
        });
        return current
          ? {
              ...current,
              muteAllUntil: current.muteAllUntil
                ? current.muteAllUntil.toISOString()
                : null,
            }
          : {
              userId,
              emailMode: 'digest',
              emailDigestIntervalMinutes: 10,
              muteAllUntil: null,
            };
      }

      const update: Prisma.UserNotificationPreferenceUpdateInput = {
        updatedBy: userId,
      };
      const create: Prisma.UserNotificationPreferenceCreateInput = {
        userId,
        emailMode: 'digest',
        emailDigestIntervalMinutes: 10,
        createdBy: userId,
        updatedBy: userId,
      };

      if (body.emailMode !== undefined) {
        update.emailMode = body.emailMode;
        create.emailMode = body.emailMode;
      }
      if (body.emailDigestIntervalMinutes !== undefined) {
        update.emailDigestIntervalMinutes = body.emailDigestIntervalMinutes;
        create.emailDigestIntervalMinutes = body.emailDigestIntervalMinutes;
      }
      if (body.muteAllUntil !== undefined) {
        if (body.muteAllUntil === null) {
          update.muteAllUntil = null;
          create.muteAllUntil = null;
        } else {
          const parsed =
            typeof body.muteAllUntil === 'string'
              ? parseDateParam(body.muteAllUntil)
              : null;
          if (!parsed) {
            return reply.status(400).send({
              error: { code: 'INVALID_DATE', message: 'Invalid muteAllUntil' },
            });
          }
          update.muteAllUntil = parsed;
          create.muteAllUntil = parsed;
        }
      }

      const updated = await prisma.userNotificationPreference.upsert({
        where: { userId },
        update,
        create,
        select: {
          userId: true,
          emailMode: true,
          emailDigestIntervalMinutes: true,
          muteAllUntil: true,
        },
      });
      return {
        ...updated,
        muteAllUntil: updated.muteAllUntil
          ? updated.muteAllUntil.toISOString()
          : null,
      };
    },
  );
}
