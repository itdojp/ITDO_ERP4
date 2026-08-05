import { apiResponse } from '../../api';
import type {
  KnowledgeHubErrorCode,
  KnowledgeItem,
  KnowledgeScope,
  KnowledgeSnapshot,
  KnowledgeSourceType,
} from './knowledgeHubModel';
import {
  isKnowledgeCaptureMethod,
  isKnowledgeHubErrorCode,
  isKnowledgeItemStatus,
  isKnowledgeSnapshotStatus,
  isKnowledgeSourceType,
} from './knowledgeHubModel';

type JsonRecord = Record<string, unknown>;

export class KnowledgeHubApiError extends Error {
  constructor(
    readonly code: KnowledgeHubErrorCode,
    readonly status: number | null,
  ) {
    super('knowledge_hub_api_error');
    this.name = 'KnowledgeHubApiError';
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown) {
  if (typeof value !== 'string' || !value) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  return value;
}

function nullableString(value: unknown) {
  if (value === null) return null;
  return requiredString(value);
}

function requiredInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  return Number(value);
}

function nullableInteger(value: unknown) {
  if (value === null) return null;
  return requiredInteger(value);
}

function normalizeItem(value: unknown): KnowledgeItem {
  if (!isRecord(value)) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  const scope = value.scope;
  const sourceType = value.sourceType;
  const status = value.status;
  if (
    (scope !== 'personal' && scope !== 'organization') ||
    !isKnowledgeSourceType(sourceType) ||
    !isKnowledgeItemStatus(status)
  ) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  return {
    id: requiredString(value.id),
    ownerUserId: requiredString(value.ownerUserId),
    scope,
    organizationId: nullableString(value.organizationId),
    sourceType,
    canonicalUrl: nullableString(value.canonicalUrl),
    title: nullableString(value.title),
    status,
    version: requiredInteger(value.version),
    capturedAt: requiredString(value.capturedAt),
    updatedAt: requiredString(value.updatedAt),
  };
}

function normalizeSnapshot(value: unknown): KnowledgeSnapshot {
  if (!isRecord(value)) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  const status = value.status;
  const captureMethod = value.captureMethod;
  if (
    !isKnowledgeSnapshotStatus(status) ||
    !isKnowledgeCaptureMethod(captureMethod)
  ) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  return {
    id: requiredString(value.id),
    knowledgeItemId: requiredString(value.knowledgeItemId),
    version: requiredInteger(value.version),
    status,
    captureMethod,
    sourceUrl: nullableString(value.sourceUrl),
    originalName: requiredString(value.originalName),
    contentType: nullableString(value.contentType),
    sizeBytes: nullableInteger(value.sizeBytes),
    sha256: nullableString(value.sha256),
    failureCode: nullableString(value.failureCode),
    capturedAt: requiredString(value.capturedAt),
    capturedBy: requiredString(value.capturedBy),
    readyAt: nullableString(value.readyAt),
    failedAt: nullableString(value.failedAt),
    createdAt: requiredString(value.createdAt),
    updatedAt: requiredString(value.updatedAt),
  };
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function errorCode(payload: unknown): KnowledgeHubErrorCode {
  const value =
    isRecord(payload) && isRecord(payload.error)
      ? payload.error.code
      : undefined;
  return isKnowledgeHubErrorCode(value) ? value : 'unknown_error';
}

async function requestJson(path: string, options?: RequestInit) {
  let response: Response;
  try {
    response = await apiResponse(path, options);
  } catch {
    throw new KnowledgeHubApiError('network_error', null);
  }
  const payload = await safeJson(response);
  if (!response.ok) {
    throw new KnowledgeHubApiError(errorCode(payload), response.status);
  }
  if (!isRecord(payload)) {
    throw new KnowledgeHubApiError('invalid_response', response.status);
  }
  return payload;
}

export async function listKnowledgeInbox() {
  const payload = await requestJson('/knowledge/items?status=inbox&limit=100');
  if (!Array.isArray(payload.items)) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  return payload.items.map(normalizeItem);
}

export async function createKnowledgeItem(input: {
  canonicalUrl?: string;
  organizationGroupIds: string[];
  scope: KnowledgeScope;
  sourceType: KnowledgeSourceType;
  title: string | null;
}) {
  const body: JsonRecord = {
    scope: input.scope,
    sourceType: input.sourceType,
    status: 'inbox',
  };
  if (input.title !== null) body.title = input.title;
  if (input.canonicalUrl) body.canonicalUrl = input.canonicalUrl;
  if (input.scope === 'organization') {
    body.organizationGroupIds = input.organizationGroupIds;
  }
  return normalizeItem(
    await requestJson('/knowledge/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

export async function captureKnowledgeTextOrUrl(
  input: { itemId: string; requestKey: string } & (
    { mode: 'text'; text: string } | { mode: 'url'; url: string }
  ),
) {
  const body =
    input.mode === 'text'
      ? {
          captureMethod: 'text',
          requestKey: input.requestKey,
          originalName: 'manual-note.txt',
          text: input.text,
        }
      : {
          captureMethod: 'url',
          requestKey: input.requestKey,
          url: input.url,
        };
  return normalizeSnapshot(
    await requestJson(
      `/knowledge/items/${encodeURIComponent(input.itemId)}/snapshots`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),
  );
}

export async function uploadKnowledgeSnapshot(input: {
  itemId: string;
  requestKey: string;
  file: File;
}) {
  const body = new FormData();
  body.append('file', input.file, input.file.name);
  return normalizeSnapshot(
    await requestJson(
      `/knowledge/items/${encodeURIComponent(input.itemId)}/snapshots/upload?requestKey=${encodeURIComponent(input.requestKey)}`,
      { method: 'POST', body },
    ),
  );
}

export async function listKnowledgeSnapshots(itemId: string) {
  const payload = await requestJson(
    `/knowledge/items/${encodeURIComponent(itemId)}/snapshots?limit=50`,
  );
  if (!Array.isArray(payload.items)) {
    throw new KnowledgeHubApiError('invalid_response', null);
  }
  return payload.items.map(normalizeSnapshot);
}

export async function reconcileKnowledgeSnapshot(input: {
  itemId: string;
  snapshotId: string;
  requestKey: string;
}) {
  return normalizeSnapshot(
    await requestJson(
      `/knowledge/items/${encodeURIComponent(input.itemId)}/snapshots/${encodeURIComponent(input.snapshotId)}/reconcile`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestKey: input.requestKey }),
      },
    ),
  );
}

export async function openKnowledgeSnapshotDownload(input: {
  itemId: string;
  snapshotId: string;
}) {
  let response: Response;
  try {
    response = await apiResponse(
      `/knowledge/items/${encodeURIComponent(input.itemId)}/snapshots/${encodeURIComponent(input.snapshotId)}/download`,
    );
  } catch {
    throw new KnowledgeHubApiError('network_error', null);
  }
  if (!response.ok) {
    throw new KnowledgeHubApiError(
      errorCode(await safeJson(response)),
      response.status,
    );
  }
  return response;
}
