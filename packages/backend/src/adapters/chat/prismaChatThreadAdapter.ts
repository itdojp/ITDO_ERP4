import { Prisma } from '@prisma/client';

import type {
  ChatRootTimelineMessage,
  ChatThreadAck,
  ChatThreadAckRequest,
  ChatThreadAttachment,
  ChatThreadMessage,
  ChatThreadRepository,
  ChatThreadSnapshotRepository,
} from '../../application/chat/chatThreadPorts.js';
import { ensureChatRoomContentAccess } from '../../services/chatRoomAccess.js';
import { prisma } from '../../services/db.js';

const messageSelect = {
  id: true,
  roomId: true,
  messageType: true,
  parentMessageId: true,
  threadRootId: true,
  userId: true,
  body: true,
  tags: true,
  reactions: true,
  mentions: true,
  mentionsAll: true,
  createdAt: true,
  createdBy: true,
  updatedAt: true,
  updatedBy: true,
  deletedAt: true,
  deletedReason: true,
} satisfies Prisma.ChatMessageSelect;

const ackRequestSelect = {
  id: true,
  messageId: true,
  roomId: true,
  requiredUserIds: true,
  requestedUserIds: true,
  requestedGroupIds: true,
  requestedRoles: true,
  dueAt: true,
  remindIntervalHours: true,
  escalationAfterHours: true,
  escalationUserIds: true,
  escalationGroupIds: true,
  escalationRoles: true,
  templateId: true,
  canceledAt: true,
  canceledBy: true,
  createdAt: true,
  createdBy: true,
} satisfies Prisma.ChatAckRequestSelect;

const ackSelect = {
  id: true,
  requestId: true,
  userId: true,
  ackedAt: true,
} satisfies Prisma.ChatAckSelect;

const attachmentSelect = {
  id: true,
  messageId: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  createdBy: true,
} satisfies Prisma.ChatAttachmentSelect;

type MessageRow = Prisma.ChatMessageGetPayload<{
  select: typeof messageSelect;
}>;
type AckRequestRow = Prisma.ChatAckRequestGetPayload<{
  select: typeof ackRequestSelect;
}>;
type AckRow = Prisma.ChatAckGetPayload<{ select: typeof ackSelect }>;
type AttachmentRow = Prisma.ChatAttachmentGetPayload<{
  select: typeof attachmentSelect;
}>;

type MessageRelations = {
  ackRequest: ChatThreadAckRequest | null;
  attachments: ChatThreadAttachment[];
};

function mapAck(row: AckRow): ChatThreadAck {
  return {
    id: row.id,
    requestId: row.requestId,
    userId: row.userId,
    ackedAt: row.ackedAt,
  };
}

function mapAckRequest(
  row: AckRequestRow,
  acks: ChatThreadAck[],
): ChatThreadAckRequest {
  return {
    id: row.id,
    messageId: row.messageId,
    roomId: row.roomId,
    requiredUserIds: row.requiredUserIds,
    requestedUserIds: row.requestedUserIds,
    requestedGroupIds: row.requestedGroupIds,
    requestedRoles: row.requestedRoles,
    dueAt: row.dueAt,
    remindIntervalHours: row.remindIntervalHours,
    escalationAfterHours: row.escalationAfterHours,
    escalationUserIds: row.escalationUserIds,
    escalationGroupIds: row.escalationGroupIds,
    escalationRoles: row.escalationRoles,
    templateId: row.templateId,
    canceledAt: row.canceledAt,
    canceledBy: row.canceledBy,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    acks,
  };
}

