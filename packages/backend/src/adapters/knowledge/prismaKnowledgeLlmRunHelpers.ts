import { Prisma } from '@prisma/client';

import type { KnowledgeActor } from '../../application/knowledge/knowledgeItemPorts.js';
import type { KnowledgeLlmSelectedContextSource } from '../../application/knowledge/knowledgeLlmContext.js';
import type { KnowledgeLlmResolvedContext } from '../../application/knowledge/knowledgeLlmRunPorts.js';
import { buildKnowledgeVisibilityWhere } from './prismaKnowledgeItemAdapter.js';

export function knowledgeLlmSourceCounts(): KnowledgeLlmResolvedContext['sourceCounts'] {
  return {
    snapshot: 0,
    annotation_revision: 0,
    conversation_turn: 0,
    synthesis_version: 0,
    thread_promotion_message: 0,
  };
}

export function knowledgeLlmScopeMatches(
  source: { scope: 'personal' | 'organization'; organizationId: string | null },
  input: { scope: 'personal' | 'organization'; organizationId: string | null },
) {
  return (
    source.scope === input.scope &&
    (input.scope === 'personal'
      ? source.organizationId === null
      : source.organizationId === input.organizationId)
  );
}

export function knowledgeLlmOwnerBoundaryMatches(
  ownerUserId: string,
  actor: KnowledgeActor,
  input: { scope: 'personal' | 'organization' },
) {
  return input.scope === 'organization' || ownerUserId === actor.userId;
}

export function knowledgeLlmConversationVisibilityWhere(
  actor: KnowledgeActor,
): Prisma.KnowledgeConversationWhereInput {
  const itemVisibility = buildKnowledgeVisibilityWhere(actor);
  return {
    deletedAt: null,
    OR: [
      { ownerUserId: actor.userId, items: { none: {} }, llmRuns: { none: {} } },
      {
        items: { some: {} },
        llmRuns: { none: {} },
        AND: { items: { every: { knowledgeItem: { is: itemVisibility } } } },
      },
    ],
  };
}

export function sameKnowledgeLlmSource(
  left: KnowledgeLlmSelectedContextSource,
  right: KnowledgeLlmSelectedContextSource,
) {
  return (
    left.sourceType === right.sourceType &&
    left.sourceId === right.sourceId &&
    left.exactSourceVersion === right.exactSourceVersion &&
    left.exactSourceHash === right.exactSourceHash &&
    left.representation === right.representation
  );
}
