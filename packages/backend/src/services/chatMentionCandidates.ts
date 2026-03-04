import type { PrismaClient } from '@prisma/client';
import { prisma } from './db.js';
import { resolveGroupCandidatesBySelector } from './groupCandidates.js';

type ChatMentionCandidatesClient = Pick<
  PrismaClient,
  'chatRoomMember' | 'projectMember' | 'userAccount'
>;

type MentionCandidatesRoom = {
  id: string;
  type: string;
  allowExternalUsers?: boolean | null;
};

type BuildChatMentionCandidatesInput = {
  room: MentionCandidatesRoom;
  requesterUserId?: string | null;
  groupIds?: string[];
  groupAccountIds?: string[];
  client?: ChatMentionCandidatesClient;
};

export async function buildChatMentionCandidates(
  input: BuildChatMentionCandidatesInput,
) {
  const client = input.client ?? prisma;
  const groupIds = Array.isArray(input.groupIds) ? input.groupIds : [];
  const groupAccountIds = Array.isArray(input.groupAccountIds)
    ? input.groupAccountIds
    : [];
  const requesterUserId = (input.requesterUserId || '').trim();
  const includeRoomMembers =
    input.room.type !== 'project' || Boolean(input.room.allowExternalUsers);

  const chatRoomMembers = includeRoomMembers
    ? await client.chatRoomMember.findMany({
        where: { roomId: input.room.id, deletedAt: null },
        select: { userId: true },
        orderBy: { userId: 'asc' },
      })
    : [];
  const projectMembers =
    input.room.type === 'project'
      ? await client.projectMember.findMany({
          where: { projectId: input.room.id },
          select: { userId: true },
          orderBy: { userId: 'asc' },
        })
      : [];

  const userIdSet = new Set([
    ...chatRoomMembers.map((member) => member.userId),
    ...projectMembers.map((member) => member.userId),
  ]);
  if (requesterUserId) {
    userIdSet.add(requesterUserId);
  }
  const userIds = Array.from(userIdSet);
  const accounts = userIds.length
    ? await client.userAccount.findMany({
        where: {
          deletedAt: null,
          active: true,
          OR: [{ userName: { in: userIds } }, { externalId: { in: userIds } }],
        },
        select: { userName: true, externalId: true, displayName: true },
      })
    : [];
  const displayMap = new Map<string, string | null>();
  for (const account of accounts) {
    const displayName = account.displayName || null;
    displayMap.set(account.userName, displayName);
    if (account.externalId) {
      displayMap.set(account.externalId, displayName);
    }
  }

  const users = userIds
    .map((entry) => ({
      userId: entry,
      displayName: displayMap.get(entry) || null,
    }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
  const groups = await resolveGroupCandidatesBySelector([
    ...groupIds,
    ...groupAccountIds,
  ]);
  return { users, groups, allowAll: true };
}
