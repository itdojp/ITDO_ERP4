import crypto from 'node:crypto';

import { prisma } from './db.js';

const DEFAULT_GA_GROUP_SELECTOR = 'general_affairs';

function resolveGeneralAffairsGroupSelector() {
  const raw = (process.env.CHAT_PERSONAL_GA_GROUP_ID || '').trim();
  return raw || DEFAULT_GA_GROUP_SELECTOR;
}

export function buildPersonalGeneralAffairsRoomId(userId: string) {
  const normalized = userId.trim();
  const digest = crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex')
    .slice(0, 32);
  return `pga_${digest}`;
}

export function buildPersonalGeneralAffairsRoomName(options: {
  userId: string;
  displayName?: string | null;
}) {
  const userId = options.userId.trim();
  const displayName =
    typeof options.displayName === 'string' ? options.displayName.trim() : '';
  const label =
    displayName && displayName !== userId
      ? `${displayName} (${userId})`
      : userId;
  return `総務連絡:${label}`;
}

export async function ensurePersonalGeneralAffairsChatRoom(options: {
  userId: string;
  displayName?: string | null;
  createdBy?: string | null;
  client?: any;
}) {
  const client = options.client ?? prisma;
  const userId = options.userId.trim();
  if (!userId) {
    throw new Error('userId is required');
  }

  const groupSelector = resolveGeneralAffairsGroupSelector();
  const roomId = buildPersonalGeneralAffairsRoomId(userId);
  const name = buildPersonalGeneralAffairsRoomName({
    userId,
    displayName: options.displayName,
  });
  const actor = (options.createdBy ?? userId).trim() || null;

  const room = await client.chatRoom.upsert({
    where: { id: roomId },
    create: {
      id: roomId,
      type: 'private_group',
      name,
      isOfficial: true,
      viewerGroupIds: [groupSelector],
      posterGroupIds: [groupSelector],
      allowExternalUsers: false,
      allowExternalIntegrations: false,
      createdBy: actor,
      updatedBy: actor,
    },
    update: {
      type: 'private_group',
      name,
      isOfficial: true,
      viewerGroupIds: [groupSelector],
      posterGroupIds: [groupSelector],
      allowExternalUsers: false,
      allowExternalIntegrations: false,
      deletedAt: null,
      deletedReason: null,
      updatedBy: actor,
    },
    select: { id: true },
  });

  await client.chatRoomMember.upsert({
    where: { roomId_userId: { roomId: room.id, userId } },
    create: {
      roomId: room.id,
      userId,
      role: 'owner',
      createdBy: actor,
      updatedBy: actor,
    },
    update: {
      role: 'owner',
      deletedAt: null,
      deletedReason: null,
      updatedBy: actor,
    },
  });

  return { roomId: room.id };
}
