import type {
  KnowledgeActor,
  KnowledgeAuditActor,
  KnowledgeItemScope,
} from './knowledgeItemPorts.js';
import type { KnowledgeSynthesisAccessContext } from './knowledgeSynthesisAccessContext.js';

export const knowledgeAnnotationKinds = [
  'note',
  'question',
  'hypothesis',
  'quote',
  'todo',
] as const;
export type KnowledgeAnnotationKind = (typeof knowledgeAnnotationKinds)[number];

export const knowledgeProvenanceOrigins = [
  'user',
  'external',
  'ai',
  'system',
  'tool',
] as const;
export type KnowledgeProvenanceOrigin =
  (typeof knowledgeProvenanceOrigins)[number];

export const knowledgeConversationSourceTypes = [
  'manual',
  'json',
  'markdown',
] as const;
export type KnowledgeConversationSourceType =
  (typeof knowledgeConversationSourceTypes)[number];

export const knowledgeConversationRoles = [
  'user',
  'assistant',
  'system',
  'tool',
] as const;
export type KnowledgeConversationRole =
  (typeof knowledgeConversationRoles)[number];

export const knowledgeConversationItemRelationTypes = [
  'primary',
  'supporting',
  'contradicting',
  'context',
] as const;
export type KnowledgeConversationItemRelationType =
  (typeof knowledgeConversationItemRelationTypes)[number];

export const knowledgeSynthesisSourceRelationTypes = [
  'primary',
  'supporting',
  'contradicting',
  'context',
] as const;
export type KnowledgeSynthesisSourceRelationType =
  (typeof knowledgeSynthesisSourceRelationTypes)[number];

export const knowledgeSynthesisSourceKinds = [
  'item',
  'snapshot',
  'annotation',
  'annotation_revision',
  'conversation',
  'conversation_turn',
  'synthesis_version',
] as const;
export type KnowledgeSynthesisSourceKind =
  (typeof knowledgeSynthesisSourceKinds)[number];

export const knowledgeProvenanceLimits = {
  id: 100,
  title: 500,
  annotationContentBytes: 64 * 1024,
  conversationTurnBytes: 64 * 1024,
  conversationTurns: 200,
  conversationItems: 20,
  provider: 200,
  model: 200,
  name: 200,
  synthesisContentBytes: 256 * 1024,
  unresolvedQuestions: 50,
  unresolvedQuestion: 4000,
  sources: 100,
  listLimit: 100,
  defaultListLimit: 50,
  cursor: 4096,
  expectedVersion: 2_147_483_646,
  confidenceBasisPoints: 10_000,
  synthesisProvenanceDepth: 16,
  synthesisProvenanceNodes: 128,
  synthesisProvenanceEdges: 512,
  synthesisProvenanceQueries: 512,
  synthesisListCandidates: 200,
} as const;

export type KnowledgePageBoundary = {
  updatedAt: Date;
  id: string;
};

export type KnowledgeSequenceBoundary = {
  sequence: number;
  id: string;
};

export type KnowledgePage<T> = {
  items: T[];
  nextBoundary: KnowledgePageBoundary | null;
};

export type KnowledgeSequencePage<T> = {
  items: T[];
  nextBoundary: KnowledgeSequenceBoundary | null;
};

export type KnowledgeItemAccess = {
  id: string;
  ownerUserId: string;
  scope: KnowledgeItemScope;
  organizationId: string | null;
};

export type KnowledgeAnnotationRevision = {
  id: string;
  annotationId: string;
  revision: number;
  kind: KnowledgeAnnotationKind;
  origin: KnowledgeProvenanceOrigin;
  content: string;
  createdAt: Date;
  createdBy: string;
};

export type KnowledgeAnnotation = {
  id: string;
  knowledgeItemId: string;
  ownerUserId: string;
  authorUserId: string;
  scope: KnowledgeItemScope;
  organizationId: string | null;
  kind: KnowledgeAnnotationKind;
  origin: KnowledgeProvenanceOrigin;
  currentRevision: number;
  deletedAt: Date | null;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
  revision: KnowledgeAnnotationRevision;
};

