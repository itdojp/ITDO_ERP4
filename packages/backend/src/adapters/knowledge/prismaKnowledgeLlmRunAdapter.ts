import { Prisma, type PrismaClient } from '@prisma/client';

import type { KnowledgeActor } from '../../application/knowledge/knowledgeItemPorts.js';
import {
  deriveKnowledgeLlmSelectedContext,
  type KnowledgeLlmContextSourceType,
  type KnowledgeLlmSelectedContextSource,
} from '../../application/knowledge/knowledgeLlmContext.js';
import {
  ceilCostMicros,
  knowledgeLlmLimits,
} from '../../application/knowledge/knowledgeLlmConfig.js';
import { knowledgeLlmMonthlyPeriod } from '../../application/knowledge/knowledgeLlmBudgetUseCases.js';
import {
  KnowledgeLlmRunAccessError,
  type KnowledgeLlmBudgetPreview,
  type KnowledgeLlmResolvedContext,
  type KnowledgeLlmRunPort,
  type KnowledgeLlmRunRecord,
  type KnowledgeLlmSourceSelector,
} from '../../application/knowledge/knowledgeLlmRunPorts.js';
import {
  knowledgeProvenanceAuditActor,
  sha256KnowledgeText,
} from '../../application/knowledge/knowledgeProvenanceValidation.js';
import { prisma } from '../../services/db.js';
import { buildKnowledgeVisibilityWhere } from './prismaKnowledgeItemAdapter.js';
import { PrismaKnowledgeLlmAuditWriter } from './prismaKnowledgeLlmAuditAdapter.js';
import {
  markKnowledgeLlmRunDispatched,
  settleKnowledgeLlmBudget,
} from './prismaKnowledgeLlmSettlementAdapter.js';
import { buildKnowledgeSynthesisVisibilityWhere } from './prismaKnowledgeSynthesisVisibility.js';

type Transaction = Prisma.TransactionClient;
type TransactionHost = Pick<PrismaClient, '$transaction'>;
type ContextClient = Pick<
  Transaction,
  | 'knowledgeSnapshot'
  | 'knowledgeAnnotationRevision'
  | 'knowledgeConversationTurn'
  | 'knowledgeSynthesisVersion'
  | 'knowledgeThreadPromotionMessage'
>;
type ReadClient = ContextClient &
  Pick<
    Transaction,
    | 'knowledgeLlmBudgetPolicy'
    | 'knowledgeLlmBudgetPeriod'
    | 'knowledgeLlmReservation'
    | 'knowledgeLlmRequest'
    | 'knowledgeLlmRun'
  >;

const serializableAttempts = knowledgeLlmLimits.serializableAttempts;
const reconcileGraceMs = 60_000;

function retryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = error.code;
  if (code === 'P2034' || code === 'P2002') return true;
  if (code !== 'P2010' || !('meta' in error)) return false;
  return /40001|40P01/.test(JSON.stringify(error.meta));
}

async function serializable<T>(
  host: TransactionHost,
  work: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < serializableAttempts; attempt += 1) {
    try {
      return await host.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      lastError = error;
      if (!retryable(error) || attempt + 1 >= serializableAttempts) throw error;
    }
  }
  throw lastError;
}

function sourceCounts(): KnowledgeLlmResolvedContext['sourceCounts'] {
  return {
    snapshot: 0,
    annotation_revision: 0,
    conversation_turn: 0,
    synthesis_version: 0,
    thread_promotion_message: 0,
  };
}

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

