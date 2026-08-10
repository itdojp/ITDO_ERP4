import { apiResponse } from '../../api';
import { createKnowledgeRequestKey } from '../knowledge-hub/knowledgeHubModel';
import type {
  KnowledgeShareCommit,
  KnowledgeShareLabelAssignmentOption,
  KnowledgeSharePreview,
  KnowledgeShareRoomCard,
  KnowledgeShareSelectionDraft,
  KnowledgeShareSelectionRequest,
  KnowledgeShareSourceOpen,
  KnowledgeShareStatusResponse,
  KnowledgeThreadPromotionCommit,
  KnowledgeThreadPromotionDraft,
  KnowledgeThreadPromotionPreview,
  KnowledgeThreadPromotionRequest,
  RoomKnowledgeShareSummary,
} from './knowledgeShareModel';
import {
  buildKnowledgeShareSelectionRequest,
  buildKnowledgeThreadPromotionRequest,
  isBoundedKnowledgeShareId,
  normalizeKnowledgeShareCommit,
  normalizeKnowledgeShareLabelAssignmentOptions,
  normalizeKnowledgeShareMessageIds,
  normalizeKnowledgeSharePreview,
  normalizeKnowledgeShareRoomCard,
  normalizeKnowledgeShareSourceOpen,
  normalizeKnowledgeShareStatus,
  normalizeKnowledgeThreadPromotionCommit,
  normalizeKnowledgeThreadPromotionPreview,
  normalizeRoomKnowledgeShareSummaries,
  promotionCommitMatchesRequest,
  promotionPreviewMatchesRequest,
  sharePreviewMatchesSelection,
} from './knowledgeShareModel';

export const knowledgeShareSafeErrorCodes = [
  'external_audience_not_supported',
  'forbidden',
  'idempotency_conflict',
  'invalid_request',
  'invalid_response',
  'network_error',
  'not_found',
  'organization_confirmation_required',
  'preview_token_expired',
  'preview_token_invalid',
  'promotion_conflict',
  'request_aborted',
  'secure_request_key_unavailable',
  'share_post_failed',
  'stale_preview',
  'unauthorized',
  'unknown_error',
] as const;

export type KnowledgeShareSafeErrorCode =
  (typeof knowledgeShareSafeErrorCodes)[number];

const safeErrorCodeSet = new Set<string>(knowledgeShareSafeErrorCodes);

export class KnowledgeShareSafeError extends Error {
  constructor(
    readonly code: KnowledgeShareSafeErrorCode,
    readonly status: number | null,
  ) {
    super('knowledge_share_request_failed');
    this.name = 'KnowledgeShareSafeError';
  }
}

export type KnowledgeShareReadOptions = {
  signal?: AbortSignal;
};

export type KnowledgeSharePreviewInput = {
  itemId: string;
  destinationRoomId: string;
  selection: KnowledgeShareSelectionDraft;
};

export type KnowledgeShareCommitInput = KnowledgeSharePreviewInput & {
  previewToken: string;
  requestKey: string;
};

export type KnowledgeThreadPromotionPreviewInput = {
  rootMessageId: string;
  request: KnowledgeThreadPromotionDraft;
};

export type KnowledgeThreadPromotionCommitInput =
  KnowledgeThreadPromotionPreviewInput & {
    previewToken: string;
    requestKey: string;
    organizationAudienceConfirmed: boolean;
  };

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAbortError(error: unknown) {
  return (
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError') ||
    (isRecord(error) && error.name === 'AbortError')
  );
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function safeBackendErrorCode(payload: unknown): KnowledgeShareSafeErrorCode {
  const code =
    isRecord(payload) && isRecord(payload.error)
      ? payload.error.code
      : undefined;
  return typeof code === 'string' && safeErrorCodeSet.has(code)
    ? (code as KnowledgeShareSafeErrorCode)
    : 'unknown_error';
}

async function requestJson(path: string, options?: RequestInit) {
  let response: Response;
  try {
    response = options
      ? await apiResponse(path, options)
      : await apiResponse(path);
  } catch (error) {
    throw new KnowledgeShareSafeError(
      isAbortError(error) ? 'request_aborted' : 'network_error',
      null,
    );
  }
  const payload = await safeJson(response);
  if (!response.ok) {
    throw new KnowledgeShareSafeError(
      safeBackendErrorCode(payload),
      response.status,
    );
  }
  return { payload, status: response.status };
}

function invalidRequest(): never {
  throw new KnowledgeShareSafeError('invalid_request', null);
}

function invalidResponse(status: number): never {
  throw new KnowledgeShareSafeError('invalid_response', status);
}

function boundedId(value: unknown) {
  if (!isBoundedKnowledgeShareId(value)) invalidRequest();
  return value;
}

function labelItemId(value: unknown) {
  const id = boundedId(value);
  if ([...id].length > 100 || new TextEncoder().encode(id).byteLength > 400) {
    invalidRequest();
  }
  return id;
}

function previewToken(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value ||
    new TextEncoder().encode(value).byteLength > 4096
  ) {
    invalidRequest();
  }
  return value;
}