export type KnowledgeConversationItem = {
  id: string;
  conversationId: string;
  knowledgeItemId: string;
  relationType: KnowledgeConversationItemRelationType;
  ordinal: number;
  createdAt: Date;
  createdBy: string;
};

export type KnowledgeConversation = {
  id: string;
  ownerUserId: string;
  title: string;
  sourceType: KnowledgeConversationSourceType;
  provider: string | null;
  model: string | null;
  capturedAt: Date;
  importedAt: Date | null;
  contentHash: string;
  version: number;
  deletedAt: Date | null;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
  items: KnowledgeConversationItem[];
};

export type KnowledgeConversationTurn = {
  id: string;
  conversationId: string;
  sequence: number;
  role: KnowledgeConversationRole;
  origin: KnowledgeProvenanceOrigin;
  content: string;
  name: string | null;
  occurredAt: Date | null;
  contentHash: string;
  createdAt: Date;
  createdBy: string;
};

export type KnowledgeSynthesis = {
  id: string;
  ownerUserId: string;
  scope: KnowledgeItemScope;
  organizationId: string | null;
  title: string;
  currentVersion: number;
  deletedAt: Date | null;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
};

export type KnowledgeSynthesisSourceInput = {
  kind: KnowledgeSynthesisSourceKind;
  sourceId: string;
  relationType: KnowledgeSynthesisSourceRelationType;
};

export type KnowledgeSynthesisSource = {
  id: string | null;
  synthesisVersionId: string;
  kind: KnowledgeSynthesisSourceKind;
  sourceId: string | null;
  relationType: KnowledgeSynthesisSourceRelationType;
  ordinal: number;
  accessible: boolean;
  createdAt: Date | null;
  createdBy: string | null;
};

export type KnowledgeSynthesisVersion = {
  id: string;
  synthesisId: string;
  version: number;
  content: string;
  unresolvedQuestions: string[];
  confidenceBasisPoints: number | null;
  createdAt: Date;
  createdBy: string;
  sources: KnowledgeSynthesisSource[];
};

export type KnowledgeSynthesisDetail = {
  synthesis: KnowledgeSynthesis;
  currentVersion: KnowledgeSynthesisVersion;
};

export const knowledgeProvenanceAuditActions = [
  'knowledge_annotation_created',
  'knowledge_annotation_revised',
  'knowledge_annotation_deleted',
  'knowledge_conversation_created',
  'knowledge_conversation_imported',
  'knowledge_conversation_item_linked',
  'knowledge_conversation_item_unlinked',
  'knowledge_conversation_turn_appended',
  'knowledge_synthesis_created',
  'knowledge_synthesis_version_appended',
  'knowledge_synthesis_source_linked',
  'knowledge_import_previewed',
  'knowledge_import_committed',
  'knowledge_import_duplicate_detected',
  'knowledge_import_rejected',
] as const;
export type KnowledgeProvenanceAuditAction =
  (typeof knowledgeProvenanceAuditActions)[number];

export const knowledgeProvenanceAuditTargets = [
  'knowledge_annotations',
  'knowledge_conversations',
  'knowledge_syntheses',
  'knowledge_imports',
] as const;
export type KnowledgeProvenanceAuditTarget =
  (typeof knowledgeProvenanceAuditTargets)[number];

export type KnowledgeProvenanceAuditMetadata = {
  version?: number;
  revision?: number;
  scope?: KnowledgeItemScope;
  annotationKind?: KnowledgeAnnotationKind;
  origin?: KnowledgeProvenanceOrigin;
  role?: KnowledgeConversationRole;
  relationType?:
    | KnowledgeConversationItemRelationType
    | KnowledgeSynthesisSourceRelationType;
  sourceKind?: KnowledgeSynthesisSourceKind;
  sourceCount?: number;
  turnCount?: number;
  itemCount?: number;
  format?: KnowledgeConversationSourceType;
  duplicate?: boolean;
};

