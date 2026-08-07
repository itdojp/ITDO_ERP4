import type {
  KnowledgeActor,
  KnowledgeAuditActorContext,
  KnowledgeItemScope,
} from './knowledgeItemPorts.js';
import { knowledgeItemScopes } from './knowledgeItemPorts.js';
import {
  knowledgeProvenanceLimits,
  knowledgeSynthesisSourceKinds,
  knowledgeSynthesisSourceRelationTypes,
  type KnowledgePageBoundary,
  type KnowledgeProvenanceUnitOfWork,
  type KnowledgeSynthesisRepository,
  type KnowledgeSynthesisSourceInput,
} from './knowledgeProvenancePorts.js';
import {
  hasKnowledgePrincipal,
  isAllowedKnowledgeValue,
  isBoundedKnowledgeId,
  isValidKnowledgeListLimit,
  isValidKnowledgeSequence,
  isValidKnowledgeVersion,
  knowledgeProvenanceAuditActor,
  normalizeBoundedContent,
  normalizeBoundedText,
  provenanceConflict,
  provenanceInvalid,
  provenanceNotFound,
  provenanceOk,
  runKnowledgeProvenanceMutation,
  type KnowledgeProvenanceResult,
} from './knowledgeProvenanceValidation.js';
import {
  createSynthesisAccessContext,
  KnowledgeSynthesisAccessBudgetError,
} from './knowledgeSynthesisAccessContext.js';

function normalizeQuestions(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length > knowledgeProvenanceLimits.unresolvedQuestions
  ) {
    return null;
  }
  const questions = value.map((question) =>
    normalizeBoundedText(
      question,
      knowledgeProvenanceLimits.unresolvedQuestion,
    ),
  );
  if (questions.some((question) => question === null)) return null;
  return questions as string[];
}

function normalizeSources(
  value: unknown,
): KnowledgeSynthesisSourceInput[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > knowledgeProvenanceLimits.sources
  ) {
    return null;
  }
  const sources: KnowledgeSynthesisSourceInput[] = [];
  const unique = new Set<string>();
  for (const candidate of value) {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      return null;
    }
    const record = candidate as Record<string, unknown>;
    if (
      Object.keys(record).some(
        (key) => !['kind', 'sourceId', 'relationType'].includes(key),
      ) ||
      !isAllowedKnowledgeValue(knowledgeSynthesisSourceKinds, record.kind) ||
      !isBoundedKnowledgeId(record.sourceId) ||
      !isAllowedKnowledgeValue(
        knowledgeSynthesisSourceRelationTypes,
        record.relationType,
      )
    ) {
      return null;
    }
    const identity = `${record.kind}\0${record.sourceId}`;
    if (unique.has(identity)) return null;
    unique.add(identity);
    sources.push({
      kind: record.kind,
      sourceId: record.sourceId,
      relationType: record.relationType,
    });
  }
  return sources;
}

function normalizeConfidence(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > knowledgeProvenanceLimits.confidenceBasisPoints
  ) {
    return undefined;
  }
  return value;
}

function resolveOrganizationId(
  actor: KnowledgeActor,
  scope: KnowledgeItemScope,
): string | null | undefined {
  if (scope === 'personal') return null;
  const organizationId = actor.organizationId?.trim();
  return organizationId ? organizationId : undefined;
}

export type KnowledgeSynthesisService = ReturnType<
  typeof createKnowledgeSynthesisService
>;

