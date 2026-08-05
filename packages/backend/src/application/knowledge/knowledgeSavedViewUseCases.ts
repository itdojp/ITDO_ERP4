import type {
  KnowledgeActor,
  KnowledgeAuditActorContext,
} from './knowledgeItemPorts.js';
import {
  knowledgeSavedViewLimits,
  type KnowledgeSavedView,
  type KnowledgeSavedViewListQuery,
  type KnowledgeSavedViewMutationFailure,
  type KnowledgeSavedViewReadRepository,
  type KnowledgeSavedViewRecoveryMetadata,
  type KnowledgeSavedViewTransaction,
  KnowledgeSavedViewTransactionConflictError,
  type KnowledgeSavedViewUnitOfWork,
} from './knowledgeSavedViewPorts.js';
import type {
  KnowledgeSearchFacetKind,
  KnowledgeSearchFilterInput,
} from './knowledgeSearchPorts.js';
import type {
  KnowledgeSearchResult,
  KnowledgeSearchService,
} from './knowledgeSearchUseCases.js';

export type KnowledgeSavedViewFailure = {
  ok: false;
  statusCode: 400 | 404 | 409;
  code:
    | 'invalid_request'
    | 'invalid_cursor'
    | 'invalid_saved_view'
    | 'not_found'
    | 'query_too_complex'
    | 'version_conflict';
  message: string;
};

export type KnowledgeSavedViewApplicationResult<T> =
  { ok: true; value: T } | KnowledgeSavedViewFailure;

export interface KnowledgeSavedViewService {
  list(input: {
    actor: KnowledgeActor;
    query: KnowledgeSavedViewListQuery;
  }): Promise<KnowledgeSavedViewApplicationResult<KnowledgeSavedView[]>>;
  listRecoveryMetadata(input: {
    actor: KnowledgeActor;
    query: KnowledgeSavedViewListQuery;
  }): Promise<
    KnowledgeSavedViewApplicationResult<KnowledgeSavedViewRecoveryMetadata[]>
  >;
  detail(input: {
    actor: KnowledgeActor;
    savedViewId: string;
  }): Promise<KnowledgeSavedViewApplicationResult<KnowledgeSavedView>>;
  create(input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    name: string;
    filter: KnowledgeSearchFilterInput;
  }): Promise<KnowledgeSavedViewApplicationResult<KnowledgeSavedView>>;
  update(input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    savedViewId: string;
    expectedVersion: number;
    name: string;
    filter: KnowledgeSearchFilterInput;
  }): Promise<KnowledgeSavedViewApplicationResult<KnowledgeSavedView>>;
  remove(input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    savedViewId: string;
    expectedVersion: number;
  }): Promise<KnowledgeSavedViewApplicationResult<KnowledgeSavedView>>;
  execute(input: {
    actor: KnowledgeActor;
    savedViewId: string;
    facets?: KnowledgeSearchFacetKind[];
    limit?: number;
    cursor?: string;
  }): Promise<KnowledgeSavedViewApplicationResult<KnowledgeSearchResult>>;
}

function ok<T>(value: T): KnowledgeSavedViewApplicationResult<T> {
  return { ok: true, value };
}

function failure(
  code: KnowledgeSavedViewFailure['code'],
): KnowledgeSavedViewFailure {
  switch (code) {
    case 'not_found':
      return { ok: false, statusCode: 404, code, message: 'Not found' };
    case 'version_conflict':
      return {
        ok: false,
        statusCode: 409,
        code,
        message: 'Version conflict',
      };
    case 'invalid_saved_view':
      return {
        ok: false,
        statusCode: 400,
        code,
        message: 'Invalid saved view',
      };
    case 'invalid_cursor':
      return {
        ok: false,
        statusCode: 400,
        code,
        message: 'Invalid cursor',
      };
    case 'query_too_complex':
      return {
        ok: false,
        statusCode: 400,
        code,
        message: 'Knowledge search query is too complex',
      };
    case 'invalid_request':
      return {
        ok: false,
        statusCode: 400,
        code,
        message: 'Invalid saved view request',
      };
  }
}