export type KnowledgeProvenanceAuditEntry = {
  action: KnowledgeProvenanceAuditAction;
  actor: KnowledgeAuditActor;
  targetTable: KnowledgeProvenanceAuditTarget;
  targetId: string;
  metadata: KnowledgeProvenanceAuditMetadata;
};

export interface KnowledgeProvenanceAuditWriter {
  write(entry: KnowledgeProvenanceAuditEntry): Promise<void>;
}

export interface KnowledgeAccessRepository {
  findVisibleItem(
    actor: KnowledgeActor,
    itemId: string,
  ): Promise<KnowledgeItemAccess | null>;
  findOwnedItem(
    actor: KnowledgeActor,
    itemId: string,
  ): Promise<KnowledgeItemAccess | null>;
}

export interface KnowledgeAnnotationRepository {
  withConsistentSnapshot<T>(
    read: (repository: KnowledgeAnnotationRepository) => Promise<T>,
  ): Promise<T>;
  listVisible(input: {
    actor: KnowledgeActor;
    itemId: string;
    limit: number;
    boundary?: KnowledgePageBoundary;
  }): Promise<KnowledgePage<KnowledgeAnnotation> | null>;
  findVisible(input: {
    actor: KnowledgeActor;
    itemId: string;
    annotationId: string;
    includeDeleted?: boolean;
  }): Promise<KnowledgeAnnotation | null>;
  listRevisionsVisible(input: {
    actor: KnowledgeActor;
    itemId: string;
    annotationId: string;
    limit: number;
    beforeRevision?: number;
  }): Promise<{
    items: KnowledgeAnnotationRevision[];
    nextBoundary: KnowledgeSequenceBoundary | null;
  } | null>;
  create(input: {
    item: KnowledgeItemAccess;
    actor: KnowledgeActor;
    kind: KnowledgeAnnotationKind;
    origin: KnowledgeProvenanceOrigin;
    content: string;
  }): Promise<KnowledgeAnnotation>;
  findOwned(input: {
    actor: KnowledgeActor;
    itemId: string;
    annotationId: string;
    deleted: boolean;
  }): Promise<KnowledgeAnnotation | null>;
  revise(input: {
    actor: KnowledgeActor;
    annotationId: string;
    expectedRevision: number;
    kind: KnowledgeAnnotationKind;
    origin: KnowledgeProvenanceOrigin;
    content: string;
  }): Promise<KnowledgeAnnotation | null>;
  logicallyDelete(input: {
    actor: KnowledgeActor;
    annotationId: string;
    expectedRevision: number;
    deletedAt: Date;
  }): Promise<KnowledgeAnnotation | null>;
}

export interface KnowledgeConversationRepository {
  withConsistentSnapshot<T>(
    read: (repository: KnowledgeConversationRepository) => Promise<T>,
  ): Promise<T>;
  listVisible(input: {
    actor: KnowledgeActor;
    limit: number;
    boundary?: KnowledgePageBoundary;
  }): Promise<KnowledgePage<KnowledgeConversation>>;
  findVisible(input: {
    actor: KnowledgeActor;
    conversationId: string;
  }): Promise<KnowledgeConversation | null>;
  create(input: {
    actor: KnowledgeActor;
    title: string;
    sourceType: KnowledgeConversationSourceType;
    provider: string | null;
    model: string | null;
    capturedAt: Date;
    contentHash: string;
  }): Promise<KnowledgeConversation>;
  findOwned(input: {
    actor: KnowledgeActor;
    conversationId: string;
  }): Promise<KnowledgeConversation | null>;
  addItem(input: {
    actor: KnowledgeActor;
    conversationId: string;
    itemId: string;
    relationType: KnowledgeConversationItemRelationType;
    ordinal: number;
    expectedVersion: number;
  }): Promise<KnowledgeConversation | null>;
  removeItem(input: {
    actor: KnowledgeActor;
    conversationId: string;
    itemId: string;
    expectedVersion: number;
  }): Promise<KnowledgeConversation | null>;
  listTurnsVisible(input: {
    actor: KnowledgeActor;
    conversationId: string;
    limit: number;
    boundary?: KnowledgeSequenceBoundary;
  }): Promise<KnowledgeSequencePage<KnowledgeConversationTurn> | null>;
  nextTurnSequence(conversationId: string): Promise<number>;
  appendTurn(input: {
    actor: KnowledgeActor;
    conversationId: string;
    expectedVersion: number;
    sequence: number;
    role: KnowledgeConversationRole;
    origin: KnowledgeProvenanceOrigin;
    content: string;
    name: string | null;
    occurredAt: Date | null;
    contentHash: string;
    aggregateContentHash: string;
  }): Promise<{
    conversation: KnowledgeConversation;
    turn: KnowledgeConversationTurn;
  } | null>;
}

