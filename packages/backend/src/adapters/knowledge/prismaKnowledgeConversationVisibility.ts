import { Prisma } from '@prisma/client';

import type { KnowledgeActor } from '../../application/knowledge/knowledgeItemPorts.js';
import { buildKnowledgeVisibilityWhere } from './prismaKnowledgeItemAdapter.js';
import { buildKnowledgeSynthesisVisibilityWhere } from './prismaKnowledgeSynthesisVisibility.js';

export function buildKnowledgeConversationVisibilityWhere(
  actor: KnowledgeActor,
): Prisma.KnowledgeConversationWhereInput {
  const itemVisibility = buildKnowledgeVisibilityWhere(actor);
  const standaloneConversationVisibility = {
    deletedAt: null,
    OR: [
      {
        ownerUserId: actor.userId,
        items: { none: {} },
        llmRuns: { none: {} },
      },
      {
        items: { some: {} },
        AND: {
          items: {
            every: { knowledgeItem: { is: itemVisibility } },
          },
        },
      },
    ],
  } satisfies Prisma.KnowledgeConversationWhereInput;
  const sourceVisibility = {
    OR: [
      {
        sourceSnapshot: {
          is: {
            status: 'ready',
            knowledgeItem: { is: itemVisibility },
          },
        },
      },
      {
        sourceAnnotationRevision: {
          is: {
            annotation: {
              is: {
                deletedAt: null,
                knowledgeItem: { is: itemVisibility },
              },
            },
          },
        },
      },
      {
        sourceConversationTurn: {
          is: { conversation: { is: standaloneConversationVisibility } },
        },
      },
      {
        sourceSynthesisVersion: {
          is: {
            synthesis: { is: buildKnowledgeSynthesisVisibilityWhere(actor) },
          },
        },
      },
      {
        sourceThreadPromotionMessage: {
          is: {
            promotion: {
              is: {
                destinationSynthesis: {
                  is: buildKnowledgeSynthesisVisibilityWhere(actor),
                },
              },
            },
          },
        },
      },
    ],
  } satisfies Prisma.KnowledgeLlmContextSourceWhereInput;
  return {
    deletedAt: null,
    OR: [
      {
        ownerUserId: actor.userId,
        items: { none: {} },
        llmRuns: { none: {} },
      },
      {
        items: { some: {} },
        AND: {
          items: {
            every: { knowledgeItem: { is: itemVisibility } },
          },
        },
      },
      {
        llmRuns: {
          some: { actorUserId: actor.userId },
          every: {
            actorUserId: actor.userId,
            contextSources: { some: {}, every: sourceVisibility },
          },
        },
      },
    ],
  };
}
