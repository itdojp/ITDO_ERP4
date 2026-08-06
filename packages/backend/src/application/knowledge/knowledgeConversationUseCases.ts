import type {
  KnowledgeActor,
  KnowledgeAuditActorContext,
} from './knowledgeItemPorts.js';
import {
  knowledgeConversationItemRelationTypes,
  knowledgeConversationRoles,
  knowledgeConversationSourceTypes,
  knowledgeProvenanceLimits,
  knowledgeProvenanceOrigins,
  type KnowledgeConversationItemRelationType,
  type KnowledgeConversationRepository,
  type KnowledgeConversationRole,
  type KnowledgeConversationSourceType,
  type KnowledgePageBoundary,
  type KnowledgeProvenanceOrigin,
  type KnowledgeProvenanceUnitOfWork,
  type KnowledgeSequenceBoundary,
} from './knowledgeProvenancePorts.js';
import {
  hasKnowledgePrincipal,
  isAllowedKnowledgeValue,
  isBoundedKnowledgeId,
  isRoleOriginCompatible,
  isValidKnowledgeListLimit,
  isValidKnowledgeVersion,
  knowledgeProvenanceAuditActor,
  normalizeBoundedContent,
  normalizeBoundedText,
  normalizeOptionalProvenanceLabel,
  parseOptionalKnowledgeDate,
  provenanceConflict,
  provenanceInvalid,
  provenanceNotFound,
  provenanceOk,
  runKnowledgeProvenanceMutation,
  sha256KnowledgeText,
  type KnowledgeProvenanceResult,
} from './knowledgeProvenanceValidation.js';

function initialConversationHash(input: {
  title: string;
  sourceType: KnowledgeConversationSourceType;
  provider: string | null;
  model: string | null;
  capturedAt: Date;
}): string {
  return sha256KnowledgeText(
    'conversation',
    JSON.stringify({
      capturedAt: input.capturedAt.toISOString(),
      model: input.model,
      provider: input.provider,
      sourceType: input.sourceType,
      title: input.title,
      turns: [],
    }),
  );
}

function aggregateConversationHash(input: {
  currentHash: string;
  sequence: number;
  role: KnowledgeConversationRole;
  origin: KnowledgeProvenanceOrigin;
  name: string | null;
  occurredAt: Date | null;
  contentHash: string;
}): string {
  return sha256KnowledgeText(
    'conversation-append',
    JSON.stringify({
      contentHash: input.contentHash,
      currentHash: input.currentHash,
      name: input.name,
      occurredAt: input.occurredAt?.toISOString() ?? null,
      origin: input.origin,
      role: input.role,
      sequence: input.sequence,
    }),
  );
}

export type KnowledgeConversationService = ReturnType<
  typeof createKnowledgeConversationService
>;

