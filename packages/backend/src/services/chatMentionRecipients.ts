import { prisma } from './db.js';
import { resolveChatAckRequiredRecipientUserIds } from './chatAckRecipients.js';

type RoomForMention = {
  id: string;
  type: string;
  groupId: string | null;
  allowExternalUsers: boolean;
};

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function resolveRoomAudienceUserIds(options: {
  room: RoomForMention;
  client?: typeof prisma;
}) {
  const client = options.client ?? prisma;
  const room = options.room;
  const audience = new Set<string>();

  if (room.type === 'private_group' || room.type === 'dm') {
    const members = await client.chatRoomMember.findMany({
      where: { roomId: room.id, deletedAt: null },
      select: { userId: true },
    });
    members.forEach((member) => {
      const userId = normalizeId(member?.userId);
      if (userId) audience.add(userId);
    });
    return audience;
  }

  if (room.type === 'department') {
    const groupId = normalizeId(room.groupId);
    if (groupId) {
      const members = await resolveChatAckRequiredRecipientUserIds({
        requiredUserIds: [],
        requiredGroupIds: [groupId],
        client,
      });
      members.forEach((userId) => audience.add(userId));
    }
  }

  if (room.type === 'company') {
    const members = await resolveChatAckRequiredRecipientUserIds({
      requiredUserIds: [],
      requiredRoles: ['admin', 'mgmt', 'exec', 'user', 'hr'],
      client,
    });
    members.forEach((userId) => audience.add(userId));
  }

  if (room.allowExternalUsers) {
    const externalMembers = await client.chatRoomMember.findMany({
      where: { roomId: room.id, deletedAt: null },
      select: { userId: true },
    });
    externalMembers.forEach((member) => {
      const userId = normalizeId(member?.userId);
      if (userId) audience.add(userId);
    });
  }

  return audience;
}

export async function expandRoomMentionRecipients(options: {
  room: RoomForMention;
  mentionUserIds: string[];
  mentionGroupIds: string[];
  mentionsAll: boolean;
  client?: typeof prisma;
}) {
  const mentionSet = new Set(
    options.mentionUserIds.map((userId) => normalizeId(userId)).filter(Boolean),
  );

  if (
    options.room.type !== 'project' &&
    (options.mentionsAll || options.mentionGroupIds.length > 0)
  ) {
    const audience = await resolveRoomAudienceUserIds({
      room: options.room,
      client: options.client,
    });

    if (options.mentionGroupIds.length > 0) {
      const members = await resolveChatAckRequiredRecipientUserIds({
        requiredUserIds: [],
        requiredGroupIds: options.mentionGroupIds,
        client: options.client,
      });
      members.forEach((userId) => {
        if (audience.has(userId)) {
          mentionSet.add(userId);
        }
      });
    }

    if (options.mentionsAll) {
      audience.forEach((userId) => mentionSet.add(userId));
    }
  }

  return Array.from(mentionSet);
}
