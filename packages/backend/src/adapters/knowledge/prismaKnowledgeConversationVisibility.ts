import { Prisma } from '@prisma/client';

import type { KnowledgeActor } from '../../application/knowledge/knowledgeItemPorts.js';
import { buildKnowledgeVisibilityWhere } from './prismaKnowledgeItemAdapter.js';
import { buildKnowledgeSynthesisVisibilityWhere } from './prismaKnowledgeSynthesisVisibility.js';

function buildStandaloneConversationVisibilityWhere(
  actor: KnowledgeActor,
): Prisma.KnowledgeConversationWhereInput {
  const itemVisibility = buildKnowledgeVisibilityWhere(actor);
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
        llmRuns: { none: {} },
        AND: {
          items: {
            every: { knowledgeItem: { is: itemVisibility } },
          },
        },
      },
    ],
  };
}

/**
 * LLM synthesis context deliberately excludes nested synthesis and thread
 * promotion provenance. Within that bounded subset, a non-owner may use a
 * version only while every direct provenance source remains currently
 * readable. Owners retain the existing synthesis-history contract.
 */
export function buildKnowledgeLlmSynthesisVersionVisibilityWhere(
  actor: KnowledgeActor,
): Prisma.KnowledgeSynthesisVersionWhereInput {
  const itemVisibility = buildKnowledgeVisibilityWhere(actor);
  const standaloneConversationVisibility =
    buildStandaloneConversationVisibilityWhere(actor);
  const sourceVisibility = {
    OR: [
      {
        sourceKnowledgeItem: { is: itemVisibility },
      },
      {
        sourceSnapshot: {
          is: { knowledgeItem: { is: itemVisibility } },
        },
      },
      {
        sourceAnnotation: {
          is: {
            deletedAt: null,
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
        sourceConversation: {
          is: standaloneConversationVisibility,
        },
      },
      {
        sourceConversationTurn: {
          is: { conversation: { is: standaloneConversationVisibility } },
        },
      },
    ],
  } satisfies Prisma.KnowledgeSynthesisSourceWhereInput;
  return {
    AND: [
      {
        synthesis: { is: buildKnowledgeSynthesisVisibilityWhere(actor) },
      },
      {
        OR: [
          { synthesis: { is: { ownerUserId: actor.userId } } },
          { sources: { some: {}, every: sourceVisibility } },
        ],
      },
    ],
  };
}

export function buildKnowledgeConversationVisibilityWhere(
  actor: KnowledgeActor,
): Prisma.KnowledgeConversationWhereInput {
  const itemVisibility = buildKnowledgeVisibilityWhere(actor);
  const standaloneConversationVisibility =
    buildStandaloneConversationVisibilityWhere(actor);
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
          is: buildKnowledgeLlmSynthesisVersionVisibilityWhere(actor),
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
        llmRuns: { none: {} },
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
