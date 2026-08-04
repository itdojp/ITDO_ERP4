export const knowledgeItemScopes = ['personal', 'organization'] as const;
export type KnowledgeItemScope = (typeof knowledgeItemScopes)[number];

export const knowledgeItemStatuses = [
  'inbox',
  'reviewing',
  'processed',
  'archived',
] as const;
export type KnowledgeItemStatus = (typeof knowledgeItemStatuses)[number];

export const knowledgeSourceTypes = [
  'x',
  'threads',
  'news',
  'web',
  'pdf',
  'image',
  'manual',
  'other',
] as const;
export type KnowledgeSourceType = (typeof knowledgeSourceTypes)[number];

export const knowledgeDeletionReasonCodes = ['owner_request'] as const;
export type KnowledgeDeletionReasonCode =
  (typeof knowledgeDeletionReasonCodes)[number];

export type KnowledgeActor = {
  userId: string;
  organizationId?: string;
  groupAccountIds: string[];
};

export type KnowledgeAuditActor = {
  userId?: string;
  principalUserId?: string;
  actorUserId?: string;
  authScopes?: string[];
  actorRole?: string;
  actorGroupId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  source?: string;
};

export type KnowledgeItem = {
  id: string;
  ownerUserId: string;
  scope: KnowledgeItemScope;
  organizationId: string | null;
  sourceType: KnowledgeSourceType;
  canonicalUrl: string | null;
  title: string | null;
  sourceAuthor: string | null;
  publishedAt: Date | null;
  capturedAt: Date;
  saveReason: string | null;
  shortNote: string | null;
  unresolvedQuestion: string | null;
  status: KnowledgeItemStatus;
  version: number;
  deletedAt: Date | null;
  deletedReason: string | null;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
};

export type KnowledgeItemCreateRecord = {
  ownerUserId: string;
  scope: KnowledgeItemScope;
  organizationId: string | null;
  groupAccountIds: string[];
  sourceType: KnowledgeSourceType;
  canonicalUrl: string | null;
  title: string | null;
  sourceAuthor: string | null;
  publishedAt: Date | null;
  capturedAt: Date;
  saveReason: string | null;
  shortNote: string | null;
  unresolvedQuestion: string | null;
  status: KnowledgeItemStatus;
  createdBy: string;
  updatedBy: string;
};

export const knowledgeMutableFields = [
  'sourceType',
  'canonicalUrl',
  'title',
  'sourceAuthor',
  'publishedAt',
  'capturedAt',
  'saveReason',
  'shortNote',
  'unresolvedQuestion',
  'status',
] as const;
export type KnowledgeMutableField = (typeof knowledgeMutableFields)[number];

export type KnowledgeItemUpdateRecord = Partial<
  Pick<KnowledgeItem, KnowledgeMutableField>
>;

export type KnowledgeListQuery = {
  limit: number;
  offset: number;
  scope?: KnowledgeItemScope;
  status?: KnowledgeItemStatus;
};

export interface KnowledgeItemReadRepository {
  listVisible(
    actor: KnowledgeActor,
    query: KnowledgeListQuery,
  ): Promise<KnowledgeItem[]>;
  countVisible(
    actor: KnowledgeActor,
    filters: Pick<KnowledgeListQuery, 'scope' | 'status'>,
  ): Promise<number>;
  findVisibleById(
    actor: KnowledgeActor,
    itemId: string,
  ): Promise<KnowledgeItem | null>;
}

export interface KnowledgeItemWriteRepository {
  countActiveGroups(groupAccountIds: string[]): Promise<number>;
  create(input: KnowledgeItemCreateRecord): Promise<KnowledgeItem>;
  findOwnedForMutation(input: {
    actor: KnowledgeActor;
    itemId: string;
    deleted: boolean;
  }): Promise<KnowledgeItem | null>;
  updateOwnedVersioned(input: {
    actor: KnowledgeActor;
    itemId: string;
    expectedVersion: number;
    patch: KnowledgeItemUpdateRecord;
  }): Promise<KnowledgeItem | null>;
  deleteOwnedVersioned(input: {
    actor: KnowledgeActor;
    itemId: string;
    expectedVersion: number;
    deletedAt: Date;
    reasonCode: KnowledgeDeletionReasonCode;
  }): Promise<KnowledgeItem | null>;
  restoreOwnedVersioned(input: {
    actor: KnowledgeActor;
    itemId: string;
    expectedVersion: number;
  }): Promise<KnowledgeItem | null>;
}

export type KnowledgeAuditAction =
  | 'knowledge_item_created'
  | 'knowledge_item_updated'
  | 'knowledge_item_deleted'
  | 'knowledge_item_restored';

export type KnowledgeAuditMetadata = {
  scope: KnowledgeItemScope;
  status: KnowledgeItemStatus;
  version: number;
  changedFields?: KnowledgeMutableField[];
};

export type KnowledgeAuditEntry = {
  action: KnowledgeAuditAction;
  actor: KnowledgeAuditActor;
  targetId: string;
  reasonCode?: KnowledgeDeletionReasonCode;
  metadata: KnowledgeAuditMetadata;
};

export interface KnowledgeAuditWriter {
  write(entry: KnowledgeAuditEntry): Promise<void>;
}

export type KnowledgeTransaction = {
  items: KnowledgeItemWriteRepository;
  audit: KnowledgeAuditWriter;
};

export interface KnowledgeUnitOfWork {
  run<T>(work: (transaction: KnowledgeTransaction) => Promise<T>): Promise<T>;
}
