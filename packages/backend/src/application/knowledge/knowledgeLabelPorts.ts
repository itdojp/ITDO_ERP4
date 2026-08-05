import type {
  KnowledgeActor,
  KnowledgeAuditActor,
  KnowledgeItemScope,
  KnowledgeItemStatus,
} from './knowledgeItemPorts.js';

export const knowledgeLabelCapabilities = ['use', 'manage'] as const;
export type KnowledgeLabelCapability =
  (typeof knowledgeLabelCapabilities)[number];

export const knowledgeLabelAssignmentSources = [
  'manual',
  'import',
  'ai_suggestion',
] as const;
export type KnowledgeLabelAssignmentSource =
  (typeof knowledgeLabelAssignmentSources)[number];

export const knowledgeLabelInputLimits = {
  displayName: 200,
  slug: 100,
  alias: 200,
  labelId: 100,
  aliasId: 100,
  itemId: 100,
  groupAccountId: 100,
  groupGrants: 100,
  listLimit: 100,
  listOffset: 10000,
  expectedVersion: 2147483646,
  confidenceBasisPoints: 10000,
  hierarchyDepth: 8,
} as const;

export type KnowledgeLabel = {
  id: string;
  ownerUserId: string;
  scope: KnowledgeItemScope;
  organizationId: string | null;
  displayName: string;
  slug: string;
  parentId: string | null;
  version: number;
  deletedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
};

export type KnowledgeLabelAlias = {
  id: string;
  labelId: string;
  alias: string;
  normalizedAlias: string;
  createdAt: Date;
  createdBy: string | null;
};

export type KnowledgeLabelGroupGrant = {
  id: string;
  labelId: string;
  groupAccountId: string;
  capability: KnowledgeLabelCapability;
  active: boolean;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
};

