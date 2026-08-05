import {
  knowledgeItemScopes,
  knowledgeItemStatuses,
  knowledgeSourceTypes,
  type KnowledgeActor,
} from './knowledgeItemPorts.js';
import { normalizeKnowledgeLabelName } from './knowledgeLabelUseCases.js';
import {
  knowledgeSearchFacetKinds,
  knowledgeSearchLimits,
  knowledgeSearchOperators,
  type KnowledgeCanonicalLabelFilters,
  type KnowledgeCanonicalLabelRoot,
  type KnowledgeCanonicalSearchFilter,
  type KnowledgeCursorCodec,
  type KnowledgeCursorFilter,
  type KnowledgeExpandedLabelFilters,
  type KnowledgeExpandedLabelRoot,
  type KnowledgeLabelFilterInput,
  type KnowledgeLabelSuggestion,
  type KnowledgeSearchFacetKind,
  type KnowledgeSearchFacets,
  type KnowledgeSearchFilterInput,
  type KnowledgeSearchInput,
  type KnowledgeSearchOperator,
  type KnowledgeSearchRepository,
} from './knowledgeSearchPorts.js';

export type KnowledgeSearchFailure = {
  ok: false;
  statusCode: 400;
  code:
    | 'invalid_request'
    | 'invalid_cursor'
    | 'invalid_saved_view'
    | 'query_too_complex';
  message: string;
};

export type KnowledgeSearchResult = {
  items: Awaited<ReturnType<KnowledgeSearchRepository['execute']>>['items'];
  total: number;
  facets: KnowledgeSearchFacets;
  nextCursor: string | null;
};

export type KnowledgeSearchApplicationResult<T> =
  { ok: true; value: T } | KnowledgeSearchFailure;

export interface KnowledgeSearchService {
  resolveFilter(input: {
    actor: KnowledgeActor;
    filter: KnowledgeSearchFilterInput;
    facets?: KnowledgeSearchFacetKind[];
    limit?: number;
  }): Promise<KnowledgeSearchApplicationResult<KnowledgeCanonicalSearchFilter>>;
  validateCanonicalFilter(input: {
    actor: KnowledgeActor;
    filter: KnowledgeCanonicalSearchFilter;
    staleReferenceCode?: 'invalid_request' | 'invalid_saved_view';
  }): Promise<KnowledgeSearchApplicationResult<KnowledgeExpandedLabelFilters>>;
  executeCanonical(input: {
    actor: KnowledgeActor;
    filter: KnowledgeCanonicalSearchFilter;
    facets?: KnowledgeSearchFacetKind[];
    limit?: number;
    cursor?: string;
    staleReferenceCode?: 'invalid_request' | 'invalid_saved_view';
  }): Promise<KnowledgeSearchApplicationResult<KnowledgeSearchResult>>;
  search(input: {
    actor: KnowledgeActor;
    body: KnowledgeSearchInput;
  }): Promise<KnowledgeSearchApplicationResult<KnowledgeSearchResult>>;
  suggest(input: {
    actor: KnowledgeActor;
    query: string;
    limit?: number;
  }): Promise<KnowledgeSearchApplicationResult<KnowledgeLabelSuggestion[]>>;
}

const filterFields = new Set([
  'labels',
  'sourceType',
  'status',
  'scope',
  'publishedFrom',
  'publishedTo',
  'capturedFrom',
  'capturedTo',
]);
const searchFields = new Set([...filterFields, 'facets', 'limit', 'cursor']);

function ok<T>(value: T): KnowledgeSearchApplicationResult<T> {
  return { ok: true, value };
}