function validId(value: unknown) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    [...value].length <= knowledgeSavedViewLimits.id
  );
}

function hasPrincipal(actor: KnowledgeActor) {
  return typeof actor.userId === 'string' && actor.userId.trim().length > 0;
}

function normalizeName(value: unknown) {
  if (typeof value !== 'string') return null;
  const name = value.trim().normalize('NFKC');
  return name.length > 0 && [...name].length <= knowledgeSavedViewLimits.name
    ? name
    : null;
}

function validVersion(value: unknown) {
  return (
    Number.isInteger(value) &&
    Number(value) >= 1 &&
    Number(value) <= knowledgeSavedViewLimits.expectedVersion
  );
}

function auditActor(
  actor: KnowledgeActor,
  context: KnowledgeAuditActorContext,
) {
  return {
    userId: actor.userId,
    requestId: context.requestId,
    source: context.source,
  };
}

function mutationFailure(
  reason: KnowledgeSavedViewMutationFailure,
): KnowledgeSavedViewFailure {
  switch (reason) {
    case 'not_found':
      return failure('not_found');
    case 'version_conflict':
      return failure('version_conflict');
    case 'invalid_labels':
      return failure('invalid_request');
  }
}

function validListQuery(query: KnowledgeSavedViewListQuery) {
  return (
    Number.isInteger(query.limit) &&
    query.limit >= 1 &&
    query.limit <= knowledgeSavedViewLimits.list &&
    Number.isInteger(query.offset) &&
    query.offset >= 0 &&
    query.offset <= knowledgeSavedViewLimits.offset
  );
}

