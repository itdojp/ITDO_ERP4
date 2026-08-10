import { Prisma } from '@prisma/client';

import type { KnowledgeActor } from '../../application/knowledge/knowledgeItemPorts.js';
import {
  consumeSynthesisAccessBudget,
  type KnowledgeSynthesisAccessContext,
} from '../../application/knowledge/knowledgeSynthesisAccessContext.js';
import {
  ensureChatRoomContentAccess,
  hasActiveChatProject,
} from '../../services/chatRoomAccess.js';
import { prisma } from '../../services/db.js';

type ThreadPromotionLookupClient = Pick<
  Prisma.TransactionClient,
  'knowledgeThreadPromotion'
>;

/**
 * A promotion copies selected immutable Chat content into a synthesis governed
 * by the destination Knowledge ACL. Losing live room access redacts the source
 * link, but does not revoke that explicit copy.
 */
export function threadPromotionSourceAuthorizesVersion(source: {
  sourceThreadPromotionId?: string | null;
}) {
  return typeof source.sourceThreadPromotionId === 'string';
}

export function buildKnowledgeSynthesisVisibilityWhere(
  actor: KnowledgeActor,
): Prisma.KnowledgeSynthesisWhereInput {
  const organizationId = actor.organizationId?.trim();
  const groupAccountIds = [
    ...new Set(
      actor.groupAccountIds.map((value) => value.trim()).filter(Boolean),
    ),
  ];
  return {
    deletedAt: null,
    OR: [
      { ownerUserId: actor.userId },
      ...(organizationId
        ? [
            {
              scope: 'organization' as const,
              organizationId,
              OR: [
                // Existing organization syntheses predate grant rows and retain
                // their organization-wide read contract. Promotion-created
                // syntheses always carry explicit group grants.
                { groupGrants: { none: {} } },
                ...(groupAccountIds.length > 0
                  ? [
                      {
                        groupGrants: {
                          some: {
                            revokedAt: null,
                            groupAccountId: { in: groupAccountIds },
                            groupAccount: {
                              active: true,
                              memberships: {
                                some: {
                                  userId: actor.userId,
                                  user: {
                                    active: true,
                                    deletedAt: null,
                                    organization: organizationId,
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    ]
                  : []),
              ],
            },
          ]
        : []),
    ],
  };
}

export async function threadPromotionSourceAccessible(input: {
  client: ThreadPromotionLookupClient;
  actor: KnowledgeActor;
  sourceId: string;
  context: KnowledgeSynthesisAccessContext;
}) {
  const chat = input.actor.chat;
  if (!chat?.userId) return false;
  consumeSynthesisAccessBudget(input.context, 'query');
  const promotion = await input.client.knowledgeThreadPromotion.findFirst({
    where: {
      id: input.sourceId,
      sourceShare: {
        is: { status: 'posted', chatMessageId: { not: null } },
      },
      sourceRootMessage: {
        is: {
          parentMessageId: null,
          threadRootId: null,
          deletedAt: null,
        },
      },
    },
    select: { sourceRoomId: true },
  });
  if (!promotion) return false;
  consumeSynthesisAccessBudget(input.context, 'query');
  const roomAccess = await ensureChatRoomContentAccess({
    roomId: promotion.sourceRoomId,
    userId: chat.userId,
    roles: chat.roles,
    projectIds: chat.projectIds,
    groupIds: chat.groupIds,
    groupAccountIds: chat.groupAccountIds,
    accessLevel: 'read',
    client: input.client as unknown as typeof prisma,
  });
  if (!roomAccess.ok) return false;
  consumeSynthesisAccessBudget(input.context, 'query');
  return hasActiveChatProject({
    room: roomAccess.room,
    client: input.client as unknown as typeof prisma,
  });
}