export function createKnowledgeConversationService(dependencies: {
  reader: KnowledgeConversationRepository;
  unitOfWork: KnowledgeProvenanceUnitOfWork;
  now?: () => Date;
}) {
  const now = dependencies.now ?? (() => new Date());

  return {
    async list(input: {
      actor: KnowledgeActor;
      limit: number;
      boundary?: KnowledgePageBoundary;
    }) {
      if (
        !hasKnowledgePrincipal(input.actor) ||
        !isValidKnowledgeListLimit(input.limit)
      ) {
        return provenanceOk({ items: [], nextBoundary: null });
      }
      return provenanceOk(await dependencies.reader.listVisible(input));
    },

    async detail(input: { actor: KnowledgeActor; conversationId: string }) {
      if (
        !hasKnowledgePrincipal(input.actor) ||
        !isBoundedKnowledgeId(input.conversationId)
      ) {
        return provenanceNotFound();
      }
      const conversation = await dependencies.reader.findVisible(input);
      return conversation ? provenanceOk(conversation) : provenanceNotFound();
    },

    async create(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      body: {
        title: string;
        sourceType?: KnowledgeConversationSourceType;
        provider?: string | null;
        model?: string | null;
        capturedAt?: string | null;
      };
    }): Promise<KnowledgeProvenanceResult<unknown>> {
      if (!hasKnowledgePrincipal(input.actor)) return provenanceNotFound();
      const title = normalizeBoundedText(
        input.body?.title,
        knowledgeProvenanceLimits.title,
      );
      const sourceType = input.body?.sourceType ?? 'manual';
      const provider = normalizeOptionalProvenanceLabel(
        input.body?.provider,
        knowledgeProvenanceLimits.provider,
      );
      const model = normalizeOptionalProvenanceLabel(
        input.body?.model,
        knowledgeProvenanceLimits.model,
      );
      const capturedAt = parseOptionalKnowledgeDate(input.body?.capturedAt);
      if (
        !title ||
        !isAllowedKnowledgeValue(
          knowledgeConversationSourceTypes,
          sourceType,
        ) ||
        sourceType !== 'manual' ||
        provider === undefined ||
        model === undefined ||
        capturedAt === undefined
      ) {
        return provenanceInvalid('conversation metadata is invalid');
      }
      const effectiveCapturedAt = capturedAt ?? now();
      const contentHash = initialConversationHash({
        title,
        sourceType,
        provider,
        model,
        capturedAt: effectiveCapturedAt,
      });
      return runKnowledgeProvenanceMutation(() =>
        dependencies.unitOfWork.run(async (transaction) => {
          const conversation = await transaction.conversations.create({
            actor: input.actor,
            title,
            sourceType,
            provider,
            model,
            capturedAt: effectiveCapturedAt,
            contentHash,
          });
          await transaction.audit.write({
            action: 'knowledge_conversation_created',
            actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
            targetTable: 'knowledge_conversations',
            targetId: conversation.id,
            metadata: {
              format: sourceType,
              itemCount: 0,
              turnCount: 0,
              version: conversation.version,
            },
          });
          return provenanceOk(conversation);
        }),
      );
    },

    async addItem(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      conversationId: string;
      body: {
        itemId: string;
        relationType: KnowledgeConversationItemRelationType;
        ordinal: number;
        expectedVersion: number;
      };
    }): Promise<KnowledgeProvenanceResult<unknown>> {
      if (
        !hasKnowledgePrincipal(input.actor) ||
        !isBoundedKnowledgeId(input.conversationId) ||
        !isBoundedKnowledgeId(input.body?.itemId)
      ) {
        return provenanceNotFound();
      }
      if (
        !isAllowedKnowledgeValue(
          knowledgeConversationItemRelationTypes,
          input.body?.relationType,
        ) ||
        !Number.isInteger(input.body?.ordinal) ||
        input.body.ordinal < 0 ||
        input.body.ordinal >= knowledgeProvenanceLimits.conversationItems ||
        !isValidKnowledgeVersion(input.body?.expectedVersion)
      ) {
        return provenanceInvalid('conversation item relation is invalid');
      }
      return runKnowledgeProvenanceMutation(() =>
        dependencies.unitOfWork.run(async (transaction) => {
          const conversation = await transaction.conversations.findOwned({
            actor: input.actor,
            conversationId: input.conversationId,
          });
          if (!conversation) return provenanceNotFound();
          if (conversation.version !== input.body.expectedVersion) {
            return provenanceConflict();
          }
          if (
            conversation.items.length >=
            knowledgeProvenanceLimits.conversationItems
          ) {
            return provenanceInvalid('conversation item limit exceeded');
          }
          const item = await transaction.access.findOwnedItem(
            input.actor,
            input.body.itemId,
          );
          if (!item || item.ownerUserId !== conversation.ownerUserId) {
            return provenanceNotFound();
          }
          const updated = await transaction.conversations.addItem({
            actor: input.actor,
            conversationId: input.conversationId,
            itemId: input.body.itemId,
            relationType: input.body.relationType,
            ordinal: input.body.ordinal,
            expectedVersion: input.body.expectedVersion,
          });
          if (!updated) return provenanceConflict();
          await transaction.audit.write({
            action: 'knowledge_conversation_item_linked',
            actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
            targetTable: 'knowledge_conversations',
            targetId: updated.id,
            metadata: {
              relationType: input.body.relationType,
              itemCount: updated.items.length,
              version: updated.version,
            },
          });
          return provenanceOk(updated);
        }),
      );
    },

    async removeItem(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      conversationId: string;
      itemId: string;
      expectedVersion: number;
    }): Promise<KnowledgeProvenanceResult<unknown>> {
      if (
        !hasKnowledgePrincipal(input.actor) ||
        !isBoundedKnowledgeId(input.conversationId) ||
        !isBoundedKnowledgeId(input.itemId)
      ) {
        return provenanceNotFound();
      }
      if (!isValidKnowledgeVersion(input.expectedVersion)) {
        return provenanceInvalid('expectedVersion is invalid');
      }
      return runKnowledgeProvenanceMutation(() =>
        dependencies.unitOfWork.run(async (transaction) => {
          const conversation = await transaction.conversations.findOwned({
            actor: input.actor,
            conversationId: input.conversationId,
          });
          if (!conversation) return provenanceNotFound();
          if (conversation.version !== input.expectedVersion) {
            return provenanceConflict();
          }
          if (
            !conversation.items.some(
              (item) => item.knowledgeItemId === input.itemId,
            )
          ) {
            return provenanceNotFound();
          }
          const updated = await transaction.conversations.removeItem({
            actor: input.actor,
            conversationId: input.conversationId,
            itemId: input.itemId,
            expectedVersion: input.expectedVersion,
          });
          if (!updated) return provenanceConflict();
          await transaction.audit.write({
            action: 'knowledge_conversation_item_unlinked',
            actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
            targetTable: 'knowledge_conversations',
            targetId: updated.id,
            metadata: {
              itemCount: updated.items.length,
              version: updated.version,
            },
          });
          return provenanceOk(updated);
        }),
      );
    },

    async listTurns(input: {
      actor: KnowledgeActor;
      conversationId: string;
      limit: number;
      boundary?: KnowledgeSequenceBoundary;
    }) {
      if (
        !hasKnowledgePrincipal(input.actor) ||
        !isBoundedKnowledgeId(input.conversationId) ||
        !isValidKnowledgeListLimit(input.limit)
      ) {
        return provenanceNotFound();
      }
      const page = await dependencies.reader.listTurnsVisible(input);
      return page ? provenanceOk(page) : provenanceNotFound();
    },

    async appendTurn(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      conversationId: string;
      body: {
        expectedVersion: number;
        role: KnowledgeConversationRole;
        origin: KnowledgeProvenanceOrigin;
        content: string;
        name?: string | null;
        occurredAt?: string | null;
      };
    }): Promise<KnowledgeProvenanceResult<unknown>> {
      if (
        !hasKnowledgePrincipal(input.actor) ||
        !isBoundedKnowledgeId(input.conversationId)
      ) {
        return provenanceNotFound();
      }
      if (
        !isValidKnowledgeVersion(input.body?.expectedVersion) ||
        !isAllowedKnowledgeValue(
          knowledgeConversationRoles,
          input.body?.role,
        ) ||
        !isAllowedKnowledgeValue(
          knowledgeProvenanceOrigins,
          input.body?.origin,
        ) ||
        !isRoleOriginCompatible(input.body.role, input.body.origin)
      ) {
        return provenanceInvalid('conversation turn role or origin is invalid');
      }
      const content = normalizeBoundedContent(
        input.body?.content,
        knowledgeProvenanceLimits.conversationTurnBytes,
      );
      const name = normalizeOptionalProvenanceLabel(
        input.body?.name,
        knowledgeProvenanceLimits.name,
      );
      const occurredAt = parseOptionalKnowledgeDate(input.body?.occurredAt);
      if (!content || name === undefined || occurredAt === undefined) {
        return provenanceInvalid('conversation turn content is invalid');
      }
      const contentHash = sha256KnowledgeText('conversation-turn', content);
      return runKnowledgeProvenanceMutation(() =>
        dependencies.unitOfWork.run(async (transaction) => {
          const conversation = await transaction.conversations.findOwned({
            actor: input.actor,
            conversationId: input.conversationId,
          });
          if (!conversation) return provenanceNotFound();
          if (conversation.version !== input.body.expectedVersion) {
            return provenanceConflict();
          }
          const sequence = await transaction.conversations.nextTurnSequence(
            conversation.id,
          );
          if (sequence > knowledgeProvenanceLimits.conversationTurns) {
            return provenanceInvalid('conversation turn limit exceeded');
          }
          const aggregateContentHash = aggregateConversationHash({
            currentHash: conversation.contentHash,
            sequence,
            role: input.body.role,
            origin: input.body.origin,
            name,
            occurredAt,
            contentHash,
          });
          const result = await transaction.conversations.appendTurn({
            actor: input.actor,
            conversationId: input.conversationId,
            expectedVersion: input.body.expectedVersion,
            sequence,
            role: input.body.role,
            origin: input.body.origin,
            content,
            name,
            occurredAt,
            contentHash,
            aggregateContentHash,
          });
          if (!result) return provenanceConflict();
          await transaction.audit.write({
            action: 'knowledge_conversation_turn_appended',
            actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
            targetTable: 'knowledge_conversations',
            targetId: result.conversation.id,
            metadata: {
              origin: result.turn.origin,
              role: result.turn.role,
              turnCount: result.turn.sequence,
              version: result.conversation.version,
            },
          });
          return provenanceOk(result);
        }),
      );
    },
  };
}
