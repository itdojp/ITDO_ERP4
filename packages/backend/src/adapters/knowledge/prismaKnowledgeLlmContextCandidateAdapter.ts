import { Prisma } from '@prisma/client';

import type { KnowledgeActor } from '../../application/knowledge/knowledgeItemPorts.js';
import type {
  KnowledgeLlmContextCandidate,
  KnowledgeLlmContextCandidatePort,
} from '../../application/knowledge/knowledgeLlmRunPorts.js';
import { prisma } from '../../services/db.js';
import { buildKnowledgeLlmSynthesisVersionVisibilityWhere } from './prismaKnowledgeConversationVisibility.js';
import { buildKnowledgeVisibilityWhere } from './prismaKnowledgeItemAdapter.js';
import {
  type KnowledgeReadSnapshotHost,
  withKnowledgeReadSnapshot,
} from './prismaKnowledgeLlmAdapterSupport.js';
import { buildKnowledgeSynthesisVisibilityWhere } from './prismaKnowledgeSynthesisVisibility.js';

type ReadClient = Pick<
  Prisma.TransactionClient,
  | 'knowledgeItem'
  | 'knowledgeSnapshot'
  | 'knowledgeAnnotationRevision'
  | 'knowledgeConversationTurn'
  | 'knowledgeSynthesisVersion'
  | 'knowledgeThreadPromotionMessage'
>;

function scopeMatches(
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

function ownerBoundaryMatches(
  ownerUserId: string,
  actor: KnowledgeActor,
  input: { scope: 'personal' | 'organization' },
) {
  return input.scope === 'organization' || ownerUserId === actor.userId;
}

function conversationVisibilityWhere(
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
        AND: { items: { every: { knowledgeItem: { is: itemVisibility } } } },
      },
    ],
  };
}

export class PrismaKnowledgeLlmContextCandidateAdapter implements KnowledgeLlmContextCandidatePort {
  constructor(
    private readonly readClient: ReadClient &
      KnowledgeReadSnapshotHost<ReadClient> = prisma as unknown as ReadClient &
      KnowledgeReadSnapshotHost<ReadClient>,
  ) {}

  async list(input: Parameters<KnowledgeLlmContextCandidatePort['list']>[0]) {
    return withKnowledgeReadSnapshot(
      this.readClient,
      this.readClient,
      (client) => this.listWithClient(client, input),
    );
  }

