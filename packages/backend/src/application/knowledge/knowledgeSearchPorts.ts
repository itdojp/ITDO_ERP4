import type {
  KnowledgeActor,
  KnowledgeItem,
  KnowledgeItemScope,
  KnowledgeItemStatus,
  KnowledgeSourceType,
} from './knowledgeItemPorts.js';

export const knowledgeSearchFacetKinds = [
  'sourceType',
  'status',
  'scope',
  'label',
] as const;
export type KnowledgeSearchFacetKind =
  (typeof knowledgeSearchFacetKinds)[number];

export const knowledgeSearchOperators = ['any', 'all', 'not'] as const;
export type KnowledgeSearchOperator = (typeof knowledgeSearchOperators)[number];

export const knowledgeSearchLimits = {
  labelReferences: 30,
  expandedLabelIds: 100,
  page: 100,
  defaultPage: 50,
  suggestion: 20,
  defaultSuggestion: 10,
  suggestionQueryMin: 2,
  totalCost: 100,
  descendantCost: 20,
  facetCost: 5,
  reference: 200,
  cursor: 4096,
  suggestionQuery: 200,
} as const;

export type KnowledgeLabelReferenceInput = {
  reference: string;
  includeDescendants?: boolean;
};

export type KnowledgeLabelFilterInput = Partial<
  Record<KnowledgeSearchOperator, KnowledgeLabelReferenceInput[]>
>;

export type KnowledgeSearchFilterInput = {
  labels?: KnowledgeLabelFilterInput;
  sourceType?: KnowledgeSourceType;
  status?: KnowledgeItemStatus;
  scope?: KnowledgeItemScope;
  publishedFrom?: string;
  publishedTo?: string;
  capturedFrom?: string;
  capturedTo?: string;
};

export type KnowledgeSearchInput = KnowledgeSearchFilterInput & {
  facets?: KnowledgeSearchFacetKind[];
  limit?: number;
  cursor?: string;
};

export type KnowledgeResolvedLabel = {
  id: string;
  displayName: string;
  slug: string;
};

export type KnowledgeResolvedLabelReference = {
  reference: string;
  candidates: KnowledgeResolvedLabel[];
};

export type KnowledgeCanonicalLabelRoot = {
  id: string;
  includeDescendants: boolean;
};

export type KnowledgeExpandedLabelRoot = KnowledgeCanonicalLabelRoot & {
  labelIds: string[];
};

export type KnowledgeCanonicalLabelFilters = Record<
  KnowledgeSearchOperator,
  KnowledgeCanonicalLabelRoot[]
>;

export type KnowledgeExpandedLabelFilters = Record<
  KnowledgeSearchOperator,
  KnowledgeExpandedLabelRoot[]
>;

export type KnowledgeCanonicalSearchFilter = {
  labels: KnowledgeCanonicalLabelFilters;
  sourceType?: KnowledgeSourceType;
  status?: KnowledgeItemStatus;
  scope?: KnowledgeItemScope;
  publishedFrom?: Date;
  publishedTo?: Date;
  capturedFrom?: Date;
  capturedTo?: Date;
};

export type KnowledgeSearchExecutionQuery = Omit<
  KnowledgeCanonicalSearchFilter,
  'labels'
> & {
  labels: KnowledgeExpandedLabelFilters;
  facets: KnowledgeSearchFacetKind[];
  limit: number;
  cursorBoundary?: KnowledgeSearchCursorBoundary;
};

export type KnowledgeSearchCursorBoundary = {
  updatedAt: Date;
  id: string;
};

export type KnowledgeScalarFacetBucket = {
  value: string;
  count: number;
};

export type KnowledgeLabelFacetBucket = KnowledgeResolvedLabel & {
  count: number;
};

export type KnowledgeSearchFacets = Partial<{
  sourceType: KnowledgeScalarFacetBucket[];
  status: KnowledgeScalarFacetBucket[];
  scope: KnowledgeScalarFacetBucket[];
  label: KnowledgeLabelFacetBucket[];
}>;

export type KnowledgeSearchRepositoryResult = {
  items: KnowledgeItem[];
  total: number;
  facets: KnowledgeSearchFacets;
  nextBoundary: KnowledgeSearchCursorBoundary | null;
  visibleRootCount: number;
};

export type KnowledgeLabelSuggestion = KnowledgeResolvedLabel & {
  usageCount: number;
};

export interface KnowledgeSearchRepository {
  runInReadSnapshot?<T>(
    work: (repository: KnowledgeSearchRepository) => Promise<T>,
  ): Promise<T>;
  resolveVisibleLabelReferences(
    actor: KnowledgeActor,
    references: string[],
  ): Promise<KnowledgeResolvedLabelReference[]>;
  expandVisibleLabelRoots(
    actor: KnowledgeActor,
    roots: KnowledgeCanonicalLabelRoot[],
  ): Promise<KnowledgeExpandedLabelRoot[]>;
  execute(
    actor: KnowledgeActor,
    query: KnowledgeSearchExecutionQuery,
  ): Promise<KnowledgeSearchRepositoryResult>;
  suggest(input: {
    actor: KnowledgeActor;
    query: string;
    limit: number;
  }): Promise<KnowledgeLabelSuggestion[]>;
}

export type KnowledgeCursorFilter = {
  labels: KnowledgeCanonicalLabelFilters;
  sourceType?: KnowledgeSourceType;
  status?: KnowledgeItemStatus;
  scope?: KnowledgeItemScope;
  publishedFrom?: string;
  publishedTo?: string;
  capturedFrom?: string;
  capturedTo?: string;
  facets: KnowledgeSearchFacetKind[];
  limit: number;
};

export interface KnowledgeCursorCodec {
  encode(input: {
    boundary: KnowledgeSearchCursorBoundary;
    filter: KnowledgeCursorFilter;
    actor: KnowledgeActor;
  }): string;
  decode(input: {
    cursor: string;
    filter: KnowledgeCursorFilter;
    actor: KnowledgeActor;
  }): KnowledgeSearchCursorBoundary;
}
