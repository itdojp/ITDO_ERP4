import { KnowledgeHubApiError, requestKnowledgeJson } from './knowledgeHubApi';
import type { KnowledgeScope } from './knowledgeHubModel';
import {
  knowledgeAnnotationKinds,
  knowledgeConversationModels,
  knowledgeConversationProviders,
  knowledgeConversationRoles,
  knowledgeConversationSourceTypes,
  knowledgeConversationToolNames,
  knowledgeProvenanceOrigins,
  knowledgeRelationTypes,
  knowledgeSynthesisSourceKinds,
  type KnowledgeAnnotation,
  type KnowledgeAnnotationKind,
  type KnowledgeAnnotationRevision,
  type KnowledgeConversation,
  type KnowledgeConversationImportCommit,
  type KnowledgeConversationImportEnvelope,
  type KnowledgeConversationImportPreview,
  type KnowledgeConversationModel,
  type KnowledgeConversationProvider,
  type KnowledgeConversationRole,
  type KnowledgeConversationSourceType,
  type KnowledgeConversationToolName,
  type KnowledgeConversationTurn,
  type KnowledgeProvenanceOrigin,
  type KnowledgeRelationType,
  type KnowledgeSynthesis,
  type KnowledgeSynthesisDetail,
  type KnowledgeSynthesisSource,
  type KnowledgeSynthesisSourceKind,
  type KnowledgeSynthesisVersion,
} from './knowledgeProvenanceModel';

type JsonRecord = Record<string, unknown>;

function invalidResponse(): never {
  throw new KnowledgeHubApiError('invalid_response', null);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value ? value : invalidResponse();
}

function nullableString(value: unknown) {
  return value === null ? null : stringValue(value);
}

function integerValue(value: unknown, minimum = 0) {
  return Number.isSafeInteger(value) && Number(value) >= minimum
    ? Number(value)
    : invalidResponse();
}

function nullableInteger(value: unknown, minimum = 0) {
  return value === null ? null : integerValue(value, minimum);
}

function booleanValue(value: unknown) {
  return typeof value === 'boolean' ? value : invalidResponse();
}

function enumValue<T extends string>(values: readonly T[], value: unknown): T {
  return typeof value === 'string' && values.some((entry) => entry === value)
    ? (value as T)
    : invalidResponse();
}

function nullableEnum<T extends string>(
  values: readonly T[],
  value: unknown,
): T | null {
  return value === null ? null : enumValue(values, value);
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) invalidResponse();
  return value.map(stringValue);
}

async function requestProvenanceJson(path: string, options?: RequestInit) {
  try {
    return await requestKnowledgeJson(path, options);
  } catch (error) {
    if (
      error instanceof KnowledgeHubApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      throw new KnowledgeHubApiError('not_found', error.status);
    }
    throw error;
  }
}

export type KnowledgeProvenancePage<T> = {
  items: T[];
  nextCursor: string | null;
};

function normalizePage<T>(
  payload: JsonRecord,
  normalize: (value: unknown) => T,
): KnowledgeProvenancePage<T> {
  if (!Array.isArray(payload.items)) invalidResponse();
  return {
    items: payload.items.map(normalize),
    nextCursor: nullableString(payload.nextCursor),
  };
}

function pagePath(path: string, cursor?: string | null) {
  const query = new URLSearchParams({ limit: '100' });
  if (cursor) query.set('cursor', cursor);
  return `${path}?${query.toString()}`;
}

function normalizeAnnotationRevision(
  value: unknown,
): KnowledgeAnnotationRevision {
  if (!isRecord(value)) invalidResponse();
  return {
    id: stringValue(value.id),
    annotationId: stringValue(value.annotationId),
    revision: integerValue(value.revision, 1),
    kind: enumValue(knowledgeAnnotationKinds, value.kind),
    origin: enumValue(knowledgeProvenanceOrigins, value.origin),
    content: stringValue(value.content),
    createdAt: stringValue(value.createdAt),
  };
}