  private async listWithClient(
    readClient: ReadClient,
    input: Parameters<KnowledgeLlmContextCandidatePort['list']>[0],
  ) {
    const item = await readClient.knowledgeItem.findFirst({
      where: {
        id: input.itemId,
        ...buildKnowledgeVisibilityWhere(input.actor),
      },
      select: {
        id: true,
        ownerUserId: true,
        scope: true,
        organizationId: true,
      },
    });
    if (
      !item ||
      !ownerBoundaryMatches(item.ownerUserId, input.actor, input) ||
      !scopeMatches(item, input)
    ) {
      return null;
    }

    const boundary = input.boundary
      ? {
          OR: [
            { createdAt: { lt: input.boundary.updatedAt } },
            {
              createdAt: input.boundary.updatedAt,
              id: { lt: input.boundary.id },
            },
          ],
        }
      : {};
    const take = input.limit + 1;
    const page = (
      rows: Array<KnowledgeLlmContextCandidate>,
    ): {
      items: KnowledgeLlmContextCandidate[];
      nextBoundary: { updatedAt: Date; id: string } | null;
    } => {
      const selected = rows.slice(0, input.limit);
      const last = selected[selected.length - 1];
      return {
        items: selected,
        nextBoundary:
          rows.length > input.limit && last
            ? { updatedAt: last.createdAt, id: last.sourceId }
            : null,
      };
    };

    if (input.sourceType === 'snapshot') {
      const rows = await readClient.knowledgeSnapshot.findMany({
        where: {
          knowledgeItemId: item.id,
          status: 'ready',
          sha256: { not: null },
          extractedText: { not: '' },
          ...boundary,
        },
        select: {
          id: true,
          version: true,
          extractedText: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      });
      return page(
        rows.map((row) => ({
          sourceType: input.sourceType,
          sourceId: row.id,
          exactSourceVersion: row.version,
          // The query excludes NULL/empty values; Prisma keeps the nullable
          // column type in the selected row shape.
          byteLength: Buffer.byteLength(row.extractedText!, 'utf8'),
          createdAt: row.createdAt,
        })),
      );
    }

    if (input.sourceType === 'annotation_revision') {
      const rows = await readClient.knowledgeAnnotationRevision.findMany({
        where: {
          annotation: {
            is: {
              knowledgeItemId: item.id,
              deletedAt: null,
              scope: input.scope,
              organizationId:
                input.scope === 'organization' ? input.organizationId : null,
              ...(input.scope === 'personal'
                ? { ownerUserId: input.actor.userId }
                : {}),
            },
          },
          ...boundary,
        },
        select: {
          id: true,
          revision: true,
          content: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      });
      return page(
        rows.map((row) => ({
          sourceType: input.sourceType,
          sourceId: row.id,
          exactSourceVersion: row.revision,
          byteLength: Buffer.byteLength(row.content, 'utf8'),
          createdAt: row.createdAt,
        })),
      );
    }

    if (input.sourceType === 'conversation_turn') {
      const rows = await readClient.knowledgeConversationTurn.findMany({
        where: {
          role: { in: ['user', 'assistant'] },
          conversation: {
            is: {
              AND: [
                conversationVisibilityWhere(input.actor),
                { items: { some: { knowledgeItemId: item.id } } },
                {
                  items: {
                    every: {
                      knowledgeItem: {
                        is: {
                          scope: input.scope,
                          organizationId: input.organizationId,
                          ...(input.scope === 'personal'
                            ? { ownerUserId: input.actor.userId }
                            : {}),
                        },
                      },
                    },
                  },
                },
              ],
            },
          },
          ...boundary,
        },
        select: {
          id: true,
          sequence: true,
          content: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      });
      return page(
        rows.map((row) => ({
          sourceType: input.sourceType,
          sourceId: row.id,
          exactSourceVersion: row.sequence,
          byteLength: Buffer.byteLength(row.content, 'utf8'),
          createdAt: row.createdAt,
        })),
      );
    }

    const synthesisVisibility = buildKnowledgeSynthesisVisibilityWhere(
      input.actor,
    );
    const synthesisScope = {
      scope: input.scope,
      organizationId: input.organizationId,
      ...(input.scope === 'personal'
        ? { ownerUserId: input.actor.userId }
        : {}),
    } as const;

    if (input.sourceType === 'synthesis_version') {
      const relatedToItem: Prisma.KnowledgeSynthesisSourceWhereInput = {
        OR: [
          { sourceKnowledgeItemId: item.id },
          { sourceSnapshot: { is: { knowledgeItemId: item.id } } },
          { sourceAnnotation: { is: { knowledgeItemId: item.id } } },
          {
            sourceAnnotationRevision: {
              is: { annotation: { is: { knowledgeItemId: item.id } } },
            },
          },
          {
            sourceConversation: {
              is: { items: { some: { knowledgeItemId: item.id } } },
            },
          },
          {
            sourceConversationTurn: {
              is: {
                conversation: {
                  is: { items: { some: { knowledgeItemId: item.id } } },
                },
              },
            },
          },
        ],
      };
      const rows = await readClient.knowledgeSynthesisVersion.findMany({
        where: {
          AND: [
            buildKnowledgeLlmSynthesisVersionVisibilityWhere(input.actor),
            { synthesis: { is: synthesisScope } },
          ],
          sources: {
            some: relatedToItem,
            none: {
              OR: [
                { sourceSynthesisVersionId: { not: null } },
                { sourceThreadPromotionId: { not: null } },
                { sourceConversation: { is: { llmRuns: { some: {} } } } },
                {
                  sourceConversation: {
                    is: {
                      turns: { some: { role: { in: ['system', 'tool'] } } },
                    },
                  },
                },
                {
                  sourceConversationTurn: {
                    is: { role: { notIn: ['user', 'assistant'] } },
                  },
                },
                {
                  sourceConversationTurn: {
                    is: { conversation: { is: { llmRuns: { some: {} } } } },
                  },
                },
              ],
            },
          },
          ...boundary,
        },
        select: {
          id: true,
          version: true,
          content: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      });
      return page(
        rows.map((row) => ({
          sourceType: input.sourceType,
          sourceId: row.id,
          exactSourceVersion: row.version,
          byteLength: Buffer.byteLength(row.content, 'utf8'),
          createdAt: row.createdAt,
        })),
      );
    }

    const rows = await readClient.knowledgeThreadPromotionMessage.findMany({
      where: {
        promotion: {
          is: {
            ...synthesisScope,
            sourceShare: { is: { sourceKnowledgeItemId: item.id } },
            destinationSynthesis: { is: synthesisVisibility },
          },
        },
        ...boundary,
      },
      select: {
        id: true,
        ordinal: true,
        content: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });
    return page(
      rows.map((row) => ({
        sourceType: input.sourceType,
        sourceId: row.id,
        exactSourceVersion: row.ordinal + 1,
        byteLength: Buffer.byteLength(row.content, 'utf8'),
        createdAt: row.createdAt,
      })),
    );
  }
}

export const prismaKnowledgeLlmContextCandidateAdapter =
  new PrismaKnowledgeLlmContextCandidateAdapter();