export function createKnowledgeShareRequestKey() {
  try {
    return createKnowledgeRequestKey();
  } catch {
    throw new KnowledgeShareSafeError('secure_request_key_unavailable', null);
  }
}

function requestKey(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    [...value].length > 200 ||
    new TextEncoder().encode(value).byteLength > 800
  ) {
    invalidRequest();
  }
  return value;
}

function selectionRequest(value: unknown) {
  const selection = buildKnowledgeShareSelectionRequest(value);
  if (!selection) invalidRequest();
  return selection;
}

function promotionRequest(value: unknown) {
  const request = buildKnowledgeThreadPromotionRequest(value);
  if (!request) invalidRequest();
  return request;
}

function sharePreviewBody(
  destinationRoomId: string,
  selection: KnowledgeShareSelectionRequest,
) {
  return {
    destinationRoomId,
    selection: {
      includeTitle: selection.includeTitle,
      includeSourceType: selection.includeSourceType,
      includeCanonicalUrl: selection.includeCanonicalUrl,
      snapshot:
        selection.snapshot === null
          ? null
          : {
              snapshotId: selection.snapshot.snapshotId,
              includeProvenance: selection.snapshot.includeProvenance,
              includeExcerpt: selection.snapshot.includeExcerpt,
            },
      labelAssignmentIds: [...selection.labelAssignmentIds],
      annotations: selection.annotations.map((annotation) => ({
        annotationId: annotation.annotationId,
        revision: annotation.revision,
      })),
      conversationTurnIds: [...selection.conversationTurnIds],
      syntheses: selection.syntheses.map((synthesis) => ({
        synthesisId: synthesis.synthesisId,
        version: synthesis.version,
      })),
      sharerNote: selection.sharerNote,
    },
  };
}

function promotionBody(request: KnowledgeThreadPromotionRequest) {
  return {
    selectedReplyMessageIds: [...request.selectedReplyMessageIds],
    includeSharedCard: request.includeSharedCard,
    destination: {
      scope: request.destination.scope,
      organizationGroupAccountIds: [
        ...request.destination.organizationGroupAccountIds,
      ],
    },
    synthesis: {
      title: request.synthesis.title,
      content: request.synthesis.content,
      confidenceBasisPoints: request.synthesis.confidenceBasisPoints,
      unresolvedQuestions: [...request.synthesis.unresolvedQuestions],
    },
  };
}

function jsonPost(body?: unknown, signal?: AbortSignal): RequestInit {
  return {
    method: 'POST',
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
    ...(signal ? { signal } : {}),
  };
}

export async function previewKnowledgeShare(
  input: KnowledgeSharePreviewInput,
  options: KnowledgeShareReadOptions = {},
): Promise<KnowledgeSharePreview> {
  const itemId = boundedId(input.itemId);
  const destinationRoomId = boundedId(input.destinationRoomId);
  const selection = selectionRequest(input.selection);
  const { payload, status } = await requestJson(
    `/knowledge/items/${encodeURIComponent(itemId)}/shares/preview`,
    jsonPost(sharePreviewBody(destinationRoomId, selection), options.signal),
  );
  const preview = normalizeKnowledgeSharePreview(payload);
  if (!preview || !sharePreviewMatchesSelection(preview, selection)) {
    invalidResponse(status);
  }
  return preview;
}

export async function commitKnowledgeShare(
  input: KnowledgeShareCommitInput,
): Promise<KnowledgeShareCommit> {
  const itemId = boundedId(input.itemId);
  const destinationRoomId = boundedId(input.destinationRoomId);
  const selection = selectionRequest(input.selection);
  const body = {
    ...sharePreviewBody(destinationRoomId, selection),
    confirmed: true as const,
    previewToken: previewToken(input.previewToken),
    requestKey: requestKey(input.requestKey),
  };
  const { payload, status } = await requestJson(
    `/knowledge/items/${encodeURIComponent(itemId)}/shares`,
    jsonPost(body),
  );
  const commit = normalizeKnowledgeShareCommit(payload);
  if (!commit) invalidResponse(status);
  return commit;
}

export async function getKnowledgeShareStatus(
  shareIdValue: string,
  options: KnowledgeShareReadOptions = {},
): Promise<KnowledgeShareStatusResponse> {
  const shareId = boundedId(shareIdValue);
  const { payload, status } = await requestJson(
    `/knowledge/shares/${encodeURIComponent(shareId)}`,
    options.signal ? { signal: options.signal } : undefined,
  );
  const result = normalizeKnowledgeShareStatus(payload);
  if (!result) invalidResponse(status);
  return result;
}

export async function reconcileKnowledgeShare(
  shareIdValue: string,
  options: KnowledgeShareReadOptions = {},
): Promise<KnowledgeShareStatusResponse> {
  const shareId = boundedId(shareIdValue);
  const { payload, status } = await requestJson(
    `/knowledge/shares/${encodeURIComponent(shareId)}/reconcile`,
    { ...jsonPost(), ...(options.signal ? { signal: options.signal } : {}) },
  );
  const result = normalizeKnowledgeShareStatus(payload);
  if (!result) invalidResponse(status);
  return result;
}

