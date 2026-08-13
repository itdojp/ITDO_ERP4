import { requestKnowledgeJson, KnowledgeHubApiError } from './knowledgeHubApi';
import type {
  IncomingKnowledgeCaptureDraft,
  KnowledgeCaptureField,
  KnowledgeCapturePreview,
  KnowledgeCaptureResult,
  KnowledgeCaptureSubmission,
} from './knowledgeCaptureModel';
import { isKnowledgeSourceType } from './knowledgeHubModel';

type RecordValue = Record<string, unknown>;

function record(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function string(value: unknown) {
  if (typeof value !== 'string' || !value)
    throw new KnowledgeHubApiError('invalid_response', null);
  return value;
}

function nullableString(value: unknown) {
  if (value === null) return null;
  return string(value);
}

function integer(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  return Number(value);
}

function captureFields(value: unknown): KnowledgeCaptureField[] {
  const allowed = new Set<KnowledgeCaptureField>([
    'title',
    'url',
    'selectedText',
    'description',
    'author',
    'publishedAt',
  ]);
  if (
    !Array.isArray(value) ||
    value.some((entry) => !allowed.has(entry as KnowledgeCaptureField))
  ) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  return value as KnowledgeCaptureField[];
}

function draft(value: unknown): IncomingKnowledgeCaptureDraft {
  if (!record(value) || value.schemaVersion !== 1) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  if (
    value.channel !== 'pwa_share_target' &&
    value.channel !== 'browser_extension'
  ) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  return {
    schemaVersion: 1,
    channel: value.channel,
    title: nullableString(value.title),
    url: nullableString(value.url),
    selectedText: nullableString(value.selectedText),
    description: nullableString(value.description),
    author: nullableString(value.author),
    publishedAt: nullableString(value.publishedAt),
    capturedAt: string(value.capturedAt),
  };
}

function result(
  value: unknown,
  expectedRequestCaptureId: string,
): KnowledgeCaptureResult {
  if (!record(value)) throw new KnowledgeHubApiError('invalid_response', null);
  if (
    value.status !== 'pending' &&
    value.status !== 'ready' &&
    value.status !== 'failed'
  ) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  if (typeof value.reused !== 'boolean')
    throw new KnowledgeHubApiError('invalid_response', null);
  const requestCaptureId = string(value.requestCaptureId);
  if (requestCaptureId !== expectedRequestCaptureId) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  return {
    captureId: string(value.captureId),
    requestCaptureId,
    itemId: string(value.itemId),
    snapshotId: string(value.snapshotId),
    status: value.status,
    failureCode: nullableString(value.failureCode),
    reused: value.reused,
    createdAt: string(value.createdAt),
    committedAt: nullableString(value.committedAt),
    failedAt: nullableString(value.failedAt),
  };
}

export async function previewKnowledgeCapture(
  submission: KnowledgeCaptureSubmission & { requestKey: string },
  signal?: AbortSignal,
): Promise<KnowledgeCapturePreview> {
  const value = await requestKnowledgeJson('/knowledge/captures/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission),
    signal,
  });
  if (!record(value.duplicateCandidate)) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  const sourceType = value.sourceType;
  const scope = value.scope;
  if (
    !isKnowledgeSourceType(sourceType) ||
    (scope !== 'personal' && scope !== 'organization')
  ) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  const status = value.duplicateCandidate.status;
  if (
    status !== null &&
    status !== 'pending' &&
    status !== 'ready' &&
    status !== 'failed'
  ) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  if (
    typeof value.duplicateCandidate.detected !== 'boolean' ||
    typeof value.requiresOrganizationConfirmation !== 'boolean'
  ) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  return {
    captureId: string(value.captureId),
    draft: draft(value.normalizedDraft),
    selectedFields: captureFields(value.selectedFields),
    omittedFields: captureFields(value.omittedFields),
    scope,
    organizationGroupAccountIds: [...submission.organizationGroupAccountIds],
    sourceType,
    fieldCount: integer(value.fieldCount),
    byteCount: integer(value.byteCount),
    duplicateCandidate: {
      detected: value.duplicateCandidate.detected,
      status,
    },
    requiresOrganizationConfirmation: value.requiresOrganizationConfirmation,
    previewToken: string(value.previewToken),
    expiresAt: string(value.expiresAt),
  };
}

export async function commitKnowledgeCapture(
  input: {
    preview: KnowledgeCapturePreview;
    requestKey: string;
    organizationConfirmed: boolean;
  },
  signal?: AbortSignal,
) {
  const value = await requestKnowledgeJson('/knowledge/captures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      draft: input.preview.draft,
      selectedFields: input.preview.selectedFields,
      scope: input.preview.scope,
      organizationGroupAccountIds: input.preview.organizationGroupAccountIds,
      sourceType: input.preview.sourceType,
      confirmed: true,
      organizationConfirmed: input.organizationConfirmed,
      previewToken: input.preview.previewToken,
      requestKey: input.requestKey,
    }),
    ...(signal ? { signal } : {}),
  });
  return result(value, input.preview.captureId);
}

export async function reconcileKnowledgeCapture(
  input: { preview: KnowledgeCapturePreview; requestKey: string },
  signal?: AbortSignal,
) {
  const value = await requestKnowledgeJson(
    `/knowledge/captures/${encodeURIComponent(input.preview.captureId)}/reconcile`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draft: input.preview.draft,
        selectedFields: input.preview.selectedFields,
        scope: input.preview.scope,
        organizationGroupAccountIds: input.preview.organizationGroupAccountIds,
        sourceType: input.preview.sourceType,
        previewToken: input.preview.previewToken,
        requestKey: input.requestKey,
      }),
      ...(signal ? { signal } : {}),
    },
  );
  return result(value, input.preview.captureId);
}