function failure(code: KnowledgeSearchFailure['code']): KnowledgeSearchFailure {
  const messages: Record<KnowledgeSearchFailure['code'], string> = {
    invalid_request: 'Invalid knowledge search request',
    invalid_cursor: 'Invalid cursor',
    invalid_saved_view: 'Invalid saved view',
    query_too_complex: 'Knowledge search query is too complex',
  };
  return { ok: false, statusCode: 400, code, message: messages[code] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasPrincipal(actor: KnowledgeActor) {
  return typeof actor.userId === 'string' && actor.userId.trim().length > 0;
}

function hasOnlyFields(value: Record<string, unknown>, fields: Set<string>) {
  return Object.keys(value).every((field) => fields.has(field));
}

function normalizeDate(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function validRange(from: Date | undefined, to: Date | undefined) {
  return !from || !to || from.getTime() <= to.getTime();
}

type NormalizedRawLabelRoot = {
  reference: string;
  includeDescendants: boolean;
};

type NormalizedRawLabels = Record<
  KnowledgeSearchOperator,
  NormalizedRawLabelRoot[]
>;

function normalizeRawLabels(
  value: unknown,
): { ok: true; labels: NormalizedRawLabels } | { ok: false } {
  const empty: NormalizedRawLabels = { any: [], all: [], not: [] };
  if (value === undefined) return { ok: true, labels: empty };
  if (
    !isRecord(value) ||
    !hasOnlyFields(value, new Set(knowledgeSearchOperators))
  ) {
    return { ok: false };
  }
  for (const operator of knowledgeSearchOperators) {
    const rawEntries = value[operator];
    if (rawEntries === undefined) continue;
    if (!Array.isArray(rawEntries)) return { ok: false };
    for (const rawEntry of rawEntries) {
      if (
        !isRecord(rawEntry) ||
        !hasOnlyFields(
          rawEntry,
          new Set(['reference', 'includeDescendants']),
        ) ||
        typeof rawEntry.reference !== 'string' ||
        (rawEntry.includeDescendants !== undefined &&
          typeof rawEntry.includeDescendants !== 'boolean')
      ) {
        return { ok: false };
      }
      const reference = rawEntry.reference.trim().normalize('NFKC');
      if (
        reference.length === 0 ||
        [...reference].length > knowledgeSearchLimits.reference
      ) {
        return { ok: false };
      }
      empty[operator].push({
        reference,
        includeDescendants: rawEntry.includeDescendants === true,
      });
    }
  }
  return { ok: true, labels: empty };
}

function normalizeScalarFilter(
  raw: KnowledgeSearchFilterInput,
):
  | { ok: true; filter: Omit<KnowledgeCanonicalSearchFilter, 'labels'> }
  | { ok: false } {
  if (
    (raw.sourceType !== undefined &&
      !knowledgeSourceTypes.includes(raw.sourceType)) ||
    (raw.status !== undefined && !knowledgeItemStatuses.includes(raw.status)) ||
    (raw.scope !== undefined && !knowledgeItemScopes.includes(raw.scope))
  ) {
    return { ok: false };
  }
  const publishedFrom = normalizeDate(raw.publishedFrom);
  const publishedTo = normalizeDate(raw.publishedTo);
  const capturedFrom = normalizeDate(raw.capturedFrom);
  const capturedTo = normalizeDate(raw.capturedTo);
  if (
    publishedFrom === null ||
    publishedTo === null ||
    capturedFrom === null ||
    capturedTo === null ||
    !validRange(publishedFrom, publishedTo) ||
    !validRange(capturedFrom, capturedTo)
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    filter: {
      sourceType: raw.sourceType,
      status: raw.status,
      scope: raw.scope,
      publishedFrom,
      publishedTo,
      capturedFrom,
      capturedTo,
    },
  };
}

function normalizeFacets(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const facets: KnowledgeSearchFacetKind[] = [];
  const seen = new Set<string>();
  for (const facet of value) {
    if (
      typeof facet !== 'string' ||
      !knowledgeSearchFacetKinds.some((candidate) => candidate === facet) ||
      seen.has(facet)
    ) {
      return null;
    }
    seen.add(facet);
    facets.push(facet as KnowledgeSearchFacetKind);
  }
  return facets.sort();
}

function normalizeLimit(value: unknown) {
  if (value === undefined) return knowledgeSearchLimits.defaultPage;
  return Number.isInteger(value) && Number(value) >= 1 ? Number(value) : null;
}

function shapeCost(
  labels: NormalizedRawLabels,
  facets: KnowledgeSearchFacetKind[],
  limit: number,
) {
  let cost =
    Math.ceil(limit / 10) + facets.length * knowledgeSearchLimits.facetCost;
  let references = 0;
  const operatorCost: Record<KnowledgeSearchOperator, number> = {
    any: 1,
    all: 2,
    not: 2,
  };
  for (const operator of knowledgeSearchOperators) {
    for (const root of labels[operator]) {
      references += 1;
      cost += operatorCost[operator];
      if (root.includeDescendants) cost += knowledgeSearchLimits.descendantCost;
    }
  }
  return { cost, references };
}

function canonicalCursorFilter(
  filter: KnowledgeCanonicalSearchFilter,
  facets: KnowledgeSearchFacetKind[],
  limit: number,
): KnowledgeCursorFilter {
  return {
    labels: filter.labels,
    sourceType: filter.sourceType,
    status: filter.status,
    scope: filter.scope,
    publishedFrom: filter.publishedFrom?.toISOString(),
    publishedTo: filter.publishedTo?.toISOString(),
    capturedFrom: filter.capturedFrom?.toISOString(),
    capturedTo: filter.capturedTo?.toISOString(),
    facets,
    limit,
  };
}

function uniqueCanonicalRoots(filter: KnowledgeCanonicalLabelFilters) {
  return knowledgeSearchOperators.flatMap((operator) => filter[operator]);
}

function expandedFilters(
  canonical: KnowledgeCanonicalLabelFilters,
  expanded: KnowledgeExpandedLabelRoot[],
): KnowledgeExpandedLabelFilters | null {
  const byKey = new Map(
    expanded.map((root) => [
      `${root.id}\u0000${root.includeDescendants ? '1' : '0'}`,
      root,
    ]),
  );
  const result: KnowledgeExpandedLabelFilters = { any: [], all: [], not: [] };
  for (const operator of knowledgeSearchOperators) {
    for (const root of canonical[operator]) {
      const match = byKey.get(
        `${root.id}\u0000${root.includeDescendants ? '1' : '0'}`,
      );
      if (!match || !match.labelIds.includes(root.id)) return null;
      const labelIds = [...new Set(match.labelIds)].sort();
      if (labelIds.length === 0) return null;
      result[operator].push({ ...root, labelIds });
    }
  }
  return result;
}

function countExpandedIds(labels: KnowledgeExpandedLabelFilters) {
  return new Set(
    knowledgeSearchOperators.flatMap((operator) =>
      labels[operator].flatMap((root) => root.labelIds),
    ),
  ).size;
}

export function createKnowledgeSearchService(input: {
  repository: KnowledgeSearchRepository;
  cursorCodec: KnowledgeCursorCodec;
}): KnowledgeSearchService {
  const inReadSnapshot = <T>(
    work: (repository: KnowledgeSearchRepository) => Promise<T>,
  ) =>
    input.repository.runInReadSnapshot
      ? input.repository.runInReadSnapshot(work)
      : work(input.repository);

  const resolveFilterWithRepository = async (
    repository: KnowledgeSearchRepository,
    {
      actor,
      filter,
      facets = [],
      limit = knowledgeSearchLimits.defaultPage,
    }: Parameters<KnowledgeSearchService['resolveFilter']>[0],
  ) => {
    if (!hasPrincipal(actor)) return failure('invalid_request');
    if (!isRecord(filter) || !hasOnlyFields(filter, filterFields)) {
      return failure('invalid_request');
    }
    const rawLabels = normalizeRawLabels(
      filter.labels as KnowledgeLabelFilterInput,
    );
    const scalar = normalizeScalarFilter(filter);
    if (!rawLabels.ok || !scalar.ok) return failure('invalid_request');
    const estimated = shapeCost(rawLabels.labels, facets, limit);
    if (
      estimated.references > knowledgeSearchLimits.labelReferences ||
      estimated.cost > knowledgeSearchLimits.totalCost
    ) {
      return failure('query_too_complex');
    }

    const rawReferences = knowledgeSearchOperators.flatMap((operator) =>
      rawLabels.labels[operator].map((root) => root.reference),
    );
    const resolved = await repository.resolveVisibleLabelReferences(actor, [
      ...new Set(rawReferences),
    ]);
    const candidatesByReference = new Map(
      resolved.map((entry) => [entry.reference, entry.candidates]),
    );
    const labels: KnowledgeCanonicalLabelFilters = {
      any: [],
      all: [],
      not: [],
    };
    const operatorById = new Map<string, KnowledgeSearchOperator>();
    for (const operator of knowledgeSearchOperators) {
      const rootsById = new Map<string, KnowledgeCanonicalLabelRoot>();
      for (const root of rawLabels.labels[operator]) {
        const candidates = candidatesByReference.get(root.reference) ?? [];
        if (candidates.length !== 1) return failure('invalid_request');
        const id = candidates[0].id;
        const previousOperator = operatorById.get(id);
        if (previousOperator && previousOperator !== operator) {
          return failure('invalid_request');
        }
        operatorById.set(id, operator);
        const previous = rootsById.get(id);
        if (
          previous &&
          previous.includeDescendants !== root.includeDescendants
        ) {
          return failure('invalid_request');
        }
        rootsById.set(id, { id, includeDescendants: root.includeDescendants });
      }
      labels[operator] = [...rootsById.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
    }
    return ok({ labels, ...scalar.filter });
  };

  const resolveFilter: KnowledgeSearchService['resolveFilter'] = (request) =>
    resolveFilterWithRepository(input.repository, request);

  const validateCanonicalFilterWithRepository = async (
    repository: KnowledgeSearchRepository,
    {
      actor,
      filter,
      staleReferenceCode = 'invalid_request',
    }: Parameters<KnowledgeSearchService['validateCanonicalFilter']>[0],
  ) => {
    if (!hasPrincipal(actor)) return failure('invalid_request');
    const roots = uniqueCanonicalRoots(filter.labels);
    const expandedRows = await repository.expandVisibleLabelRoots(actor, roots);
    const labels = expandedFilters(filter.labels, expandedRows);
    if (!labels) return failure(staleReferenceCode);
    if (countExpandedIds(labels) > knowledgeSearchLimits.expandedLabelIds) {
      return failure('query_too_complex');
    }
    return ok(labels);
  };

  const validateCanonicalFilter: KnowledgeSearchService['validateCanonicalFilter'] =
    (request) =>
      inReadSnapshot((repository) =>
        validateCanonicalFilterWithRepository(repository, request),
      );

  const executeCanonicalWithRepository = async (
    repository: KnowledgeSearchRepository,
    {
      actor,
      filter,
      facets: rawFacets,
      limit: rawLimit,
      cursor,
      staleReferenceCode = 'invalid_request',
    }: Parameters<KnowledgeSearchService['executeCanonical']>[0],
  ) => {
    if (!hasPrincipal(actor)) return failure('invalid_request');
    const facets = normalizeFacets(rawFacets);
    const limit = normalizeLimit(rawLimit);
    if (
      facets === null ||
      limit === null ||
      limit > knowledgeSearchLimits.page ||
      (cursor !== undefined &&
        (typeof cursor !== 'string' ||
          cursor.length === 0 ||
          cursor.length > knowledgeSearchLimits.cursor))
    ) {
      return failure('invalid_request');
    }
    const roots = uniqueCanonicalRoots(filter.labels);
    const rawShape: NormalizedRawLabels = { any: [], all: [], not: [] };
    for (const operator of knowledgeSearchOperators) {
      rawShape[operator] = filter.labels[operator].map((root) => ({
        reference: root.id,
        includeDescendants: root.includeDescendants,
      }));
    }
    const estimated = shapeCost(rawShape, facets, limit);
    if (
      estimated.references > knowledgeSearchLimits.labelReferences ||
      estimated.cost > knowledgeSearchLimits.totalCost
    ) {
      return failure('query_too_complex');
    }

    const validated = await validateCanonicalFilterWithRepository(repository, {
      actor,
      filter,
      staleReferenceCode,
    });
    if (!validated.ok) return validated;
    const labels = validated.value;

    const cursorFilter = canonicalCursorFilter(filter, facets, limit);
    let cursorBoundary;
    if (cursor) {
      try {
        cursorBoundary = input.cursorCodec.decode({
          cursor,
          filter: cursorFilter,
          actor,
        });
      } catch {
        return failure('invalid_cursor');
      }
    }
    const result = await repository.execute(actor, {
      ...filter,
      labels,
      facets,
      limit,
      cursorBoundary,
    });
    if (result.visibleRootCount !== roots.length) {
      return failure(staleReferenceCode);
    }
    const nextCursor = result.nextBoundary
      ? input.cursorCodec.encode({
          boundary: result.nextBoundary,
          filter: cursorFilter,
          actor,
        })
      : null;
    return ok({
      items: result.items,
      total: result.total,
      facets: result.facets,
      nextCursor,
    });
  };

  const executeCanonical: KnowledgeSearchService['executeCanonical'] = (
    request,
  ) =>
    inReadSnapshot((repository) =>
      executeCanonicalWithRepository(repository, request),
    );

  return {
    resolveFilter,
    validateCanonicalFilter,
    executeCanonical,
    async search({ actor, body }) {
      if (!hasPrincipal(actor)) return failure('invalid_request');
      if (!isRecord(body) || !hasOnlyFields(body, searchFields)) {
        return failure('invalid_request');
      }
      const rawLabels = normalizeRawLabels(body.labels);
      const facets = normalizeFacets(body.facets);
      const limit = normalizeLimit(body.limit);
      if (!rawLabels.ok || facets === null || limit === null) {
        return failure('invalid_request');
      }
      const estimated = shapeCost(rawLabels.labels, facets, limit);
      if (
        limit > knowledgeSearchLimits.page ||
        estimated.references > knowledgeSearchLimits.labelReferences ||
        estimated.cost > knowledgeSearchLimits.totalCost
      ) {
        return failure('query_too_complex');
      }
      const {
        facets: _facets,
        limit: _limit,
        cursor: _cursor,
        ...filterInput
      } = body;
      return inReadSnapshot(async (repository) => {
        const resolved = await resolveFilterWithRepository(repository, {
          actor,
          filter: filterInput,
          facets,
          limit,
        });
        if (!resolved.ok) return resolved;
        return executeCanonicalWithRepository(repository, {
          actor,
          filter: resolved.value,
          facets,
          limit,
          cursor: body.cursor,
        });
      });
    },
    async suggest({ actor, query, limit: rawLimit }) {
      if (!hasPrincipal(actor)) return failure('invalid_request');
      const limit = rawLimit ?? knowledgeSearchLimits.defaultSuggestion;
      if (
        typeof query !== 'string' ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > knowledgeSearchLimits.suggestion
      ) {
        return failure('invalid_request');
      }
      const normalized = normalizeKnowledgeLabelName(query);
      if (
        [...normalized].length < knowledgeSearchLimits.suggestionQueryMin ||
        [...normalized].length > knowledgeSearchLimits.suggestionQuery
      ) {
        return failure('invalid_request');
      }
      return ok(
        await input.repository.suggest({ actor, query: normalized, limit }),
      );
    },
  };
}