export async function revokeKnowledgeShare(
  shareIdValue: string,
  options: KnowledgeShareReadOptions = {},
): Promise<KnowledgeShareStatusResponse> {
  const shareId = boundedId(shareIdValue);
  const { payload, status } = await requestJson(
    `/knowledge/shares/${encodeURIComponent(shareId)}/revoke`,
    { ...jsonPost(), ...(options.signal ? { signal: options.signal } : {}) },
  );
  const result = normalizeKnowledgeShareStatus(payload);
  if (!result) invalidResponse(status);
  return result;
}

export async function getKnowledgeShareCard(
  messageIdValue: string,
  options: KnowledgeShareReadOptions = {},
): Promise<KnowledgeShareRoomCard> {
  const messageId = boundedId(messageIdValue);
  const { payload, status } = await requestJson(
    `/chat-messages/${encodeURIComponent(messageId)}/knowledge-share`,
    options.signal ? { signal: options.signal } : undefined,
  );
  const result = normalizeKnowledgeShareRoomCard(payload);
  if (!result) invalidResponse(status);
  return result;
}

export async function openKnowledgeShareSource(
  shareIdValue: string,
  options: KnowledgeShareReadOptions = {},
): Promise<KnowledgeShareSourceOpen> {
  const shareId = boundedId(shareIdValue);
  const { payload, status } = await requestJson(
    `/knowledge/shares/${encodeURIComponent(shareId)}/source`,
    options.signal ? { signal: options.signal } : undefined,
  );
  const result = normalizeKnowledgeShareSourceOpen(payload);
  if (!result) invalidResponse(status);
  return result;
}

export async function listRoomKnowledgeShareSummaries(input: {
  roomId: string;
  messageIds: readonly string[];
  signal?: AbortSignal;
}): Promise<RoomKnowledgeShareSummary[]> {
  const roomId = boundedId(input.roomId);
  const messageIds = normalizeKnowledgeShareMessageIds(input.messageIds);
  if (!messageIds) invalidRequest();
  const query = new URLSearchParams({ messageIds: messageIds.join(',') });
  const { payload, status } = await requestJson(
    `/chat-rooms/${encodeURIComponent(roomId)}/knowledge-share-messages?${query.toString()}`,
    input.signal ? { signal: input.signal } : undefined,
  );
  const result = normalizeRoomKnowledgeShareSummaries(
    payload,
    new Set(messageIds),
  );
  if (!result) invalidResponse(status);
  return result;
}

export async function listKnowledgeShareLabelAssignments(
  itemIdValue: string,
  options: KnowledgeShareReadOptions = {},
): Promise<KnowledgeShareLabelAssignmentOption[]> {
  const itemId = labelItemId(itemIdValue);
  const { payload, status } = await requestJson(
    `/knowledge/items/${encodeURIComponent(itemId)}/label-assignments`,
    options.signal ? { signal: options.signal } : undefined,
  );
  const result = normalizeKnowledgeShareLabelAssignmentOptions(payload);
  if (!result) invalidResponse(status);
  return result;
}

export async function previewKnowledgeThreadPromotion(
  input: KnowledgeThreadPromotionPreviewInput,
  options: KnowledgeShareReadOptions = {},
): Promise<KnowledgeThreadPromotionPreview> {
  const rootMessageId = boundedId(input.rootMessageId);
  const request = promotionRequest(input.request);
  const { payload, status } = await requestJson(
    `/chat-messages/${encodeURIComponent(rootMessageId)}/promote-to-knowledge/preview`,
    jsonPost(promotionBody(request), options.signal),
  );
  const preview = normalizeKnowledgeThreadPromotionPreview(payload);
  if (!preview || !promotionPreviewMatchesRequest(preview, request)) {
    invalidResponse(status);
  }
  return preview;
}

export async function commitKnowledgeThreadPromotion(
  input: KnowledgeThreadPromotionCommitInput,
): Promise<KnowledgeThreadPromotionCommit> {
  const rootMessageId = boundedId(input.rootMessageId);
  const request = promotionRequest(input.request);
  if (
    request.destination.scope === 'personal' &&
    input.organizationAudienceConfirmed
  ) {
    invalidRequest();
  }
  const body = {
    ...promotionBody(request),
    previewToken: previewToken(input.previewToken),
    requestKey: requestKey(input.requestKey),
    confirmed: true as const,
    organizationAudienceConfirmed: input.organizationAudienceConfirmed,
  };
  const { payload, status } = await requestJson(
    `/chat-messages/${encodeURIComponent(rootMessageId)}/promote-to-knowledge`,
    jsonPost(body),
  );
  const commit = normalizeKnowledgeThreadPromotionCommit(payload);
  if (!commit || !promotionCommitMatchesRequest(commit, request)) {
    invalidResponse(status);
  }
  return commit;
}