export function createKnowledgeSynthesisService(dependencies: {
  reader: KnowledgeSynthesisRepository;
  unitOfWork: KnowledgeProvenanceUnitOfWork;
}) {
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
      try {
        return provenanceOk(
          await dependencies.reader.withConsistentSnapshot((reader) =>
            reader.listVisible({
              ...input,
              accessContext: createSynthesisAccessContext(),
            }),
          ),
        );
      } catch (error) {
        if (error instanceof KnowledgeSynthesisAccessBudgetError) {
          return provenanceOk({ items: [], nextBoundary: null });
        }
        throw error;
      }
    },

    async detail(input: { actor: KnowledgeActor; synthesisId: string }) {
      if (
        !hasKnowledgePrincipal(input.actor) ||
        !isBoundedKnowledgeId(input.synthesisId)
      ) {
        return provenanceNotFound();
      }
      try {
        const synthesis = await dependencies.reader.withConsistentSnapshot(
          (reader) =>
            reader.findVisible({
              ...input,
              accessContext: createSynthesisAccessContext(),
            }),
        );
        return synthesis ? provenanceOk(synthesis) : provenanceNotFound();
      } catch (error) {
        if (error instanceof KnowledgeSynthesisAccessBudgetError) {
          return provenanceNotFound();
        }
        throw error;
      }
    },

    async history(input: {
      actor: KnowledgeActor;
      synthesisId: string;
      limit: number;
      beforeVersion?: number;
    }) {
      if (
        !hasKnowledgePrincipal(input.actor) ||
        !isBoundedKnowledgeId(input.synthesisId) ||
        !isValidKnowledgeListLimit(input.limit) ||
        (input.beforeVersion !== undefined &&
          !isValidKnowledgeSequence(input.beforeVersion))
      ) {
        return provenanceNotFound();
      }
      try {
        const page = await dependencies.reader.withConsistentSnapshot(
          (reader) =>
            reader.listVersionsVisible({
              ...input,
              accessContext: createSynthesisAccessContext(),
            }),
        );
        return page ? provenanceOk(page) : provenanceNotFound();
      } catch (error) {
        if (error instanceof KnowledgeSynthesisAccessBudgetError) {
          return provenanceNotFound();
        }
        throw error;
      }
    },

    async create(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      body: {
        scope: KnowledgeItemScope;
        title: string;
        content: string;
        unresolvedQuestions?: string[];
        confidenceBasisPoints?: number | null;
        sources: KnowledgeSynthesisSourceInput[];
      };
    }): Promise<KnowledgeProvenanceResult<unknown>> {
      if (!hasKnowledgePrincipal(input.actor)) return provenanceNotFound();
      const title = normalizeBoundedText(
        input.body?.title,
        knowledgeProvenanceLimits.title,
      );
      const content = normalizeBoundedContent(
        input.body?.content,
        knowledgeProvenanceLimits.synthesisContentBytes,
      );
      const questions = normalizeQuestions(
        input.body?.unresolvedQuestions === undefined
          ? []
          : input.body.unresolvedQuestions,
      );
      const confidence = normalizeConfidence(input.body?.confidenceBasisPoints);
      const sources = normalizeSources(input.body?.sources);
      if (
        !isAllowedKnowledgeValue(knowledgeItemScopes, input.body?.scope) ||
        !title ||
        !content ||
        !questions ||
        confidence === undefined ||
        !sources
      ) {
        return provenanceInvalid('synthesis input is invalid');
      }
      const organizationId = resolveOrganizationId(
        input.actor,
        input.body.scope,
      );
      if (organizationId === undefined) {
        return provenanceInvalid(
          'organization scope requires organization context',
        );
      }

      return runKnowledgeProvenanceMutation(() =>
        dependencies.unitOfWork.run(async (transaction) => {
          const accessContext = createSynthesisAccessContext();
          if (
            !(await transaction.syntheses.validateSources({
              actor: input.actor,
              sources,
              accessContext,
            }))
          ) {
            return provenanceNotFound();
          }
          const detail = await transaction.syntheses.create({
            actor: input.actor,
            scope: input.body.scope,
            organizationId,
            title,
            content,
            unresolvedQuestions: questions,
            confidenceBasisPoints: confidence,
            sources,
            accessContext,
          });
          const auditActor = knowledgeProvenanceAuditActor(
            input.actor,
            input.auditActor,
          );
          await transaction.audit.write({
            action: 'knowledge_synthesis_created',
            actor: auditActor,
            targetTable: 'knowledge_syntheses',
            targetId: detail.synthesis.id,
            metadata: {
              scope: detail.synthesis.scope,
              sourceCount: sources.length,
              version: detail.synthesis.currentVersion,
            },
          });
          for (const source of sources) {
            await transaction.audit.write({
              action: 'knowledge_synthesis_source_linked',
              actor: auditActor,
              targetTable: 'knowledge_syntheses',
              targetId: detail.synthesis.id,
              metadata: {
                relationType: source.relationType,
                sourceKind: source.kind,
                version: detail.synthesis.currentVersion,
              },
            });
          }
          return provenanceOk(detail);
        }),
      );
    },

    async appendVersion(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      synthesisId: string;
      body: {
        expectedVersion: number;
        content: string;
        unresolvedQuestions?: string[];
        confidenceBasisPoints?: number | null;
        sources: KnowledgeSynthesisSourceInput[];
      };
    }): Promise<KnowledgeProvenanceResult<unknown>> {
      if (
        !hasKnowledgePrincipal(input.actor) ||
        !isBoundedKnowledgeId(input.synthesisId)
      ) {
        return provenanceNotFound();
      }
      const content = normalizeBoundedContent(
        input.body?.content,
        knowledgeProvenanceLimits.synthesisContentBytes,
      );
      const questions = normalizeQuestions(
        input.body?.unresolvedQuestions === undefined
          ? []
          : input.body.unresolvedQuestions,
      );
      const confidence = normalizeConfidence(input.body?.confidenceBasisPoints);
      const sources = normalizeSources(input.body?.sources);
      if (
        !isValidKnowledgeVersion(input.body?.expectedVersion) ||
        !content ||
        !questions ||
        confidence === undefined ||
        !sources
      ) {
        return provenanceInvalid('synthesis version input is invalid');
      }
      return runKnowledgeProvenanceMutation(() =>
        dependencies.unitOfWork.run(async (transaction) => {
          const accessContext = createSynthesisAccessContext();
          const current = await transaction.syntheses.findOwned({
            actor: input.actor,
            synthesisId: input.synthesisId,
            accessContext,
          });
          if (!current) return provenanceNotFound();
          if (current.synthesis.currentVersion !== input.body.expectedVersion) {
            return provenanceConflict();
          }
          if (
            !(await transaction.syntheses.validateSources({
              actor: input.actor,
              sources,
              accessContext,
              excludedSynthesisId: current.synthesis.id,
            }))
          ) {
            return provenanceNotFound();
          }
          const detail = await transaction.syntheses.appendVersion({
            actor: input.actor,
            synthesisId: input.synthesisId,
            expectedVersion: input.body.expectedVersion,
            content,
            unresolvedQuestions: questions,
            confidenceBasisPoints: confidence,
            sources,
            accessContext,
          });
          if (!detail) return provenanceConflict();
          const auditActor = knowledgeProvenanceAuditActor(
            input.actor,
            input.auditActor,
          );
          await transaction.audit.write({
            action: 'knowledge_synthesis_version_appended',
            actor: auditActor,
            targetTable: 'knowledge_syntheses',
            targetId: detail.synthesis.id,
            metadata: {
              scope: detail.synthesis.scope,
              sourceCount: sources.length,
              version: detail.synthesis.currentVersion,
            },
          });
          for (const source of sources) {
            await transaction.audit.write({
              action: 'knowledge_synthesis_source_linked',
              actor: auditActor,
              targetTable: 'knowledge_syntheses',
              targetId: detail.synthesis.id,
              metadata: {
                relationType: source.relationType,
                sourceKind: source.kind,
                version: detail.synthesis.currentVersion,
              },
            });
          }
          return provenanceOk(detail);
        }),
      );
    },
  };
}
