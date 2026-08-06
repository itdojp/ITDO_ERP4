import type {
  KnowledgeActor,
  KnowledgeAuditActorContext,
} from './knowledgeItemPorts.js';
import {
  knowledgeAnnotationKinds,
  knowledgeProvenanceLimits,
  knowledgeProvenanceOrigins,
  type KnowledgeAnnotationKind,
  type KnowledgeAnnotationRepository,
  type KnowledgePageBoundary,
  type KnowledgeProvenanceOrigin,
  type KnowledgeProvenanceUnitOfWork,
} from './knowledgeProvenancePorts.js';
import {
  hasKnowledgePrincipal,
  isAllowedKnowledgeValue,
  isBoundedKnowledgeId,
  isValidKnowledgeListLimit,
  isValidKnowledgeVersion,
  knowledgeProvenanceAuditActor,
  normalizeBoundedContent,
  provenanceConflict,
  provenanceInvalid,
  provenanceNotFound,
  provenanceOk,
  runKnowledgeProvenanceMutation,
  type KnowledgeProvenanceResult,
} from './knowledgeProvenanceValidation.js';

export type KnowledgeAnnotationService = ReturnType<
  typeof createKnowledgeAnnotationService
>;

export function createKnowledgeAnnotationService(dependencies: {
  reader: KnowledgeAnnotationRepository;
  unitOfWork: KnowledgeProvenanceUnitOfWork;
  now?: () => Date;
}) {
  const now = dependencies.now ?? (() => new Date());

  return {
    async list(input: {
      actor: KnowledgeActor;
      itemId: string;
      limit: number;
      boundary?: KnowledgePageBoundary;
    }) {
      if (
        !hasKnowledgePrincipal(input.actor) ||
        !isBoundedKnowledgeId(input.itemId) ||
        !isValidKnowledgeListLimit(input.limit)
      ) {
        return provenanceNotFound();
      }
      const page = await dependencies.reader.withConsistentSnapshot((reader) =>
        reader.listVisible(input),
      );
      return page ? provenanceOk(page) : provenanceNotFound();
    },

    async detail(input: {
      actor: KnowledgeActor;
      itemId: string;
      annotationId: string;
    }) {
      if (
        !hasKnowledgePrincipal(input.actor) ||
        !isBoundedKnowledgeId(input.itemId) ||
        !isBoundedKnowledgeId(input.annotationId)
      ) {
        return provenanceNotFound();
      }
      const annotation = await dependencies.reader.withConsistentSnapshot(
        (reader) => reader.findVisible(input),
      );
      return annotation ? provenanceOk(annotation) : provenanceNotFound();
    },

    async history(input: {
      actor: KnowledgeActor;
      itemId: string;
      annotationId: string;
      limit: number;
      beforeRevision?: number;
    }) {
      if (
        !hasKnowledgePrincipal(input.actor) ||
        !isBoundedKnowledgeId(input.itemId) ||
        !isBoundedKnowledgeId(input.annotationId) ||
        !isValidKnowledgeListLimit(input.limit) ||
        (input.beforeRevision !== undefined &&
          !isValidKnowledgeVersion(input.beforeRevision))
      ) {
        return provenanceNotFound();
      }
      const page = await dependencies.reader.withConsistentSnapshot((reader) =>
        reader.listRevisionsVisible(input),
      );
      return page ? provenanceOk(page) : provenanceNotFound();
    },

    async create(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      itemId: string;
      body: {
        kind: KnowledgeAnnotationKind;
        origin: KnowledgeProvenanceOrigin;
        content: string;
      };
    }): Promise<KnowledgeProvenanceResult<unknown>> {
      if (
        !hasKnowledgePrincipal(input.actor) ||
        !isBoundedKnowledgeId(input.itemId)
      ) {
        return provenanceNotFound();
      }
      if (
        !isAllowedKnowledgeValue(knowledgeAnnotationKinds, input.body?.kind) ||
        !isAllowedKnowledgeValue(knowledgeProvenanceOrigins, input.body?.origin)
      ) {
        return provenanceInvalid('annotation kind or origin is invalid');
      }
      const content = normalizeBoundedContent(
        input.body?.content,
        knowledgeProvenanceLimits.annotationContentBytes,
      );
      if (!content) return provenanceInvalid('annotation content is invalid');

      return runKnowledgeProvenanceMutation(() =>
        dependencies.unitOfWork.run(async (transaction) => {
          const item = await transaction.access.findOwnedItem(
            input.actor,
            input.itemId,
          );
          if (!item) return provenanceNotFound();
          const annotation = await transaction.annotations.create({
            item,
            actor: input.actor,
            kind: input.body.kind,
            origin: input.body.origin,
            content,
          });
          await transaction.audit.write({
            action: 'knowledge_annotation_created',
            actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
            targetTable: 'knowledge_annotations',
            targetId: annotation.id,
            metadata: {
              annotationKind: annotation.kind,
              origin: annotation.origin,
              revision: annotation.currentRevision,
              scope: annotation.scope,
            },
          });
          return provenanceOk(annotation);
        }),
      );
    },

    async revise(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      itemId: string;
      annotationId: string;
      body: {
        expectedRevision: number;
        kind: KnowledgeAnnotationKind;
        origin: KnowledgeProvenanceOrigin;
        content: string;
      };
    }): Promise<KnowledgeProvenanceResult<unknown>> {
      if (
        !hasKnowledgePrincipal(input.actor) ||
        !isBoundedKnowledgeId(input.itemId) ||
        !isBoundedKnowledgeId(input.annotationId)
      ) {
        return provenanceNotFound();
      }
      if (
        !isValidKnowledgeVersion(input.body?.expectedRevision) ||
        !isAllowedKnowledgeValue(knowledgeAnnotationKinds, input.body?.kind) ||
        !isAllowedKnowledgeValue(knowledgeProvenanceOrigins, input.body?.origin)
      ) {
        return provenanceInvalid('annotation revision is invalid');
      }
      const content = normalizeBoundedContent(
        input.body?.content,
        knowledgeProvenanceLimits.annotationContentBytes,
      );
      if (!content) return provenanceInvalid('annotation content is invalid');

      return runKnowledgeProvenanceMutation(() =>
        dependencies.unitOfWork.run(async (transaction) => {
          const current = await transaction.annotations.findOwned({
            actor: input.actor,
            itemId: input.itemId,
            annotationId: input.annotationId,
            deleted: false,
          });
          if (!current) return provenanceNotFound();
          if (current.currentRevision !== input.body.expectedRevision) {
            return provenanceConflict();
          }
          if (
            current.kind === input.body.kind &&
            current.origin === input.body.origin &&
            current.revision.content === content
          ) {
            return provenanceInvalid('annotation revision must change content');
          }
          const annotation = await transaction.annotations.revise({
            actor: input.actor,
            annotationId: input.annotationId,
            expectedRevision: input.body.expectedRevision,
            kind: input.body.kind,
            origin: input.body.origin,
            content,
          });
          if (!annotation) return provenanceConflict();
          await transaction.audit.write({
            action: 'knowledge_annotation_revised',
            actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
            targetTable: 'knowledge_annotations',
            targetId: annotation.id,
            metadata: {
              annotationKind: annotation.kind,
              origin: annotation.origin,
              revision: annotation.currentRevision,
              scope: annotation.scope,
            },
          });
          return provenanceOk(annotation);
        }),
      );
    },

    async remove(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      itemId: string;
      annotationId: string;
      expectedRevision: number;
    }): Promise<KnowledgeProvenanceResult<unknown>> {
      if (
        !hasKnowledgePrincipal(input.actor) ||
        !isBoundedKnowledgeId(input.itemId) ||
        !isBoundedKnowledgeId(input.annotationId)
      ) {
        return provenanceNotFound();
      }
      if (!isValidKnowledgeVersion(input.expectedRevision)) {
        return provenanceInvalid('expectedRevision is invalid');
      }
      return runKnowledgeProvenanceMutation(() =>
        dependencies.unitOfWork.run(async (transaction) => {
          const current = await transaction.annotations.findOwned({
            actor: input.actor,
            itemId: input.itemId,
            annotationId: input.annotationId,
            deleted: false,
          });
          if (!current) return provenanceNotFound();
          if (current.currentRevision !== input.expectedRevision) {
            return provenanceConflict();
          }
          const annotation = await transaction.annotations.logicallyDelete({
            actor: input.actor,
            annotationId: input.annotationId,
            expectedRevision: input.expectedRevision,
            deletedAt: now(),
          });
          if (!annotation) return provenanceConflict();
          await transaction.audit.write({
            action: 'knowledge_annotation_deleted',
            actor: knowledgeProvenanceAuditActor(input.actor, input.auditActor),
            targetTable: 'knowledge_annotations',
            targetId: annotation.id,
            metadata: {
              annotationKind: annotation.kind,
              origin: annotation.origin,
              revision: annotation.currentRevision,
              scope: annotation.scope,
            },
          });
          return provenanceOk(annotation);
        }),
      );
    },
  };
}
