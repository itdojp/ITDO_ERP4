import type { KnowledgeScope } from './knowledgeHubModel';

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

export const knowledgeConversationRoles = [
  'user',
  'assistant',
  'system',
  'tool',
] as const;
export type KnowledgeConversationRole =
  (typeof knowledgeConversationRoles)[number];

export const knowledgeRelationTypes = [
  'primary',
  'supporting',
  'contradicting',
  'context',
] as const;
export type KnowledgeRelationType = (typeof knowledgeRelationTypes)[number];

export const knowledgeConversationSourceTypes = [
  'manual',
  'json',
  'markdown',
] as const;
export type KnowledgeConversationSourceType =
  (typeof knowledgeConversationSourceTypes)[number];

export const knowledgeConversationProviders = [
  'openai',
  'anthropic',
  'google',
  'microsoft',
  'other',
] as const;
export type KnowledgeConversationProvider =
  (typeof knowledgeConversationProviders)[number];

export const knowledgeConversationModels = [
  'gpt',
  'claude',
  'gemini',
  'copilot',
  'other',
] as const;
export type KnowledgeConversationModel =
  (typeof knowledgeConversationModels)[number];

export const knowledgeConversationToolNames = [
  'search',
  'browser',
  'code',
  'file',
  'other',
] as const;
export type KnowledgeConversationToolName =
  (typeof knowledgeConversationToolNames)[number];

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

export type KnowledgeAnnotationRevision = {
  id: string;
  annotationId: string;
  revision: number;
  kind: KnowledgeAnnotationKind;
  origin: KnowledgeProvenanceOrigin;
  content: string;
  createdAt: string;
};

export type KnowledgeAnnotation = {
  id: string;
  knowledgeItemId: string;
  scope: KnowledgeScope;
  kind: KnowledgeAnnotationKind;
  origin: KnowledgeProvenanceOrigin;
  currentRevision: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revision: KnowledgeAnnotationRevision;
};

export type KnowledgeConversationItem = {
  id: string;
  knowledgeItemId: string;
  relationType: KnowledgeRelationType;
  ordinal: number;
  createdAt: string;
};

export type KnowledgeConversation = {
  id: string;
  title: string;
  sourceType: KnowledgeConversationSourceType;
  provider: KnowledgeConversationProvider | null;
  model: KnowledgeConversationModel | null;
  capturedAt: string;
  importedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  items: KnowledgeConversationItem[];
};

export type KnowledgeConversationTurn = {
  id: string;
  conversationId: string;
  sequence: number;
  role: KnowledgeConversationRole;
  origin: KnowledgeProvenanceOrigin;
  content: string;
  name: KnowledgeConversationToolName | null;
  occurredAt: string | null;
  createdAt: string;
};

export type KnowledgeConversationImportPreview = {
  summary: {
    format: KnowledgeConversationSourceType;
    title: string;
    provider: KnowledgeConversationProvider | null;
    model: KnowledgeConversationModel | null;
    roles: KnowledgeConversationRole[];
    origins: KnowledgeProvenanceOrigin[];
    turnCount: number;
    linkedItemCount: number;
  };
  warnings: string[];
  rejectedFields: string[];
  previewToken: string;
  expiresAt: string;
};

export type KnowledgeConversationImportCommit = {
  conversationId: string;
  created: boolean;
  reused: boolean;
  turnCount: number;
  linkedItemCount: number;
  result: 'created' | 'reused';
};

export type KnowledgeSynthesisSource = {
  id: string | null;
  kind: KnowledgeSynthesisSourceKind;
  sourceId: string | null;
  relationType: KnowledgeRelationType;
  ordinal: number;
  accessible: boolean;
  createdAt: string | null;
};

export type KnowledgeSynthesisVersion = {
  id: string;
  synthesisId: string;
  version: number;
  content: string;
  unresolvedQuestions: string[];
  confidenceBasisPoints: number | null;
  createdAt: string;
  sources: KnowledgeSynthesisSource[];
};

export type KnowledgeSynthesis = {
  id: string;
  scope: KnowledgeScope;
  title: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeSynthesisDetail = {
  synthesis: KnowledgeSynthesis;
  currentVersion: KnowledgeSynthesisVersion;
};

export type KnowledgeImportLinkedItem = {
  itemId: string;
  relationType: KnowledgeRelationType;
};

export type KnowledgeConversationImportEnvelope = {
  format: KnowledgeConversationSourceType;
  inputBase64: string;
  linkedItems: KnowledgeImportLinkedItem[];
};

export const knowledgeAnnotationKindLabels: Record<
  KnowledgeAnnotationKind,
  string
> = {
  note: '本人メモ',
  question: '質問',
  hypothesis: '仮説',
  quote: '引用',
  todo: 'TODO',
};

export const knowledgeOriginLabels: Record<KnowledgeProvenanceOrigin, string> =
  {
    user: '本人',
    external: '外部情報',
    ai: 'AI',
    system: 'System',
    tool: 'Tool',
  };

export const knowledgeRoleLabels: Record<KnowledgeConversationRole, string> = {
  user: 'User',
  assistant: 'AI Assistant',
  system: 'System',
  tool: 'Tool',
};

export const knowledgeRelationLabels: Record<KnowledgeRelationType, string> = {
  primary: '主根拠',
  supporting: '補強',
  contradicting: '反証',
  context: '文脈',
};

export const KNOWLEDGE_ANNOTATION_MAX_BYTES = 64 * 1024;
export const KNOWLEDGE_IMPORT_MAX_BYTES = 512 * 1024;
export const KNOWLEDGE_SYNTHESIS_MAX_BYTES = 256 * 1024;

export function utf8Length(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function roleOriginCompatible(
  role: KnowledgeConversationRole,
  origin: KnowledgeProvenanceOrigin,
) {
  if (role === 'user') return origin === 'user' || origin === 'external';
  if (role === 'assistant') return origin === 'ai' || origin === 'external';
  if (role === 'system') return origin === 'system';
  return origin === 'tool';
}

export function encodeKnowledgeImportInput(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
}

export function buildManualKnowledgeConversation(input: {
  title: string;
  role: KnowledgeConversationRole;
  origin: KnowledgeProvenanceOrigin;
  content: string;
  occurredAt?: string | null;
}) {
  return JSON.stringify({
    title: input.title.trim(),
    provider: null,
    model: null,
    turns: [
      {
        role: input.role,
        origin: input.origin,
        content: input.content,
        name: input.role === 'tool' ? 'other' : null,
        occurredAt: input.occurredAt || null,
      },
    ],
  });
}

export function formatKnowledgeConfidence(value: number | null) {
  return value === null ? '未設定' : `${(value / 100).toFixed(2)}%`;
}
