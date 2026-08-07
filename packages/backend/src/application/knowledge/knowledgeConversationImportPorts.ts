import type {
  KnowledgeActor,
  KnowledgeAuditActor,
} from './knowledgeItemPorts.js';
import type {
  KnowledgeConversationItemRelationType,
  KnowledgeConversationRole,
  KnowledgeConversationSourceType,
  KnowledgeProvenanceAuditWriter,
  KnowledgeProvenanceOrigin,
} from './knowledgeProvenancePorts.js';

export const knowledgeConversationImportProviders = [
  'openai',
  'anthropic',
  'google',
  'microsoft',
  'other',
] as const;
export type KnowledgeConversationImportProvider =
  (typeof knowledgeConversationImportProviders)[number];

export const knowledgeConversationImportModels = [
  'gpt',
  'claude',
  'gemini',
  'copilot',
  'other',
] as const;
export type KnowledgeConversationImportModel =
  (typeof knowledgeConversationImportModels)[number];

export const knowledgeConversationImportToolNames = [
  'search',
  'browser',
  'code',
  'file',
  'other',
] as const;
export type KnowledgeConversationImportToolName =
  (typeof knowledgeConversationImportToolNames)[number];

export const knowledgeConversationImportLimits = {
  rawBytes: 512 * 1024,
  canonicalBytes: 512 * 1024,
  turnBytes: 64 * 1024,
  turns: 200,
  linkedItems: 20,
  jsonDepth: 12,
  jsonNodes: 5_000,
  markdownLines: 5_000,
  markdownMetadataLineBytes: 1_024,
  titleCodePoints: 500,
  vocabularyCodePoints: 200,
  requestKeyCodePoints: 200,
  previewTokenBytes: 4_096,
  previewTtlMs: 10 * 60 * 1_000,
  transactionAttempts: 3,
} as const;

export type KnowledgeConversationImportLinkedItem = {
  itemId: string;
  relationType: KnowledgeConversationItemRelationType;
  ordinal: number;
};

export type KnowledgeConversationImportTurn = {
  role: KnowledgeConversationRole;
  origin: KnowledgeProvenanceOrigin;
  content: string;
  name: KnowledgeConversationImportToolName | null;
  occurredAt: string | null;
};

export type CanonicalKnowledgeConversationImport = {
  version: 1;
  format: KnowledgeConversationSourceType;
  title: string;
  provider: KnowledgeConversationImportProvider | null;
  model: KnowledgeConversationImportModel | null;
  turns: KnowledgeConversationImportTurn[];
  linkedItems: KnowledgeConversationImportLinkedItem[];
  canonicalPayloadHash: string;
};

export type KnowledgeConversationImportResult = {
  conversationId: string;
  created: boolean;
  reused: boolean;
  turnCount: number;
  linkedItemCount: number;
};

export type KnowledgeConversationImportRequestRecord = {
  id: string;
  ownerUserId: string;
  requestKeyHash: string;
  canonicalPayloadHash: string;
  sourceType: KnowledgeConversationSourceType;
  conversationId: string;
  turnCount: number;
  linkedItemCount: number;
  conversationDeleted: boolean;
};

export interface KnowledgeConversationImportRepository {
  checkOwnedItems(input: {
    actor: KnowledgeActor;
    itemIds: string[];
  }): Promise<boolean>;
  lockOwnedItems(input: {
    actor: KnowledgeActor;
    itemIds: string[];
  }): Promise<boolean>;
  findRequest(input: {
    actor: KnowledgeActor;
    requestKeyHash: string;
  }): Promise<KnowledgeConversationImportRequestRecord | null>;
  findConversationByPayload(input: {
    actor: KnowledgeActor;
    canonicalPayloadHash: string;
  }): Promise<KnowledgeConversationImportRequestRecord | null>;
  createImportedConversation(input: {
    actor: KnowledgeActor;
    ledgerId: string;
    conversationId: string;
    itemIds: string[];
    turnIds: string[];
    requestKeyHash: string;
    canonical: CanonicalKnowledgeConversationImport;
    importedAt: Date;
  }): Promise<KnowledgeConversationImportRequestRecord>;
  bindRequestToConversation(input: {
    actor: KnowledgeActor;
    ledgerId: string;
    requestKeyHash: string;
    canonical: CanonicalKnowledgeConversationImport;
    conversationId: string;
  }): Promise<KnowledgeConversationImportRequestRecord>;
}

export type KnowledgeConversationImportTransaction = {
  imports: KnowledgeConversationImportRepository;
  audit: KnowledgeProvenanceAuditWriter;
};

export interface KnowledgeConversationImportUnitOfWork {
  run<T>(
    work: (transaction: KnowledgeConversationImportTransaction) => Promise<T>,
  ): Promise<T>;
}

export type KnowledgeConversationImportAuditContext = {
  actor: KnowledgeActor;
  auditActor: KnowledgeAuditActor;
};

export class KnowledgeConversationImportConflictError extends Error {
  constructor() {
    super('knowledge_conversation_import_conflict');
    this.name = 'KnowledgeConversationImportConflictError';
  }
}