function mapAttachment(row: AttachmentRow): ChatThreadAttachment {
  return {
    id: row.id,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

function mapMessage(
  row: MessageRow,
  relations: MessageRelations,
): ChatThreadMessage {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    roomId: row.roomId,
    messageType: row.messageType,
    parentMessageId: row.parentMessageId,
    threadRootId: row.threadRootId,
    userId: row.userId,
    body: deleted ? null : row.body,
    tags: deleted ? null : row.tags,
    reactions: deleted ? null : row.reactions,
    mentions: deleted ? null : row.mentions,
    mentionsAll: deleted ? false : row.mentionsAll,
    ackRequest: deleted ? null : relations.ackRequest,
    attachments: deleted ? [] : relations.attachments,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt,
    deletedReason: row.deletedReason,
  };
}

async function hydrateMessages(
  tx: Prisma.TransactionClient,
  rows: MessageRow[],
): Promise<ChatThreadMessage[]> {
  const visibleMessageIds = rows
    .filter((row) => row.deletedAt === null)
    .map((row) => row.id);
  if (visibleMessageIds.length === 0) {
    return rows.map((row) =>
      mapMessage(row, { ackRequest: null, attachments: [] }),
    );
  }

  // Keep relation loading explicitly batched and sequential. This makes the
  // query budget constant for a page and avoids per-message relation reads.
  const ackRequestRows = await tx.chatAckRequest.findMany({
    where: { messageId: { in: visibleMessageIds } },
    select: ackRequestSelect,
  });
  const ackRows =
    ackRequestRows.length === 0
      ? []
      : await tx.chatAck.findMany({
          where: { requestId: { in: ackRequestRows.map((row) => row.id) } },
          orderBy: [{ requestId: 'asc' }, { ackedAt: 'asc' }, { id: 'asc' }],
          select: ackSelect,
        });
  const attachmentRows = await tx.chatAttachment.findMany({
    where: { messageId: { in: visibleMessageIds }, deletedAt: null },
    orderBy: [{ messageId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: attachmentSelect,
  });

  const acksByRequest = new Map<string, ChatThreadAck[]>();
  for (const ack of ackRows) {
    const list = acksByRequest.get(ack.requestId) ?? [];
    list.push(mapAck(ack));
    acksByRequest.set(ack.requestId, list);
  }
  const ackByMessage = new Map<string, ChatThreadAckRequest>();
  for (const request of ackRequestRows) {
    ackByMessage.set(
      request.messageId,
      mapAckRequest(request, acksByRequest.get(request.id) ?? []),
    );
  }
  const attachmentsByMessage = new Map<string, ChatThreadAttachment[]>();
  for (const attachment of attachmentRows) {
    const list = attachmentsByMessage.get(attachment.messageId) ?? [];
    list.push(mapAttachment(attachment));
    attachmentsByMessage.set(attachment.messageId, list);
  }

  return rows.map((row) =>
    mapMessage(row, {
      ackRequest: ackByMessage.get(row.id) ?? null,
      attachments: attachmentsByMessage.get(row.id) ?? [],
    }),
  );
}

async function readThreadAggregates(
  tx: Prisma.TransactionClient,
  rootMessageIds: string[],
) {
  if (rootMessageIds.length === 0) {
    return new Map<string, { replyCount: number; lastReplyAt: Date | null }>();
  }
  const groups = await tx.chatMessage.groupBy({
    by: ['threadRootId'],
    where: { threadRootId: { in: rootMessageIds } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  return new Map(
    groups.flatMap((group) =>
      group.threadRootId
        ? [
            [
              group.threadRootId,
              {
                replyCount: group._count._all,
                lastReplyAt: group._max.createdAt,
              },
            ] as const,
          ]
        : [],
    ),
  );
}

function createSnapshotRepository(
  tx: Prisma.TransactionClient,
): ChatThreadSnapshotRepository {
  return {
    async resolveMessage(messageId) {
      return tx.chatMessage.findUnique({
        where: { id: messageId },
        select: {
          id: true,
          roomId: true,
          parentMessageId: true,
          threadRootId: true,
        },
      });
    },
    async canReadRoom(roomId, actor) {
      const access = await ensureChatRoomContentAccess({
        roomId,
        userId: actor.userId,
        roles: actor.roles,
        projectIds: actor.projectIds,
        groupIds: actor.groupIds,
        groupAccountIds: actor.groupAccountIds,
        accessLevel: 'read',
        client: tx as unknown as typeof prisma,
      });
      return access.ok;
    },
    async readThread(input) {
      const rootRow = await tx.chatMessage.findFirst({
        where: {
          id: input.rootMessageId,
          roomId: input.roomId,
          parentMessageId: null,
          threadRootId: null,
        },
        select: messageSelect,
      });
      if (!rootRow) return null;

      const boundaryWhere: Prisma.ChatMessageWhereInput | undefined =
        input.boundary
          ? {
              OR: [
                { createdAt: { gt: input.boundary.createdAt } },
                {
                  createdAt: input.boundary.createdAt,
                  id: { gt: input.boundary.id },
                },
              ],
            }
          : undefined;
      const replyRows = await tx.chatMessage.findMany({
        where: {
          roomId: input.roomId,
          threadRootId: input.rootMessageId,
          parentMessageId: input.rootMessageId,
          ...boundaryWhere,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: input.limit + 1,
        select: messageSelect,
      });
      const hasMore = replyRows.length > input.limit;
      const pageRows = replyRows.slice(0, input.limit);
      const [root, ...replies] = await hydrateMessages(tx, [
        rootRow,
        ...pageRows,
      ]);
      const aggregates = await readThreadAggregates(tx, [input.rootMessageId]);
      const aggregate = aggregates.get(input.rootMessageId) ?? {
        replyCount: 0,
        lastReplyAt: null,
      };
      return {
        root,
        replies,
        replyCount: aggregate.replyCount,
        lastReplyAt: aggregate.lastReplyAt,
        hasMore,
      };
    },
  };
}

export function createPrismaChatThreadRepository(
  client: typeof prisma,
): ChatThreadRepository {
  return {
    async listRootTimeline(input) {
      return client.$transaction(
        async (tx) => {
          const where: Prisma.ChatMessageWhereInput = {
            roomId: input.roomId,
            parentMessageId: null,
            threadRootId: null,
            deletedAt: null,
          };
          if (input.before) where.createdAt = { lt: input.before };
          if (input.tag) where.tags = { array_contains: [input.tag] };
          if (input.query) {
            where.body = { contains: input.query, mode: 'insensitive' };
          }
          const rows = await tx.chatMessage.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: input.limit,
            select: messageSelect,
          });
          const messages = await hydrateMessages(tx, rows);
          const aggregates = await readThreadAggregates(
            tx,
            rows.map((row) => row.id),
          );
          return messages.map((message, index): ChatRootTimelineMessage => {
            const aggregate = aggregates.get(message.id) ?? {
              replyCount: 0,
              lastReplyAt: null,
            };
            return {
              ...message,
              body: rows[index].body,
              replyCount: aggregate.replyCount,
              lastReplyAt: aggregate.lastReplyAt,
            };
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    },
    async withReadSnapshot(operation) {
      return client.$transaction(
        async (tx) => operation(createSnapshotRepository(tx)),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    },
  };
}

export const prismaChatThreadRepository =
  createPrismaChatThreadRepository(prisma);