function normalizeAnnotation(value: unknown): KnowledgeAnnotation {
  if (!isRecord(value)) invalidResponse();
  const scope = enumValue(['personal', 'organization'] as const, value.scope);
  return {
    id: stringValue(value.id),
    knowledgeItemId: stringValue(value.knowledgeItemId),
    scope,
    kind: enumValue(knowledgeAnnotationKinds, value.kind),
    origin: enumValue(knowledgeProvenanceOrigins, value.origin),
    currentRevision: integerValue(value.currentRevision, 1),
    deletedAt: nullableString(value.deletedAt),
    createdAt: stringValue(value.createdAt),
    updatedAt: stringValue(value.updatedAt),
    revision: normalizeAnnotationRevision(value.revision),
  };
}

function normalizeConversationItem(value: unknown) {
  if (!isRecord(value)) invalidResponse();
  return {
    id: stringValue(value.id),
    knowledgeItemId: stringValue(value.knowledgeItemId),
    relationType: enumValue(knowledgeRelationTypes, value.relationType),
    ordinal: integerValue(value.ordinal),
    createdAt: stringValue(value.createdAt),
  };
}

function normalizeConversation(value: unknown): KnowledgeConversation {
  if (!isRecord(value) || !Array.isArray(value.items)) invalidResponse();
  return {
    id: stringValue(value.id),
    title: stringValue(value.title),
    sourceType: enumValue(knowledgeConversationSourceTypes, value.sourceType),
    provider: nullableEnum(knowledgeConversationProviders, value.provider),
    model: nullableEnum(knowledgeConversationModels, value.model),
    capturedAt: stringValue(value.capturedAt),
    importedAt: nullableString(value.importedAt),
    version: integerValue(value.version, 1),
    createdAt: stringValue(value.createdAt),
    updatedAt: stringValue(value.updatedAt),
    items: value.items.map(normalizeConversationItem),
  };
}

function normalizeConversationTurn(value: unknown): KnowledgeConversationTurn {
  if (!isRecord(value)) invalidResponse();
  return {
    id: stringValue(value.id),
    conversationId: stringValue(value.conversationId),
    sequence: integerValue(value.sequence, 1),
    role: enumValue(knowledgeConversationRoles, value.role),
    origin: enumValue(knowledgeProvenanceOrigins, value.origin),
    content: stringValue(value.content),
    name: nullableEnum(knowledgeConversationToolNames, value.name),
    occurredAt: nullableString(value.occurredAt),
    createdAt: stringValue(value.createdAt),
  };
}

function normalizeSynthesisSource(value: unknown): KnowledgeSynthesisSource {
  if (!isRecord(value)) invalidResponse();
  const id = nullableString(value.id);
  const sourceId = nullableString(value.sourceId);
  const accessible = booleanValue(value.accessible);
  const createdAt = nullableString(value.createdAt);
  if (!accessible && (id !== null || sourceId !== null || createdAt !== null)) {
    invalidResponse();
  }
  return {
    id,
    kind: enumValue(knowledgeSynthesisSourceKinds, value.kind),
    sourceId,
    relationType: enumValue(knowledgeRelationTypes, value.relationType),
    ordinal: integerValue(value.ordinal),
    accessible,
    createdAt,
  };
}

function normalizeSynthesisVersion(value: unknown): KnowledgeSynthesisVersion {
  if (!isRecord(value) || !Array.isArray(value.sources)) invalidResponse();
  return {
    id: stringValue(value.id),
    synthesisId: stringValue(value.synthesisId),
    version: integerValue(value.version, 1),
    content: stringValue(value.content),
    unresolvedQuestions: stringArray(value.unresolvedQuestions),
    confidenceBasisPoints: nullableInteger(value.confidenceBasisPoints),
    createdAt: stringValue(value.createdAt),
    sources: value.sources.map(normalizeSynthesisSource),
  };
}

function normalizeSynthesis(value: unknown): KnowledgeSynthesis {
  if (!isRecord(value)) invalidResponse();
  return {
    id: stringValue(value.id),
    scope: enumValue(['personal', 'organization'] as const, value.scope),
    title: stringValue(value.title),
    currentVersion: integerValue(value.currentVersion, 1),
    createdAt: stringValue(value.createdAt),
    updatedAt: stringValue(value.updatedAt),
  };
}

function normalizeSynthesisDetail(value: unknown): KnowledgeSynthesisDetail {
  if (!isRecord(value)) invalidResponse();
  return {
    synthesis: normalizeSynthesis(value.synthesis),
    currentVersion: normalizeSynthesisVersion(value.currentVersion),
  };
}

