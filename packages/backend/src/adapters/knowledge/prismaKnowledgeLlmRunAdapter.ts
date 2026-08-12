import { Prisma, type PrismaClient } from '@prisma/client';

import type { KnowledgeActor } from '../../application/knowledge/knowledgeItemPorts.js';
import { isPersistenceCompatibleExternalLlmText } from '../../application/externalLlm/externalLlmPort.js';
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
  type KnowledgeLlmCapturedProviderOutcome,
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
  reconcileKnowledgeLlmHeldBudget,
  reconcileKnowledgeLlmHeldOutcome,
  settleKnowledgeLlmBudget,
} from './prismaKnowledgeLlmSettlementAdapter.js';
import { buildKnowledgeSynthesisVisibilityWhere } from './prismaKnowledgeSynthesisVisibility.js';
import { KnowledgeLlmProviderOutcomeMissingError } from './prismaKnowledgeLlmRunErrors.js';

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
    | 'knowledgeLlmProviderOutcome'
  >;

const serializableAttempts = knowledgeLlmLimits.serializableAttempts;
const reconcileGraceMs = knowledgeLlmLimits.reconcileGraceMs;

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
              sourceKnowledgeItemId: true,
              sourceSnapshot: { select: { knowledgeItemId: true } },
              sourceAnnotation: { select: { knowledgeItemId: true } },
              sourceAnnotationRevision: {
                select: {
                  annotation: { select: { knowledgeItemId: true } },
                },
              },
              sourceConversation: {
                select: {
                  llmRuns: { select: { id: true }, take: 1 },
                  turns: {
                    where: { role: { in: ['system', 'tool'] } },
                    select: { id: true },
                    take: 1,
                  },
                  items: { select: { knowledgeItemId: true } },
                },
              },
              sourceConversationTurn: {
                select: {
                  role: true,
                  conversation: {
                    select: {
                      llmRuns: { select: { id: true }, take: 1 },
                      items: { select: { knowledgeItemId: true } },
                    },
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
      for (const source of row.sources) {
        const directItemIds = [
          source.sourceKnowledgeItemId,
          source.sourceSnapshot?.knowledgeItemId,
          source.sourceAnnotation?.knowledgeItemId,
          source.sourceAnnotationRevision?.annotation.knowledgeItemId,
          ...(source.sourceConversation?.items.map(
            (item) => item.knowledgeItemId,
          ) ?? []),
          ...(source.sourceConversationTurn?.conversation.items.map(
            (item) => item.knowledgeItemId,
          ) ?? []),
        ];
        for (const itemId of directItemIds) {
          if (itemId) input.itemIds.add(itemId);
        }
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
            select: {
              ownerUserId: true,
              scope: true,
              organizationId: true,
              sourceShare: { select: { sourceKnowledgeItemId: true } },
            },
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
      input.itemIds.add(row.promotion.sourceShare.sourceKnowledgeItemId);
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

type StoredProviderOutcome = {
  id: string;
  runId: string;
  status: 'valid' | 'usage_unknown' | 'invalid';
  normalizedContent: string | null;
  contentHash: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  failureCode: string | null;
  capturedAt: Date;
  finalizedAt: Date | null;
};

function trustedRunTimestamp(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error('knowledge_llm_clock_invalid');
  }
  return new Date(value.getTime());
}

function validateCapturedOutcome(
  outcome: KnowledgeLlmCapturedProviderOutcome,
): void {
  if (
    outcome === null ||
    typeof outcome !== 'object' ||
    Array.isArray(outcome)
  ) {
    throw new Error('knowledge_llm_outcome_invalid');
  }
  const runtimeOutcome = outcome as unknown as Record<string, unknown>;
  if (runtimeOutcome.status === 'invalid') {
    const failureCodes = new Set([
      'provider_4xx',
      'provider_5xx',
      'malformed_response',
      'response_oversize',
      'empty_result',
    ]);
    if (
      !failureCodes.has(runtimeOutcome.failureCode as string) ||
      runtimeOutcome.normalizedContent !== undefined ||
      runtimeOutcome.inputTokens !== undefined ||
      runtimeOutcome.outputTokens !== undefined
    ) {
      throw new Error('knowledge_llm_outcome_invalid');
    }
    return;
  }
  if (runtimeOutcome.status === 'usage_unknown') {
    const failureCodes = new Set(['usage_missing', 'usage_invalid']);
    if (
      !failureCodes.has(runtimeOutcome.failureCode as string) ||
      runtimeOutcome.inputTokens !== undefined ||
      runtimeOutcome.outputTokens !== undefined
    ) {
      throw new Error('knowledge_llm_outcome_invalid');
    }
  } else if (runtimeOutcome.status !== 'valid') {
    throw new Error('knowledge_llm_outcome_invalid');
  } else if (runtimeOutcome.failureCode !== undefined) {
    throw new Error('knowledge_llm_outcome_invalid');
  }
  const normalizedContent = runtimeOutcome.normalizedContent;
  if (
    typeof normalizedContent !== 'string' ||
    !isPersistenceCompatibleExternalLlmText(normalizedContent) ||
    Buffer.byteLength(normalizedContent, 'utf8') < 1 ||
    Buffer.byteLength(normalizedContent, 'utf8') >
      knowledgeLlmLimits.resultBytes
  ) {
    throw new Error('knowledge_llm_outcome_invalid');
  }
  if (
    runtimeOutcome.status === 'valid' &&
    (typeof runtimeOutcome.inputTokens !== 'number' ||
      !Number.isSafeInteger(runtimeOutcome.inputTokens) ||
      runtimeOutcome.inputTokens < 0 ||
      typeof runtimeOutcome.outputTokens !== 'number' ||
      !Number.isSafeInteger(runtimeOutcome.outputTokens) ||
      runtimeOutcome.outputTokens < 0)
  ) {
    throw new Error('knowledge_llm_outcome_invalid');
  }
}

function sameCapturedOutcome(
  stored: StoredProviderOutcome,
  outcome: KnowledgeLlmCapturedProviderOutcome,
): boolean {
  if (stored.status !== outcome.status) return false;
  if (outcome.status === 'invalid') {
    return (
      stored.normalizedContent === null &&
      stored.contentHash === null &&
      stored.inputTokens === null &&
      stored.outputTokens === null &&
      stored.failureCode === outcome.failureCode
    );
  }
  const expectedHash = sha256KnowledgeText(
    'conversation-turn',
    outcome.normalizedContent,
  );
  const exactContentAvailable =
    stored.normalizedContent === outcome.normalizedContent;
  const exactContentAlreadyFinalized =
    stored.normalizedContent === null &&
    stored.finalizedAt !== null &&
    stored.contentHash === expectedHash;
  if (
    (!exactContentAvailable && !exactContentAlreadyFinalized) ||
    stored.contentHash !== expectedHash
  ) {
    return false;
  }
  if (outcome.status === 'usage_unknown') {
    return (
      stored.inputTokens === null &&
      stored.outputTokens === null &&
      stored.failureCode === outcome.failureCode
    );
  }
  return (
    stored.inputTokens === outcome.inputTokens &&
    stored.outputTokens === outcome.outputTokens &&
    stored.failureCode === null
  );
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

  async captureProviderOutcome(
    input: Parameters<KnowledgeLlmRunPort['captureProviderOutcome']>[0],
  ): Promise<void> {
    validateCapturedOutcome(input.outcome);
    const capture = async () =>
      serializable(this.host, async (transaction) => {
        const existing = await transaction.$queryRaw<StoredProviderOutcome[]>(
          Prisma.sql`
          SELECT id, "runId", status, "normalizedContent", "contentHash",
            "inputTokens", "outputTokens", "failureCode", "capturedAt",
            "finalizedAt"
          FROM "KnowledgeLlmProviderOutcome"
          WHERE "runId" = ${input.runId}
          FOR UPDATE
        `,
        );
        const runs = await transaction.$queryRaw<
          Array<{
            id: string;
            actorUserId: string;
            estimatedInputTokens: number;
            maxOutputTokens: number;
            executionStatus: string;
            settlementStatus: string;
          }>
        >(Prisma.sql`
          SELECT id, "actorUserId", "estimatedInputTokens", "maxOutputTokens",
            "executionStatus", "settlementStatus"
          FROM "KnowledgeLlmRun"
          WHERE id = ${input.runId}
          FOR UPDATE
        `);
        const run = runs[0];
        if (!run || run.actorUserId !== input.actor.userId) {
          throw new KnowledgeLlmRunAccessError('not_found');
        }
        if (existing.length > 0) {
          if (
            existing.length !== 1 ||
            !existing[0] ||
            !sameCapturedOutcome(existing[0], input.outcome)
          ) {
            throw new Error('knowledge_llm_outcome_conflict');
          }
          return;
        }
        if (
          run.executionStatus !== 'dispatched' ||
          run.settlementStatus !== 'reserved' ||
          (input.outcome.status === 'valid' &&
            (input.outcome.inputTokens > run.estimatedInputTokens ||
              input.outcome.outputTokens > run.maxOutputTokens))
        ) {
          throw new Error('knowledge_llm_outcome_conflict');
        }
        const capturedAt = trustedRunTimestamp(this.clock);
        const content =
          input.outcome.status === 'invalid'
            ? null
            : input.outcome.normalizedContent;
        await transaction.knowledgeLlmProviderOutcome.create({
          data: {
            runId: input.runId,
            status: input.outcome.status,
            normalizedContent: content,
            contentHash:
              content === null
                ? null
                : sha256KnowledgeText('conversation-turn', content),
            inputTokens:
              input.outcome.status === 'valid'
                ? input.outcome.inputTokens
                : null,
            outputTokens:
              input.outcome.status === 'valid'
                ? input.outcome.outputTokens
                : null,
            failureCode:
              input.outcome.status === 'valid'
                ? null
                : input.outcome.failureCode,
            capturedAt,
            createdAt: capturedAt,
          },
        });
      });
    try {
      await capture();
    } catch (error) {
      // A client/driver can lose the commit acknowledgement after PostgreSQL
      // committed. Read back only the exact immutable outcome; a mismatch or
      // absence remains a hard capture failure and is never finalized.
      const stored =
        await this.readClient.knowledgeLlmProviderOutcome.findFirst({
          where: {
            runId: input.runId,
            run: { actorUserId: input.actor.userId },
          },
        });
      if (
        !stored ||
        !sameCapturedOutcome(
          stored as unknown as StoredProviderOutcome,
          input.outcome,
        )
      ) {
        throw error;
      }
    }
  }

  async finalizeCapturedOutcome(
    input: Parameters<KnowledgeLlmRunPort['finalizeCapturedOutcome']>[0],
  ): Promise<KnowledgeLlmRunRecord> {
    return serializable(this.host, async (transaction) => {
      const outcomes = await transaction.$queryRaw<StoredProviderOutcome[]>(
        Prisma.sql`
          SELECT id, "runId", status, "normalizedContent", "contentHash",
            "inputTokens", "outputTokens", "failureCode", "capturedAt",
            "finalizedAt"
          FROM "KnowledgeLlmProviderOutcome"
          WHERE "runId" = ${input.runId}
          FOR UPDATE
        `,
      );
      const outcome = outcomes[0];
      if (!outcome || outcomes.length !== 1) {
        throw new KnowledgeLlmProviderOutcomeMissingError();
      }
      const runs = await transaction.$queryRaw<
        Array<{
          id: string;
          actorUserId: string;
          provider: 'stub' | 'openai';
          model: string;
          executionStatus: string;
          settlementStatus: string;
          inputCostMicrosPerMillion: bigint;
          outputCostMicrosPerMillion: bigint;
        }>
      >(Prisma.sql`
        SELECT id, "actorUserId", provider, model, "executionStatus",
          "settlementStatus", "inputCostMicrosPerMillion",
          "outputCostMicrosPerMillion"
        FROM "KnowledgeLlmRun"
        WHERE id = ${input.runId}
        FOR UPDATE
      `);
      const run = runs[0];
      if (!run || run.actorUserId !== input.actor.userId) {
        throw new KnowledgeLlmRunAccessError('not_found');
      }
      if (
        outcome.finalizedAt !== null ||
        (outcome.status === 'invalid' &&
          run.executionStatus === 'failed' &&
          run.settlementStatus === 'held_maximum')
      ) {
        const existing = await transaction.knowledgeLlmRun.findUniqueOrThrow({
          where: { id: run.id },
          include: runInclude,
        });
        if (
          !['result_ready', 'failed'].includes(existing.executionStatus) ||
          !['settled_actual', 'held_maximum'].includes(
            existing.settlementStatus,
          )
        ) {
          throw new Error('knowledge_llm_finalization_conflict');
        }
        return mapRun(existing);
      }
      const recoverHeld =
        run.executionStatus === 'result_unknown' &&
        run.settlementStatus === 'held_maximum';
      if (
        !recoverHeld &&
        !(
          run.executionStatus === 'dispatched' &&
          run.settlementStatus === 'reserved'
        )
      ) {
        throw new Error('knowledge_llm_finalization_conflict');
      }
      const prompts = await transaction.$queryRaw<
        Array<{
          normalizedPrompt: string | null;
          promptHash: string;
          finalizedAt: Date | null;
        }>
      >(Prisma.sql`
        SELECT "normalizedPrompt", "promptHash", "finalizedAt"
        FROM "KnowledgeLlmPromptSnapshot"
        WHERE "runId" = ${input.runId}
        FOR UPDATE
      `);
      const prompt = prompts[0];
      if (
        !prompt ||
        prompts.length !== 1 ||
        prompt.finalizedAt !== null ||
        prompt.normalizedPrompt === null ||
        prompt.promptHash !==
          sha256KnowledgeText('llm-user-prompt', prompt.normalizedPrompt)
      ) {
        throw new Error('knowledge_llm_prompt_snapshot_invalid');
      }

      let conversationId: string | null = null;
      let assistantTurnId: string | null = null;
      if (outcome.status !== 'invalid') {
        if (
          outcome.normalizedContent === null ||
          outcome.contentHash !==
            sha256KnowledgeText(
              'conversation-turn',
              outcome.normalizedContent,
            ) ||
          (outcome.status === 'valid' &&
            (outcome.inputTokens === null || outcome.outputTokens === null)) ||
          (outcome.status === 'usage_unknown' &&
            (outcome.inputTokens !== null || outcome.outputTokens !== null))
        ) {
          throw new Error('knowledge_llm_outcome_invalid');
        }
        const created = await createResultConversation(transaction, {
          runId: run.id,
          provider: run.provider,
          model: run.model,
          actorUserId: input.actor.userId,
          userPrompt: prompt.normalizedPrompt,
          resultContent: outcome.normalizedContent,
          capturedAt: outcome.capturedAt,
        });
        conversationId = created.conversation.id;
        assistantTurnId = created.assistant.id;
      } else if (
        outcome.normalizedContent !== null ||
        outcome.contentHash !== null ||
        outcome.inputTokens !== null ||
        outcome.outputTokens !== null
      ) {
        throw new Error('knowledge_llm_outcome_invalid');
      }
      const finalizedAt = trustedRunTimestamp(this.clock);
      if (outcome.status !== 'invalid') {
        await transaction.knowledgeLlmProviderOutcome.update({
          where: { runId: run.id },
          data: { normalizedContent: null, finalizedAt },
        });
      }
      const scrubbed = await transaction.$executeRaw(Prisma.sql`
        UPDATE "KnowledgeLlmPromptSnapshot"
        SET "normalizedPrompt" = NULL, "finalizedAt" = ${finalizedAt}
        WHERE "runId" = ${run.id}
          AND "normalizedPrompt" IS NOT NULL
          AND "finalizedAt" IS NULL
      `);
      if (scrubbed !== 1) {
        throw new Error('knowledge_llm_prompt_snapshot_invalid');
      }
      const auditActor = knowledgeProvenanceAuditActor(
        input.actor,
        input.auditActor,
      );
      if (outcome.status === 'valid') {
        if (
          outcome.inputTokens === null ||
          outcome.outputTokens === null ||
          !conversationId ||
          !assistantTurnId
        ) {
          throw new Error('knowledge_llm_outcome_invalid');
        }
        const actualCostMicros =
          ceilCostMicros(outcome.inputTokens, run.inputCostMicrosPerMillion) +
          ceilCostMicros(outcome.outputTokens, run.outputCostMicrosPerMillion);
        if (recoverHeld) {
          await reconcileKnowledgeLlmHeldBudget(
            transaction,
            {
              runId: run.id,
              actorUserId: input.actor.userId,
              auditActor,
              actualInputTokens: outcome.inputTokens,
              actualOutputTokens: outcome.outputTokens,
              actualCostMicros,
              conversationId,
              assistantTurnId,
            },
            this.clock,
          );
        } else {
          await settleKnowledgeLlmBudget(
            transaction,
            {
              runId: run.id,
              actorUserId: input.actor.userId,
              auditActor,
              settlement: {
                type: 'actual',
                actualInputTokens: outcome.inputTokens,
                actualOutputTokens: outcome.outputTokens,
                actualCostMicros,
                conversationId,
                assistantTurnId,
              },
            },
            this.clock,
          );
        }
      } else if (outcome.status === 'usage_unknown') {
        if (
          (outcome.failureCode !== 'usage_missing' &&
            outcome.failureCode !== 'usage_invalid') ||
          !conversationId ||
          !assistantTurnId
        ) {
          throw new Error('knowledge_llm_outcome_invalid');
        }
        if (recoverHeld) {
          await reconcileKnowledgeLlmHeldOutcome(
            transaction,
            {
              runId: run.id,
              actorUserId: input.actor.userId,
              auditActor,
              settlement: {
                type: 'usage_unknown',
                failureCode: outcome.failureCode,
                conversationId,
                assistantTurnId,
              },
            },
            this.clock,
          );
        } else {
          await settleKnowledgeLlmBudget(
            transaction,
            {
              runId: run.id,
              actorUserId: input.actor.userId,
              auditActor,
              settlement: {
                type: 'hold',
                executionStatus: 'result_ready',
                failureCode: outcome.failureCode,
                conversationId,
                assistantTurnId,
              },
            },
            this.clock,
          );
        }
      } else {
        const failureCodes = new Set([
          'provider_4xx',
          'provider_5xx',
          'malformed_response',
          'response_oversize',
          'empty_result',
        ] as const);
        if (
          !outcome.failureCode ||
          !failureCodes.has(outcome.failureCode as never)
        ) {
          throw new Error('knowledge_llm_outcome_invalid');
        }
        const failureCode = outcome.failureCode as
          | 'provider_4xx'
          | 'provider_5xx'
          | 'malformed_response'
          | 'response_oversize'
          | 'empty_result';
        if (recoverHeld) {
          await reconcileKnowledgeLlmHeldOutcome(
            transaction,
            {
              runId: run.id,
              actorUserId: input.actor.userId,
              auditActor,
              settlement: { type: 'failed', failureCode },
            },
            this.clock,
          );
        } else {
          await settleKnowledgeLlmBudget(
            transaction,
            {
              runId: run.id,
              actorUserId: input.actor.userId,
              auditActor,
              settlement: {
                type: 'hold',
                executionStatus: 'failed',
                failureCode,
              },
            },
            this.clock,
          );
        }
      }
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
    try {
      await this.finalizeCapturedOutcome(input);
      return;
    } catch (error) {
      if (!(error instanceof KnowledgeLlmProviderOutcomeMissingError)) {
        throw error;
      }
    }
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