export interface KnowledgeSynthesisRepository {
  withConsistentSnapshot<T>(
    read: (repository: KnowledgeSynthesisRepository) => Promise<T>,
  ): Promise<T>;
  listVisible(input: {
    actor: KnowledgeActor;
    limit: number;
    boundary?: KnowledgePageBoundary;
    accessContext: KnowledgeSynthesisAccessContext;
  }): Promise<KnowledgePage<KnowledgeSynthesis>>;
  findVisible(input: {
    actor: KnowledgeActor;
    synthesisId: string;
    accessContext: KnowledgeSynthesisAccessContext;
  }): Promise<KnowledgeSynthesisDetail | null>;
  listVersionsVisible(input: {
    actor: KnowledgeActor;
    synthesisId: string;
    limit: number;
    beforeVersion?: number;
    accessContext: KnowledgeSynthesisAccessContext;
  }): Promise<{
    items: KnowledgeSynthesisVersion[];
    nextBoundary: KnowledgeSequenceBoundary | null;
  } | null>;
  validateSources(input: {
    actor: KnowledgeActor;
    sources: KnowledgeSynthesisSourceInput[];
    accessContext: KnowledgeSynthesisAccessContext;
    excludedSynthesisId?: string;
  }): Promise<boolean>;
  create(input: {
    actor: KnowledgeActor;
    scope: KnowledgeItemScope;
    organizationId: string | null;
    title: string;
    content: string;
    unresolvedQuestions: string[];
    confidenceBasisPoints: number | null;
    sources: KnowledgeSynthesisSourceInput[];
    accessContext: KnowledgeSynthesisAccessContext;
  }): Promise<KnowledgeSynthesisDetail>;
  findOwned(input: {
    actor: KnowledgeActor;
    synthesisId: string;
    accessContext: KnowledgeSynthesisAccessContext;
  }): Promise<KnowledgeSynthesisDetail | null>;
  appendVersion(input: {
    actor: KnowledgeActor;
    synthesisId: string;
    expectedVersion: number;
    content: string;
    unresolvedQuestions: string[];
    confidenceBasisPoints: number | null;
    sources: KnowledgeSynthesisSourceInput[];
    accessContext: KnowledgeSynthesisAccessContext;
  }): Promise<KnowledgeSynthesisDetail | null>;
}

export type KnowledgeProvenanceTransaction = {
  access: KnowledgeAccessRepository;
  annotations: KnowledgeAnnotationRepository;
  conversations: KnowledgeConversationRepository;
  syntheses: KnowledgeSynthesisRepository;
  audit: KnowledgeProvenanceAuditWriter;
};

export interface KnowledgeProvenanceUnitOfWork {
  run<T>(
    work: (transaction: KnowledgeProvenanceTransaction) => Promise<T>,
  ): Promise<T>;
}

export class KnowledgeProvenanceConflictError extends Error {
  constructor() {
    super('knowledge_provenance_conflict');
  }
}
