import crypto from 'node:crypto';

import { prisma } from './db.js';

// System-initialized GroupAccount.id (created via Prisma migration).
const GENERAL_AFFAIRS_GROUP_ACCOUNT_ID = 'general_affairs';

export function buildPersonalGeneralAffairsRoomId(userAccountId: string) {
  const normalized = userAccountId.trim();
  const digest = crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex')
    .slice(0, 32);
  return `pga_${digest}`;
}

export function buildPersonalGeneralAffairsRoomName(options: {
  userName: string;
  displayName?: string | null;
}) {
  const userName = options.userName.trim();
  const displayName =
    typeof options.displayName === 'string' ? options.displayName.trim() : '';
  const label = displayName || userName;
  return `総務連絡:${label || 'unknown'}`;
}

export async function ensurePersonalGeneralAffairsChatRoom(options: {
  userAccountId: string;
  // Internal user identifier used in ChatRoomMember/ChatMessage/etc.
  userId: string;
  // Human readable name (SCIM userName; can change).
  userName: string;
  displayName?: string | null;
  createdBy?: string | null;
  client?: any;
}) {
  const client = options.client ?? prisma;
  const userAccountId = options.userAccountId.trim();
  const userId = options.userId.trim();
  if (!userId) {
    throw new Error('userId is required');
  }
  if (!userAccountId) {
    throw new Error('userAccountId is required');
  }

  const roomId = buildPersonalGeneralAffairsRoomId(userAccountId);
  const name = buildPersonalGeneralAffairsRoomName({
    userName: options.userName,
    displayName: options.displayName,
  });
  const actor = (options.createdBy ?? userId).trim() || null;

  // Ensure the system GA group exists (db push does not execute migrations).
  await client.groupAccount.upsert({
    where: { id: GENERAL_AFFAIRS_GROUP_ACCOUNT_ID },
    create: {
      id: GENERAL_AFFAIRS_GROUP_ACCOUNT_ID,
      displayName: GENERAL_AFFAIRS_GROUP_ACCOUNT_ID,
      active: true,
      createdBy: actor,
      updatedBy: actor,
    },
    update: {
      active: true,
      updatedBy: actor,
    },
    select: { id: true },
  });

  const room = await client.chatRoom.upsert({
    where: { id: roomId },
    create: {
      id: roomId,
      type: 'private_group',
      name,
      isOfficial: true,
      viewerGroupIds: [GENERAL_AFFAIRS_GROUP_ACCOUNT_ID],
      posterGroupIds: [GENERAL_AFFAIRS_GROUP_ACCOUNT_ID],
      allowExternalUsers: false,
      allowExternalIntegrations: false,
      createdBy: actor,
      updatedBy: actor,
    },
    update: {
      type: 'private_group',
      isOfficial: true,
      // Keep the room name user-editable (do not overwrite on ensure).
      viewerGroupIds: [GENERAL_AFFAIRS_GROUP_ACCOUNT_ID],
      posterGroupIds: [GENERAL_AFFAIRS_GROUP_ACCOUNT_ID],
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

export async function deactivatePersonalGeneralAffairsChatRoomMember(options: {
  userAccountId: string;
  userId: string;
  reason?: string | null;
  updatedBy?: string | null;
  client?: any;
}) {
  const client = options.client ?? prisma;
  const userAccountId = options.userAccountId.trim();
  const userId = options.userId.trim();
  if (!userAccountId || !userId) {
    return { roomId: '', updatedCount: 0 };
  }
  const roomId = buildPersonalGeneralAffairsRoomId(userAccountId);
  const actor = (options.updatedBy ?? userId).trim() || null;
  const now = new Date();
  const updated = await client.chatRoomMember.updateMany({
    where: {
      roomId,
      userId,
      deletedAt: null,
    },
    data: {
      deletedAt: now,
      deletedReason: (options.reason ?? 'user_deactivated').trim() || null,
      updatedBy: actor,
    },
  });
  return { roomId, updatedCount: updated.count };
}