function sameSource(
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

async function resolveOne(
  client: ContextClient,
  input: {
    actor: KnowledgeActor;
    scope: 'personal' | 'organization';
    organizationId: string | null;
    selector: KnowledgeLlmSourceSelector;
    itemIds: Set<string>;
  },
): Promise<KnowledgeLlmSelectedContextSource> {
  const { actor, selector } = input;
  switch (selector.sourceType) {
    case 'snapshot': {
      const row = await client.knowledgeSnapshot.findFirst({
        where: {
          id: selector.sourceId,
          status: 'ready',
          knowledgeItem: { is: buildKnowledgeVisibilityWhere(actor) },
        },
        select: {
          id: true,
          version: true,
          sha256: true,
          extractedText: true,
          knowledgeItem: {
            select: {
              id: true,
              ownerUserId: true,
              scope: true,
              organizationId: true,
            },
          },
        },
      });
      if (
        !row?.sha256 ||
        !row.extractedText ||
        !ownerBoundaryMatches(row.knowledgeItem.ownerUserId, actor, input) ||
        !scopeMatches(row.knowledgeItem, input)
      ) {
        throw new KnowledgeLlmRunAccessError('not_found');
      }
      input.itemIds.add(row.knowledgeItem.id);
      return {
        sourceType: selector.sourceType,
        sourceId: row.id,
        exactSourceVersion: row.version,
        exactSourceHash: row.sha256,
        representation: row.extractedText,
      };
    }
    case 'annotation_revision': {
      const row = await client.knowledgeAnnotationRevision.findFirst({
        where: {
          id: selector.sourceId,
          annotation: {
            is: {
              deletedAt: null,
              knowledgeItem: { is: buildKnowledgeVisibilityWhere(actor) },
            },
          },
        },
        select: {
          id: true,
          revision: true,
          content: true,
          annotation: {
            select: {
              ownerUserId: true,
              scope: true,
              organizationId: true,
              knowledgeItem: { select: { id: true } },
            },
          },
        },
      });
      if (
        !row ||
        !ownerBoundaryMatches(row.annotation.ownerUserId, actor, input) ||
        !scopeMatches(row.annotation, input)
      ) {
        throw new KnowledgeLlmRunAccessError('not_found');
      }
      input.itemIds.add(row.annotation.knowledgeItem.id);
      return {
        sourceType: selector.sourceType,
        sourceId: row.id,
        exactSourceVersion: row.revision,
        exactSourceHash: sha256KnowledgeText(
          'annotation-revision',
          row.content,
        ),
        representation: row.content,
      };
    }
    case 'conversation_turn': {
      const row = await client.knowledgeConversationTurn.findFirst({
        where: {
          id: selector.sourceId,
          role: { in: ['user', 'assistant'] },
          conversation: { is: conversationVisibilityWhere(actor) },
        },
        select: {
          id: true,
          sequence: true,
          content: true,
          contentHash: true,
          conversation: {
            select: {
              ownerUserId: true,
              items: {
                select: {
                  knowledgeItem: {
                    select: {
                      id: true,
                      ownerUserId: true,
                      scope: true,
                      organizationId: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!row) throw new KnowledgeLlmRunAccessError('not_found');
      const items = row.conversation.items.map((item) => item.knowledgeItem);
      if (
        (items.length === 0 &&
          (input.scope !== 'personal' ||
            row.conversation.ownerUserId !== actor.userId)) ||
        (items.length > 0 &&
          items.some(
            (item) =>
              !ownerBoundaryMatches(item.ownerUserId, actor, input) ||
              !scopeMatches(item, input),
          ))
      ) {
        throw new KnowledgeLlmRunAccessError('not_found');
      }
      for (const item of items) input.itemIds.add(item.id);
      return {
        sourceType: selector.sourceType,
        sourceId: row.id,
        exactSourceVersion: row.sequence,
        exactSourceHash: row.contentHash,
        representation: row.content,
      };
    }
    case 'synthesis_version': {
      const row = await client.knowledgeSynthesisVersion.findFirst({
        where: {
          id: selector.sourceId,
          synthesis: { is: buildKnowledgeSynthesisVisibilityWhere(actor) },
        },
        select: {
          id: true,
          version: true,
          content: true,
          synthesis: {
            select: { ownerUserId: true, scope: true, organizationId: true },
          },
          sources: {
            select: {
              sourceConversation: {
                select: {
                  llmRuns: { select: { id: true }, take: 1 },
                  turns: {
                    where: { role: { in: ['system', 'tool'] } },
                    select: { id: true },
                    take: 1,
                  },
                },
              },
              sourceConversationTurn: {
                select: {
                  role: true,
                  conversation: {
                    select: { llmRuns: { select: { id: true }, take: 1 } },
                  },
                },
              },
              sourceSynthesisVersionId: true,
              sourceThreadPromotionId: true,
            },
          },
        },
      });
      if (
        !row ||
        !ownerBoundaryMatches(row.synthesis.ownerUserId, actor, input) ||
        !scopeMatches(row.synthesis, input) ||
        row.sources.some(
          (source) =>
            (source.sourceConversation?.llmRuns.length ?? 0) > 0 ||
            (source.sourceConversation?.turns.length ?? 0) > 0 ||
            (source.sourceConversationTurn !== null &&
              !['user', 'assistant'].includes(
                source.sourceConversationTurn.role,
              )) ||
            (source.sourceConversationTurn?.conversation.llmRuns.length ?? 0) >
              0 ||
            source.sourceSynthesisVersionId !== null ||
            source.sourceThreadPromotionId !== null,
        )
      ) {
        throw new KnowledgeLlmRunAccessError('not_found');
      }
      return {
        sourceType: selector.sourceType,
        sourceId: row.id,
        exactSourceVersion: row.version,
        exactSourceHash: sha256KnowledgeText('synthesis-version', row.content),
        representation: row.content,
      };
    }
    case 'thread_promotion_message': {
      const row = await client.knowledgeThreadPromotionMessage.findFirst({
        where: {
          id: selector.sourceId,
          promotion: {
            is: {
              destinationSynthesis: {
                is: buildKnowledgeSynthesisVisibilityWhere(actor),
              },
            },
          },
        },
        select: {
          id: true,
          ordinal: true,
          content: true,
          contentHash: true,
          promotion: {
            select: { ownerUserId: true, scope: true, organizationId: true },
          },
        },
      });
      if (
        !row ||
        !ownerBoundaryMatches(row.promotion.ownerUserId, actor, input) ||
        !scopeMatches(row.promotion, input)
      ) {
        throw new KnowledgeLlmRunAccessError('not_found');
      }
      return {
        sourceType: selector.sourceType,
        sourceId: row.id,
        exactSourceVersion: row.ordinal + 1,
        exactSourceHash: row.contentHash,
        representation: row.content,
      };
    }
  }
}

async function resolveContext(
  client: ContextClient,
  input: {
    actor: KnowledgeActor;
    scope: 'personal' | 'organization';
    organizationId: string | null;
    selectors: readonly KnowledgeLlmSourceSelector[];
  },
): Promise<KnowledgeLlmResolvedContext> {
  if (
    !Array.isArray(input.selectors) ||
    input.selectors.length < 1 ||
    input.selectors.length > knowledgeLlmLimits.totalSources
  ) {
    throw new KnowledgeLlmRunAccessError('not_found');
  }
  const itemIds = new Set<string>();
  const counts = sourceCounts();
  const sources: KnowledgeLlmSelectedContextSource[] = [];
  const identities = new Set<string>();
  for (const selector of input.selectors) {
    const identity = `${selector.sourceType}\0${selector.sourceId}`;
    if (identities.has(identity)) {
      throw new KnowledgeLlmRunAccessError('not_found');
    }
    identities.add(identity);
    const source = await resolveOne(client, { ...input, selector, itemIds });
    counts[source.sourceType] += 1;
    sources.push(source);
  }
  if (itemIds.size > knowledgeLlmLimits.selectedItems) {
    throw new KnowledgeLlmRunAccessError('not_found');
  }
  return { sources, sourceCounts: counts, selectedItemCount: itemIds.size };
}

type RunRow = Prisma.KnowledgeLlmRunGetPayload<{
  include: {
    assistantTurn: { select: { content: true } };
    contextSources: {
      select: {
        ordinal: true;
        sourceType: true;
        sourceSnapshotId: true;
        sourceAnnotationRevisionId: true;
        sourceConversationTurnId: true;
        sourceSynthesisVersionId: true;
        sourceThreadPromotionMessageId: true;
        exactSourceVersion: true;
        exactSourceHash: true;
        representationHash: true;
        byteLength: true;
        estimatedTokens: true;
      };
    };
  };
}>;

type StoredContextSource = RunRow['contextSources'][number];

function storedSourceId(source: StoredContextSource): string | null {
  switch (source.sourceType) {
    case 'snapshot':
      return source.sourceSnapshotId;
    case 'annotation_revision':
      return source.sourceAnnotationRevisionId;
    case 'conversation_turn':
      return source.sourceConversationTurnId;
    case 'synthesis_version':
      return source.sourceSynthesisVersionId;
    case 'thread_promotion_message':
      return source.sourceThreadPromotionMessageId;
  }
}

async function requireCurrentRunSourceAccess(
  client: ContextClient,
  actor: KnowledgeActor,
  run: RunRow,
): Promise<void> {
  const selectors = run.contextSources.map((source, ordinal) => {
    const sourceId = storedSourceId(source);
    if (source.ordinal !== ordinal || !sourceId) {
      throw new KnowledgeLlmRunAccessError('not_found');
    }
    return { sourceType: source.sourceType, sourceId };
  });
  const current = await resolveContext(client, {
    actor,
    scope: run.scope,
    organizationId: run.organizationId,
    selectors,
  });
  let derived: ReturnType<typeof deriveKnowledgeLlmSelectedContext>;
  try {
    derived = deriveKnowledgeLlmSelectedContext(current.sources);
  } catch {
    throw new KnowledgeLlmRunAccessError('not_found');
  }
  if (
    derived.sources.length !== run.contextSources.length ||
    derived.sources.some((source, ordinal) => {
      const stored = run.contextSources[ordinal];
      return (
        !stored ||
        source.sourceType !== stored.sourceType ||
        source.exactSourceVersion !== stored.exactSourceVersion ||
        source.exactSourceHash !== stored.exactSourceHash ||
        source.representationHash !== stored.representationHash ||
        source.byteLength !== stored.byteLength ||
        source.estimatedTokens !== stored.estimatedTokens
      );
    })
  ) {
    throw new KnowledgeLlmRunAccessError('not_found');
  }
}

function mapRun(row: RunRow): KnowledgeLlmRunRecord {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    scope: row.scope,
    organizationId: row.organizationId,
    provider: row.provider,
    model: row.model,
    catalogVersion: row.catalogVersion,
    promptTemplateVersion: row.promptTemplateVersion,
    requestPayloadHash: row.requestPayloadHash,
    providerRequestHash: row.providerRequestHash,
    estimatedInputTokens: row.estimatedInputTokens,
    maxOutputTokens: row.maxOutputTokens,
    maximumCostMicros: row.maximumCostMicros,
    softLimitWarning: row.softLimitWarning,
    actualInputTokens: row.actualInputTokens,
    actualOutputTokens: row.actualOutputTokens,
    actualCostMicros: row.actualCostMicros,
    currency: row.currency,
    executionStatus: row.executionStatus,
    settlementStatus: row.settlementStatus,
    failureCode: row.failureCode,
    conversationId: row.conversationId,
    assistantTurnId: row.assistantTurnId,
    resultContent: row.assistantTurn?.content ?? null,
    createdAt: row.createdAt,
    dispatchedAt: row.dispatchedAt,
    completedAt: row.completedAt,
  };
}

const runInclude = {
  assistantTurn: { select: { content: true } },
  contextSources: {
    orderBy: { ordinal: 'asc' },
    select: {
      ordinal: true,
      sourceType: true,
      sourceSnapshotId: true,
      sourceAnnotationRevisionId: true,
      sourceConversationTurnId: true,
      sourceSynthesisVersionId: true,
      sourceThreadPromotionMessageId: true,
      exactSourceVersion: true,
      exactSourceHash: true,
      representationHash: true,
      byteLength: true,
      estimatedTokens: true,
    },
  },
} as const;

async function createResultConversation(
  transaction: Transaction,
  input: {
    runId: string;
    provider: 'stub' | 'openai';
    model: string;
    actorUserId: string;
    userPrompt: string;
    resultContent: string;
    capturedAt: Date;
  },
) {
  const resultHash = sha256KnowledgeText(
    'conversation-turn',
    input.resultContent,
  );
  const conversation = await transaction.knowledgeConversation.create({
    data: {
      ownerUserId: input.actorUserId,
      title: 'External LLM run',
      sourceType: 'manual',
      provider: input.provider,
      model: input.model,
      capturedAt: input.capturedAt,
      contentHash: sha256KnowledgeText(
        'llm-conversation',
        `${input.runId}\0${sha256KnowledgeText('llm-user-prompt', input.userPrompt)}\0${resultHash}`,
      ),
      createdBy: input.actorUserId,
      updatedBy: input.actorUserId,
      turns: {
        create: [
          {
            sequence: 1,
            role: 'user',
            origin: 'user',
            content: input.userPrompt,
            contentHash: sha256KnowledgeText(
              'conversation-turn',
              input.userPrompt,
            ),
            createdBy: input.actorUserId,
          },
          {
            sequence: 2,
            role: 'assistant',
            origin: 'ai',
            content: input.resultContent,
            contentHash: resultHash,
            createdBy: input.actorUserId,
          },
        ],
      },
    },
    include: { turns: { orderBy: { sequence: 'asc' } } },
  });
  const assistant = conversation.turns[1];
  if (!assistant || assistant.role !== 'assistant') {
    throw new Error('knowledge_llm_finalization_invalid');
  }
  return { conversation, assistant, resultHash };
}

function expectedPolicySubjects(input: {
  actor: KnowledgeActor;
  scope: 'personal' | 'organization';
  organizationId: string | null;
}) {
  return [
    { subjectType: 'user' as const, subjectId: input.actor.userId },
    ...(input.scope === 'organization' && input.organizationId
      ? [
          {
            subjectType: 'organization' as const,
            subjectId: input.organizationId,
          },
        ]
      : []),
  ];
}

export class PrismaKnowledgeLlmRunAdapter implements KnowledgeLlmRunPort {
  constructor(
    private readonly host: TransactionHost = prisma,
    private readonly readClient: ReadClient = prisma as unknown as ReadClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  resolveContext(input: Parameters<KnowledgeLlmRunPort['resolveContext']>[0]) {
    return resolveContext(this.readClient, input);
  }

  async budgetPreview(
    input: Parameters<KnowledgeLlmRunPort['budgetPreview']>[0],
  ): Promise<KnowledgeLlmBudgetPreview> {
    const expected = expectedPolicySubjects(input);
    const policies = await this.readClient.knowledgeLlmBudgetPolicy.findMany({
      where: {
        active: true,
        OR: expected.map((subject) => ({
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
        })),
      },
      orderBy: [{ subjectType: 'asc' }, { subjectId: 'asc' }],
    });
    if (policies.length !== expected.length) {
      return {
        configured: false,
        policyCount: policies.length,
        currency: null,
        softLimitWarning: false,
        hardLimitBlocked: true,
        rateBlocked: false,
        subjects: [],
      };
    }
    const currencies = new Set(policies.map((policy) => policy.currency));
    if (currencies.size !== 1) {
      return {
        configured: false,
        policyCount: policies.length,
        currency: null,
        softLimitWarning: false,
        hardLimitBlocked: true,
        rateBlocked: false,
        subjects: [],
      };
    }
    const oneHourAgo = new Date(input.now.getTime() - 60 * 60 * 1000);
    const subjects = await Promise.all(
      policies.map(async (policy) => {
        const periodWindow = knowledgeLlmMonthlyPeriod(
          input.now,
          policy.timezone,
        );
        const period =
          await this.readClient.knowledgeLlmBudgetPeriod.findUnique({
            where: {
              policyId_periodStartUtc: {
                policyId: policy.id,
                periodStartUtc: periodWindow.start,
              },
            },
          });
        const acceptedRequestsLastHour =
          await this.readClient.knowledgeLlmReservation.count({
            where: {
              budgetPeriod: { policyId: policy.id },
              accountedAt: { gte: oneHourAgo, lte: input.now },
            },
          });
        return {
          subjectType: policy.subjectType,
          currency: policy.currency,
          softLimitMicros: policy.softLimitMicros,
          hardLimitMicros: policy.hardLimitMicros,
          activeReservedMicros: period?.activeReservedMicros ?? 0n,
          settledActualMicros: period?.settledActualMicros ?? 0n,
          heldMaximumMicros: period?.heldMaximumMicros ?? 0n,
          requestsPerHour: policy.requestsPerHour,
          acceptedRequestsLastHour,
        };
      }),
    );
    const afterReservation = subjects.map(
      (subject) =>
        subject.activeReservedMicros +
        subject.settledActualMicros +
        subject.heldMaximumMicros +
        input.maximumCostMicros,
    );
    return {
      configured: true,
      policyCount: subjects.length,
      currency: policies[0]?.currency ?? null,
      softLimitWarning: subjects.some(
        (subject, index) =>
          (afterReservation[index] ?? 0n) > subject.softLimitMicros,
      ),
      hardLimitBlocked: subjects.some(
        (subject, index) =>
          (afterReservation[index] ?? 0n) > subject.hardLimitMicros,
      ),
      rateBlocked: subjects.some(
        (subject) =>
          subject.acceptedRequestsLastHour >= subject.requestsPerHour,
      ),
      subjects,
    };
  }

  async writePreviewAudit(
    input: Parameters<KnowledgeLlmRunPort['writePreviewAudit']>[0],
  ): Promise<void> {
    await this.host.$transaction(async (transaction) => {
      await new PrismaKnowledgeLlmAuditWriter(transaction).write({
        action: 'knowledge_llm_previewed',
        actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
        targetTable: 'knowledge_llm_runs',
        targetId: input.runId,
        metadata: {
          provider: input.provider,
          model: input.model,
          scope: input.scope,
          catalogVersion: input.catalogVersion,
          estimatedInputTokens: input.estimatedInputTokens,
          maxOutputTokens: input.maxOutputTokens,
          reservedCostMicros: input.maximumCostMicros.toString(),
          currency: input.currency,
          sourceCounts: {
            snapshots: input.sourceCounts.snapshot,
            annotationRevisions: input.sourceCounts.annotation_revision,
            conversationTurns: input.sourceCounts.conversation_turn,
            synthesisVersions: input.sourceCounts.synthesis_version,
            threadPromotionMessages:
              input.sourceCounts.thread_promotion_message,
          },
          resultCode: 'previewed',
          policyCount: 0,
          softLimitWarning: false,
        },
      });
    });
  }

  async findByRequestKey(
    input: Parameters<KnowledgeLlmRunPort['findByRequestKey']>[0],
  ) {
    const request = await this.readClient.knowledgeLlmRequest.findFirst({
      where: {
        actorUserId: input.actor.userId,
        requestKeyHash: input.requestKeyHash,
      },
      include: { run: { include: runInclude } },
    });
    if (request) {
      await requireCurrentRunSourceAccess(
        this.readClient,
        input.actor,
        request.run,
      );
    }
    return request ? mapRun(request.run) : null;
  }

  async findOwned(input: Parameters<KnowledgeLlmRunPort['findOwned']>[0]) {
    const row = await this.readClient.knowledgeLlmRun.findFirst({
      where: { id: input.runId, actorUserId: input.actor.userId },
      include: runInclude,
    });
    if (row) {
      await requireCurrentRunSourceAccess(this.readClient, input.actor, row);
    }
    return row ? mapRun(row) : null;
  }

  async authorizeAndMarkDispatched(
    input: Parameters<KnowledgeLlmRunPort['authorizeAndMarkDispatched']>[0],
  ): Promise<void> {
    let rejection: KnowledgeLlmRunAccessError | null = null;
    await serializable(this.host, async (transaction) => {
      try {
        const current = await resolveContext(transaction, input);
        if (
          current.sources.length !== input.expectedSources.length ||
          current.sources.some(
            (source, index) =>
              !input.expectedSources[index] ||
              !sameSource(source, input.expectedSources[index]),
          )
        ) {
          throw new KnowledgeLlmRunAccessError('stale_preview');
        }
        await markKnowledgeLlmRunDispatched(
          transaction,
          {
            runId: input.runId,
            actorUserId: input.actor.userId,
            auditActor: knowledgeProvenanceAuditActor(
              input.actor,
              input.auditActor,
            ),
            expectedProviderRequestHash: input.expectedProviderRequestHash,
          },
          this.clock,
        );
      } catch (error) {
        if (!(error instanceof KnowledgeLlmRunAccessError)) throw error;
        await settleKnowledgeLlmBudget(
          transaction,
          {
            runId: input.runId,
            actorUserId: input.actor.userId,
            auditActor: knowledgeProvenanceAuditActor(
              input.actor,
              input.auditActor,
            ),
            settlement: {
              type: 'release',
              failureCode: 'rejected_before_dispatch',
            },
          },
          this.clock,
        );
        rejection = error;
      }
    });
    if (rejection) throw rejection;
  }

  async finalizeReportedResult(
    input: Parameters<KnowledgeLlmRunPort['finalizeReportedResult']>[0],
  ): Promise<KnowledgeLlmRunRecord> {
    return serializable(this.host, async (transaction) => {
      const run = await transaction.knowledgeLlmRun.findFirstOrThrow({
        where: {
          id: input.runId,
          actorUserId: input.actor.userId,
          executionStatus: 'dispatched',
          settlementStatus: 'reserved',
        },
      });
      const { conversation, assistant, resultHash } =
        await createResultConversation(transaction, {
          runId: run.id,
          provider: run.provider,
          model: run.model,
          actorUserId: input.actor.userId,
          userPrompt: input.userPrompt,
          resultContent: input.resultContent,
          capturedAt: this.clock(),
        });
      const outcomeCapturedAt = this.clock();
      await transaction.knowledgeLlmProviderOutcome.create({
        data: {
          runId: run.id,
          status: 'valid',
          normalizedContent: input.resultContent,
          contentHash: resultHash,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          capturedAt: outcomeCapturedAt,
          createdAt: outcomeCapturedAt,
        },
      });
      await transaction.knowledgeLlmProviderOutcome.update({
        where: { runId: run.id },
        data: { normalizedContent: null, finalizedAt: this.clock() },
      });
      const actualCostMicros =
        ceilCostMicros(input.inputTokens, run.inputCostMicrosPerMillion) +
        ceilCostMicros(input.outputTokens, run.outputCostMicrosPerMillion);
      await settleKnowledgeLlmBudget(
        transaction,
        {
          runId: run.id,
          actorUserId: input.actor.userId,
          auditActor: knowledgeProvenanceAuditActor(
            input.actor,
            input.auditActor,
          ),
          settlement: {
            type: 'actual',
            actualInputTokens: input.inputTokens,
            actualOutputTokens: input.outputTokens,
            actualCostMicros,
            conversationId: conversation.id,
            assistantTurnId: assistant.id,
          },
        },
        this.clock,
      );
      const result = await transaction.knowledgeLlmRun.findUniqueOrThrow({
        where: { id: run.id },
        include: runInclude,
      });
      return mapRun(result);
    });
  }

  async finalizeUsageUnknownResult(
    input: Parameters<KnowledgeLlmRunPort['finalizeUsageUnknownResult']>[0],
  ): Promise<KnowledgeLlmRunRecord> {
    return serializable(this.host, async (transaction) => {
      const run = await transaction.knowledgeLlmRun.findFirstOrThrow({
        where: {
          id: input.runId,
          actorUserId: input.actor.userId,
          executionStatus: 'dispatched',
          settlementStatus: 'reserved',
        },
      });
      const { conversation, assistant, resultHash } =
        await createResultConversation(transaction, {
          runId: run.id,
          provider: run.provider,
          model: run.model,
          actorUserId: input.actor.userId,
          userPrompt: input.userPrompt,
          resultContent: input.resultContent,
          capturedAt: this.clock(),
        });
      const outcomeCapturedAt = this.clock();
      await transaction.knowledgeLlmProviderOutcome.create({
        data: {
          runId: run.id,
          status: 'usage_unknown',
          normalizedContent: input.resultContent,
          contentHash: resultHash,
          failureCode: input.failureCode,
          capturedAt: outcomeCapturedAt,
          createdAt: outcomeCapturedAt,
        },
      });
      await transaction.knowledgeLlmProviderOutcome.update({
        where: { runId: run.id },
        data: { normalizedContent: null, finalizedAt: this.clock() },
      });
      await settleKnowledgeLlmBudget(
        transaction,
        {
          runId: run.id,
          actorUserId: input.actor.userId,
          auditActor: knowledgeProvenanceAuditActor(
            input.actor,
            input.auditActor,
          ),
          settlement: {
            type: 'hold',
            executionStatus: 'result_ready',
            failureCode: input.failureCode,
            conversationId: conversation.id,
            assistantTurnId: assistant.id,
          },
        },
        this.clock,
      );
      const result = await transaction.knowledgeLlmRun.findUniqueOrThrow({
        where: { id: run.id },
        include: runInclude,
      });
      return mapRun(result);
    });
  }

  async holdResultUnknown(
    input: Parameters<KnowledgeLlmRunPort['holdResultUnknown']>[0],
  ): Promise<KnowledgeLlmRunRecord> {
    return serializable(this.host, async (transaction) => {
      await settleKnowledgeLlmBudget(
        transaction,
        {
          runId: input.runId,
          actorUserId: input.actor.userId,
          auditActor: knowledgeProvenanceAuditActor(
            input.actor,
            input.auditActor,
          ),
          settlement: {
            type: 'hold',
            executionStatus: 'result_unknown',
            failureCode: input.failureCode,
          },
        },
        this.clock,
      );
      const row = await transaction.knowledgeLlmRun.findUniqueOrThrow({
        where: { id: input.runId },
        include: runInclude,
      });
      return mapRun(row);
    });
  }

  async reconcile(input: Parameters<KnowledgeLlmRunPort['reconcile']>[0]) {
    return serializable(this.host, async (transaction) => {
      const row = await transaction.knowledgeLlmRun.findFirst({
        where: { id: input.runId, actorUserId: input.actor.userId },
        select: {
          id: true,
          executionStatus: true,
          settlementStatus: true,
          updatedAt: true,
        },
      });
      if (!row) throw new KnowledgeLlmRunAccessError('not_found');
      const now = this.clock();
      if (now.getTime() - row.updatedAt.getTime() < reconcileGraceMs) {
        return;
      }
      if (
        row.executionStatus === 'reserved' &&
        row.settlementStatus === 'reserved'
      ) {
        await settleKnowledgeLlmBudget(
          transaction,
          {
            runId: row.id,
            actorUserId: input.actor.userId,
            auditActor: knowledgeProvenanceAuditActor(
              input.actor,
              input.auditActor,
            ),
            settlement: {
              type: 'release',
              failureCode: 'rejected_before_dispatch',
            },
          },
          this.clock,
        );
      } else if (
        row.executionStatus === 'dispatched' &&
        row.settlementStatus === 'reserved'
      ) {
        await settleKnowledgeLlmBudget(
          transaction,
          {
            runId: row.id,
            actorUserId: input.actor.userId,
            auditActor: knowledgeProvenanceAuditActor(
              input.actor,
              input.auditActor,
            ),
            settlement: {
              type: 'hold',
              executionStatus: 'result_unknown',
              failureCode: 'finalization_failed',
            },
          },
          this.clock,
        );
      }
    });
  }
}

export const prismaKnowledgeLlmRunAdapter = new PrismaKnowledgeLlmRunAdapter();