export type KnowledgeItemLabelAssignment = {
  itemId: string;
  labelId: string;
  assignmentSource: KnowledgeLabelAssignmentSource;
  assignedBy: string;
  confidenceBasisPoints: number | null;
  detachedAt: Date | null;
  detachedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type KnowledgeItemLabelMutationTarget = {
  id: string;
  ownerUserId: string;
  scope: KnowledgeItemScope;
  organizationId: string | null;
  status: KnowledgeItemStatus;
  version: number;
};

export type KnowledgeLabelListQuery = {
  limit: number;
  offset: number;
  scope?: KnowledgeItemScope;
  parentId?: string | null;
};

export type KnowledgeLabelGrantInput = {
  groupAccountId: string;
  capability: KnowledgeLabelCapability;
};

export type KnowledgeLabelCreateRecord = {
  ownerUserId: string;
  scope: KnowledgeItemScope;
  organizationId: string | null;
  displayName: string;
  slug: string;
  parentId: string | null;
  groupGrants: KnowledgeLabelGrantInput[];
  createdBy: string;
  updatedBy: string;
};

export type KnowledgeLabelUpdateRecord = {
  displayName?: string;
  slug?: string;
  parentId?: string | null;
};

export type KnowledgeLabelMutationFailure =
  | 'version_conflict'
  | 'duplicate'
  | 'cycle'
  | 'hierarchy_too_deep'
  | 'broken_hierarchy'
  | 'has_active_children';

export type KnowledgeLabelMutationResult<T> =
  { ok: true; value: T } | { ok: false; reason: KnowledgeLabelMutationFailure };

export class KnowledgeLabelTransactionConflictError extends Error {
  constructor(readonly conflict: 'duplicate' | 'concurrent') {
    super('knowledge_label_transaction_conflict');
    this.name = 'KnowledgeLabelTransactionConflictError';
  }
}

export type KnowledgeItemLabelMutationValue = {
  assignment: KnowledgeItemLabelAssignment | null;
  itemVersion: number;
};

export interface KnowledgeLabelReadRepository {
  listVisible(
    actor: KnowledgeActor,
    query: KnowledgeLabelListQuery,
  ): Promise<KnowledgeLabel[]>;
  findVisibleById(
    actor: KnowledgeActor,
    labelId: string,
  ): Promise<KnowledgeLabel | null>;
  listVisibleAliases(
    actor: KnowledgeActor,
    labelId: string,
  ): Promise<KnowledgeLabelAlias[] | null>;
  listManageableGrants(
    actor: KnowledgeActor,
    labelId: string,
  ): Promise<KnowledgeLabelGroupGrant[] | null>;
}

export interface KnowledgeLabelWriteRepository {
  countActiveGroups(groupAccountIds: string[]): Promise<number>;
  findManageableById(
    actor: KnowledgeActor,
    labelId: string,
  ): Promise<KnowledgeLabel | null>;
  findUsableById(
    actor: KnowledgeActor,
    labelId: string,
  ): Promise<KnowledgeLabel | null>;
  isNameAvailable(input: {
    actor: KnowledgeActor;
    scope: KnowledgeItemScope;
    organizationId: string | null;
    normalizedName: string;
    excludeLabelId?: string;
  }): Promise<boolean>;
  create(
    input: KnowledgeLabelCreateRecord,
  ): Promise<KnowledgeLabelMutationResult<KnowledgeLabel>>;
  updateVersioned(input: {
    actor: KnowledgeActor;
    labelId: string;
    expectedVersion: number;
    patch: KnowledgeLabelUpdateRecord;
  }): Promise<KnowledgeLabelMutationResult<KnowledgeLabel>>;
  deleteVersioned(input: {
    actor: KnowledgeActor;
    labelId: string;
    expectedVersion: number;
    deletedAt: Date;
  }): Promise<KnowledgeLabelMutationResult<KnowledgeLabel>>;
  addAliasVersioned(input: {
    actor: KnowledgeActor;
    labelId: string;
    expectedVersion: number;
    alias: string;
    normalizedAlias: string;
  }): Promise<
    KnowledgeLabelMutationResult<{
      alias: KnowledgeLabelAlias;
      labelVersion: number;
    }>
  >;
  removeAliasVersioned(input: {
    actor: KnowledgeActor;
    labelId: string;
    aliasId: string;
    expectedVersion: number;
  }): Promise<KnowledgeLabelMutationResult<{
    alias: KnowledgeLabelAlias;
    labelVersion: number;
  }> | null>;
  replaceGrantsVersioned(input: {
    actor: KnowledgeActor;
    labelId: string;
    expectedVersion: number;
    grants: KnowledgeLabelGrantInput[];
  }): Promise<
    KnowledgeLabelMutationResult<{
      grants: KnowledgeLabelGroupGrant[];
      labelVersion: number;
    }>
  >;
}

export interface KnowledgeItemLabelWriteRepository {
  findOwnedItemForMutation(input: {
    actor: KnowledgeActor;
    itemId: string;
  }): Promise<KnowledgeItemLabelMutationTarget | null>;
  attachVersioned(input: {
    actor: KnowledgeActor;
    itemId: string;
    labelId: string;
    expectedVersion: number;
    assignmentSource: KnowledgeLabelAssignmentSource;
    confidenceBasisPoints: number | null;
  }): Promise<KnowledgeLabelMutationResult<KnowledgeItemLabelMutationValue>>;
  detachVersioned(input: {
    actor: KnowledgeActor;
    itemId: string;
    labelId: string;
    expectedVersion: number;
  }): Promise<KnowledgeLabelMutationResult<KnowledgeItemLabelMutationValue>>;
}

export type KnowledgeLabelAuditAction =
  | 'knowledge_label_created'
  | 'knowledge_label_updated'
  | 'knowledge_label_deleted'
  | 'knowledge_label_alias_added'
  | 'knowledge_label_alias_removed'
  | 'knowledge_label_grants_replaced'
  | 'knowledge_item_label_attached'
  | 'knowledge_item_label_detached';

export type KnowledgeLabelAuditEntry = {
  action: KnowledgeLabelAuditAction;
  actor: KnowledgeAuditActor;
  target:
    | {
        kind: 'label_master';
        scope: KnowledgeItemScope;
        version: number;
      }
    | {
        kind: 'knowledge_item';
        itemId: string;
        scope: KnowledgeItemScope;
        status: KnowledgeItemStatus;
        version: number;
        assignmentSource?: KnowledgeLabelAssignmentSource;
      };
};

export interface KnowledgeLabelAuditWriter {
  write(entry: KnowledgeLabelAuditEntry): Promise<void>;
}

export type KnowledgeLabelTransaction = {
  labels: KnowledgeLabelWriteRepository;
  itemLabels: KnowledgeItemLabelWriteRepository;
  audit: KnowledgeLabelAuditWriter;
};

export interface KnowledgeLabelUnitOfWork {
  run<T>(
    work: (transaction: KnowledgeLabelTransaction) => Promise<T>,
  ): Promise<T>;
}