function jsonOptions(method: 'POST' | 'DELETE', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function listKnowledgeAnnotations(
  itemId: string,
  options: {
    cursor?: string | null;
    includeDeleted?: boolean;
  } = {},
) {
  const path = pagePath(
    `/knowledge/items/${encodeURIComponent(itemId)}/annotations`,
    options.cursor,
  );
  const payload = await requestProvenanceJson(
    options.includeDeleted ? `${path}&includeDeleted=true` : path,
  );
  return normalizePage(payload, normalizeAnnotation);
}

export async function getKnowledgeAnnotationCapabilities(itemId: string) {
  const payload = await requestProvenanceJson(
    `/knowledge/items/${encodeURIComponent(itemId)}/annotations/capabilities`,
  );
  return {
    canManageAnnotations: booleanValue(payload.canManageAnnotations),
  };
}

export async function createKnowledgeAnnotation(input: {
  itemId: string;
  kind: KnowledgeAnnotationKind;
  origin: KnowledgeProvenanceOrigin;
  content: string;
}) {
  return normalizeAnnotation(
    await requestProvenanceJson(
      `/knowledge/items/${encodeURIComponent(input.itemId)}/annotations`,
      jsonOptions('POST', {
        kind: input.kind,
        origin: input.origin,
        content: input.content,
      }),
    ),
  );
}

export async function reviseKnowledgeAnnotation(input: {
  itemId: string;
  annotationId: string;
  expectedRevision: number;
  kind: KnowledgeAnnotationKind;
  origin: KnowledgeProvenanceOrigin;
  content: string;
}) {
  return normalizeAnnotation(
    await requestProvenanceJson(
      `/knowledge/items/${encodeURIComponent(input.itemId)}/annotations/${encodeURIComponent(input.annotationId)}/revisions`,
      jsonOptions('POST', {
        expectedRevision: input.expectedRevision,
        kind: input.kind,
        origin: input.origin,
        content: input.content,
      }),
    ),
  );
}

export async function deleteKnowledgeAnnotation(input: {
  itemId: string;
  annotationId: string;
  expectedRevision: number;
}) {
  return normalizeAnnotation(
    await requestProvenanceJson(
      `/knowledge/items/${encodeURIComponent(input.itemId)}/annotations/${encodeURIComponent(input.annotationId)}`,
      jsonOptions('DELETE', { expectedRevision: input.expectedRevision }),
    ),
  );
}

export async function listKnowledgeAnnotationRevisions(input: {
  itemId: string;
  annotationId: string;
  cursor?: string | null;
}) {
  const payload = await requestProvenanceJson(
    pagePath(
      `/knowledge/items/${encodeURIComponent(input.itemId)}/annotations/${encodeURIComponent(input.annotationId)}/revisions`,
      input.cursor,
    ),
  );
  return normalizePage(payload, normalizeAnnotationRevision);
}

export async function listKnowledgeConversations(input: {
  knowledgeItemId: string;
  cursor?: string | null;
}) {
  const query = new URLSearchParams({
    knowledgeItemId: input.knowledgeItemId,
    limit: '100',
  });
  if (input.cursor) query.set('cursor', input.cursor);
  const payload = await requestProvenanceJson(
    `/knowledge/conversations?${query.toString()}`,
  );
  return normalizePage(payload, normalizeConversation);
}

export async function listKnowledgeConversationTurns(
  conversationId: string,
  cursor?: string | null,
) {
  const payload = await requestProvenanceJson(
    pagePath(
      `/knowledge/conversations/${encodeURIComponent(conversationId)}/turns`,
      cursor,
    ),
  );
  return normalizePage(payload, normalizeConversationTurn);
}

function normalizeImportPreview(
  value: unknown,
): KnowledgeConversationImportPreview {
  if (!isRecord(value) || !isRecord(value.summary)) invalidResponse();
  const summary = value.summary;
  if (
    !Array.isArray(summary.roles) ||
    !Array.isArray(summary.origins) ||
    !Array.isArray(value.warnings) ||
    !Array.isArray(value.rejectedFields)
  ) {
    invalidResponse();
  }
  return {
    summary: {
      format: enumValue(knowledgeConversationSourceTypes, summary.format),
      title: stringValue(summary.title),
      provider: nullableEnum(knowledgeConversationProviders, summary.provider),
      model: nullableEnum(knowledgeConversationModels, summary.model),
      roles: summary.roles.map((entry) =>
        enumValue(knowledgeConversationRoles, entry),
      ),
      origins: summary.origins.map((entry) =>
        enumValue(knowledgeProvenanceOrigins, entry),
      ),
      turnCount: integerValue(summary.turnCount, 1),
      linkedItemCount: integerValue(summary.linkedItemCount),
    },
    warnings: value.warnings.map(stringValue),
    rejectedFields: value.rejectedFields.map(stringValue),
    previewToken: stringValue(value.previewToken),
    expiresAt: stringValue(value.expiresAt),
  };
}

function normalizeImportCommit(
  value: unknown,
): KnowledgeConversationImportCommit {
  if (!isRecord(value)) invalidResponse();
  const result = enumValue(['created', 'reused'] as const, value.result);
  const created = booleanValue(value.created);
  const reused = booleanValue(value.reused);
  if ((result === 'created') !== created || (result === 'reused') !== reused) {
    invalidResponse();
  }
  return {
    conversationId: stringValue(value.conversationId),
    created,
    reused,
    turnCount: integerValue(value.turnCount, 1),
    linkedItemCount: integerValue(value.linkedItemCount),
    result,
  };
}

export async function previewKnowledgeConversationImport(
  envelope: KnowledgeConversationImportEnvelope,
) {
  return normalizeImportPreview(
    await requestProvenanceJson(
      '/knowledge/conversations/import/preview',
      jsonOptions('POST', envelope),
    ),
  );
}

export async function commitKnowledgeConversationImport(
  input: KnowledgeConversationImportEnvelope & {
    previewToken: string;
    requestKey: string;
  },
) {
  return normalizeImportCommit(
    await requestProvenanceJson(
      '/knowledge/conversations/import/commit',
      jsonOptions('POST', input),
    ),
  );
}

export async function listKnowledgeSyntheses(cursor?: string | null) {
  const payload = await requestProvenanceJson(
    pagePath('/knowledge/syntheses', cursor),
  );
  return normalizePage(payload, normalizeSynthesis);
}

export async function getKnowledgeSynthesis(synthesisId: string) {
  return normalizeSynthesisDetail(
    await requestProvenanceJson(
      `/knowledge/syntheses/${encodeURIComponent(synthesisId)}`,
    ),
  );
}

type SynthesisVersionInput = {
  content: string;
  unresolvedQuestions: string[];
  confidenceBasisPoints: number | null;
  sources: {
    kind: KnowledgeSynthesisSourceKind;
    sourceId: string;
    relationType: KnowledgeRelationType;
  }[];
};

export async function createKnowledgeSynthesis(
  input: SynthesisVersionInput & { scope: KnowledgeScope; title: string },
) {
  return normalizeSynthesisDetail(
    await requestProvenanceJson(
      '/knowledge/syntheses',
      jsonOptions('POST', input),
    ),
  );
}

export async function appendKnowledgeSynthesisVersion(
  input: SynthesisVersionInput & {
    synthesisId: string;
    expectedVersion: number;
  },
) {
  const { synthesisId, ...body } = input;
  return normalizeSynthesisDetail(
    await requestProvenanceJson(
      `/knowledge/syntheses/${encodeURIComponent(synthesisId)}/versions`,
      jsonOptions('POST', body),
    ),
  );
}

export async function listKnowledgeSynthesisVersions(
  synthesisId: string,
  cursor?: string | null,
) {
  const payload = await requestProvenanceJson(
    pagePath(
      `/knowledge/syntheses/${encodeURIComponent(synthesisId)}/versions`,
      cursor,
    ),
  );
  return normalizePage(payload, normalizeSynthesisVersion);
}

// Type-only exports keep component inputs explicit without exposing normalizers.
export type {
  KnowledgeConversationModel,
  KnowledgeConversationProvider,
  KnowledgeConversationRole,
  KnowledgeConversationSourceType,
  KnowledgeConversationToolName,
  KnowledgeProvenanceOrigin,
  KnowledgeRelationType,
};