export function createKnowledgeSavedViewService(input: {
  repository: KnowledgeSavedViewReadRepository;
  unitOfWork: KnowledgeSavedViewUnitOfWork;
  search: KnowledgeSearchService;
}): KnowledgeSavedViewService {
  async function runMutation<T>(
    work: (
      transaction: KnowledgeSavedViewTransaction,
    ) => Promise<KnowledgeSavedViewApplicationResult<T>>,
  ) {
    try {
      return await input.unitOfWork.run(work);
    } catch (error) {
      if (error instanceof KnowledgeSavedViewTransactionConflictError) {
        return failure('version_conflict');
      }
      throw error;
    }
  }

  async function validateCurrent(
    actor: KnowledgeActor,
    savedView: KnowledgeSavedView,
  ): Promise<KnowledgeSavedViewApplicationResult<KnowledgeSavedView>> {
    if (savedView.schemaVersion !== knowledgeSavedViewLimits.schemaVersion) {
      return failure('invalid_saved_view');
    }
    const result = await input.search.validateCanonicalFilter({
      actor,
      filter: savedView.filter,
      staleReferenceCode: 'invalid_saved_view',
    });
    return result.ok ? ok(savedView) : failure('invalid_saved_view');
  }

  return {
    async list({ actor, query }) {
      if (!hasPrincipal(actor)) return failure('invalid_request');
      if (!validListQuery(query)) return failure('invalid_request');
      const views = await input.repository.listOwned(actor, query);
      for (const view of views) {
        const validated = await validateCurrent(actor, view);
        if (!validated.ok) return validated;
      }
      return ok(views);
    },

    async listRecoveryMetadata({ actor, query }) {
      if (!hasPrincipal(actor)) return failure('invalid_request');
      if (!validListQuery(query)) return failure('invalid_request');
      return ok(await input.repository.listOwnedRecoveryMetadata(actor, query));
    },

    async detail({ actor, savedViewId }) {
      if (!hasPrincipal(actor)) return failure('invalid_request');
      if (!validId(savedViewId)) return failure('invalid_request');
      const view = await input.repository.findOwnedById(
        actor,
        savedViewId.trim(),
      );
      return view ? validateCurrent(actor, view) : failure('not_found');
    },

    async create({ actor, auditActor: context, name: rawName, filter }) {
      if (!hasPrincipal(actor)) return failure('invalid_request');
      const name = normalizeName(rawName);
      if (!name) return failure('invalid_request');
      const resolved = await input.search.resolveFilter({ actor, filter });
      if (!resolved.ok) {
        return failure(
          resolved.code === 'query_too_complex'
            ? 'query_too_complex'
            : 'invalid_request',
        );
      }
      const validated = await input.search.validateCanonicalFilter({
        actor,
        filter: resolved.value,
      });
      if (!validated.ok) return failure(validated.code);
      return runMutation(async (transaction) => {
        const created = await transaction.savedViews.create({
          actor,
          name,
          filter: resolved.value,
        });
        if (!created.ok) return mutationFailure(created.reason);
        await transaction.audit.write({
          action: 'knowledge_saved_view_created',
          actor: auditActor(actor, context),
          version: created.value.version,
          schemaVersion: created.value.schemaVersion,
        });
        return ok(created.value);
      });
    },

    async update({
      actor,
      auditActor: context,
      savedViewId,
      expectedVersion,
      name: rawName,
      filter,
    }) {
      if (!hasPrincipal(actor)) return failure('invalid_request');
      const name = normalizeName(rawName);
      if (!validId(savedViewId) || !validVersion(expectedVersion) || !name) {
        return failure('invalid_request');
      }
      const resolved = await input.search.resolveFilter({ actor, filter });
      if (!resolved.ok) {
        return failure(
          resolved.code === 'query_too_complex'
            ? 'query_too_complex'
            : 'invalid_request',
        );
      }
      const validated = await input.search.validateCanonicalFilter({
        actor,
        filter: resolved.value,
      });
      if (!validated.ok) return failure(validated.code);
      return runMutation(async (transaction) => {
        const updated = await transaction.savedViews.updateOwnedVersioned({
          actor,
          savedViewId: savedViewId.trim(),
          expectedVersion,
          name,
          filter: resolved.value,
        });
        if (!updated.ok) return mutationFailure(updated.reason);
        await transaction.audit.write({
          action: 'knowledge_saved_view_updated',
          actor: auditActor(actor, context),
          version: updated.value.version,
          schemaVersion: updated.value.schemaVersion,
        });
        return ok(updated.value);
      });
    },

    async remove({ actor, auditActor: context, savedViewId, expectedVersion }) {
      if (!hasPrincipal(actor)) return failure('invalid_request');
      if (!validId(savedViewId) || !validVersion(expectedVersion)) {
        return failure('invalid_request');
      }
      return runMutation(async (transaction) => {
        const removed = await transaction.savedViews.deleteOwnedVersioned({
          actor,
          savedViewId: savedViewId.trim(),
          expectedVersion,
          deletedAt: new Date(),
        });
        if (!removed.ok) return mutationFailure(removed.reason);
        await transaction.audit.write({
          action: 'knowledge_saved_view_deleted',
          actor: auditActor(actor, context),
          version: removed.value.version,
          schemaVersion: removed.value.schemaVersion,
        });
        return ok(removed.value);
      });
    },

    async execute({ actor, savedViewId, facets, limit, cursor }) {
      if (!hasPrincipal(actor)) return failure('invalid_request');
      if (!validId(savedViewId)) return failure('invalid_request');
      const view = await input.repository.findOwnedById(
        actor,
        savedViewId.trim(),
      );
      if (!view) return failure('not_found');
      if (view.schemaVersion !== knowledgeSavedViewLimits.schemaVersion) {
        return failure('invalid_saved_view');
      }
      const result = await input.search.executeCanonical({
        actor,
        filter: view.filter,
        facets,
        limit,
        cursor,
        staleReferenceCode: 'invalid_saved_view',
      });
      if (!result.ok) {
        if (result.code === 'query_too_complex') {
          return failure('query_too_complex');
        }
        if (result.code === 'invalid_cursor') {
          return failure('invalid_cursor');
        }
        return failure('invalid_saved_view');
      }
      return ok(result.value);
    },
  };
}
