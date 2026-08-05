import type {
  KnowledgeActor,
  KnowledgeAuditActor,
} from './knowledgeItemPorts.js';
import type { KnowledgeCanonicalSearchFilter } from './knowledgeSearchPorts.js';

export const knowledgeSavedViewLimits = {
  id: 100,
  name: 200,
  list: 100,
  offset: 10000,
  expectedVersion: 2147483646,
  schemaVersion: 1,
} as const;

export type KnowledgeSavedView = {
  id: string;
  ownerUserId: string;
  name: string;
  filter: KnowledgeCanonicalSearchFilter;
  schemaVersion: number;
  version: number;
  deletedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
};

export type KnowledgeSavedViewListQuery = {
  limit: number;
  offset: number;
};

export type KnowledgeSavedViewRecoveryMetadata = Pick<
  KnowledgeSavedView,
  'id' | 'name' | 'version' | 'updatedAt'
>;

export interface KnowledgeSavedViewReadRepository {
  listOwned(
    actor: KnowledgeActor,
    query: KnowledgeSavedViewListQuery,
  ): Promise<KnowledgeSavedView[]>;
  findOwnedById(
    actor: KnowledgeActor,
    savedViewId: string,
  ): Promise<KnowledgeSavedView | null>;
  listOwnedRecoveryMetadata(
    actor: KnowledgeActor,
    query: KnowledgeSavedViewListQuery,
  ): Promise<KnowledgeSavedViewRecoveryMetadata[]>;
}

export type KnowledgeSavedViewMutationFailure =
  'not_found' | 'version_conflict' | 'invalid_labels';

export type KnowledgeSavedViewMutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: KnowledgeSavedViewMutationFailure };

export class KnowledgeSavedViewTransactionConflictError extends Error {
  constructor() {
    super('knowledge_saved_view_transaction_conflict');
    this.name = 'KnowledgeSavedViewTransactionConflictError';
  }
}

export interface KnowledgeSavedViewWriteRepository {
  create(input: {
    actor: KnowledgeActor;
    name: string;
    filter: KnowledgeCanonicalSearchFilter;
  }): Promise<KnowledgeSavedViewMutationResult<KnowledgeSavedView>>;
  updateOwnedVersioned(input: {
    actor: KnowledgeActor;
    savedViewId: string;
    expectedVersion: number;
    name: string;
    filter: KnowledgeCanonicalSearchFilter;
  }): Promise<KnowledgeSavedViewMutationResult<KnowledgeSavedView>>;
  deleteOwnedVersioned(input: {
    actor: KnowledgeActor;
    savedViewId: string;
    expectedVersion: number;
    deletedAt: Date;
  }): Promise<KnowledgeSavedViewMutationResult<KnowledgeSavedView>>;
}

export type KnowledgeSavedViewAuditAction =
  | 'knowledge_saved_view_created'
  | 'knowledge_saved_view_updated'
  | 'knowledge_saved_view_deleted';

export interface KnowledgeSavedViewAuditWriter {
  write(entry: {
    action: KnowledgeSavedViewAuditAction;
    actor: KnowledgeAuditActor;
    targetId: string;
    version: number;
    schemaVersion: number;
  }): Promise<void>;
}

export type KnowledgeSavedViewTransaction = {
  savedViews: KnowledgeSavedViewWriteRepository;
  audit: KnowledgeSavedViewAuditWriter;
};

export interface KnowledgeSavedViewUnitOfWork {
  run<T>(
    work: (transaction: KnowledgeSavedViewTransaction) => Promise<T>,
  ): Promise<T>;
}
