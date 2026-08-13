import type { KnowledgeScope, KnowledgeSourceType } from './knowledgeHubModel';

export const KNOWLEDGE_CAPTURE_DRAFT_EVENT = 'erp4:knowledge-capture-draft';
export const KNOWLEDGE_CAPTURE_RESULT_EVENT = 'erp4:knowledge-capture-result';

export type KnowledgeCaptureChannel = 'pwa_share_target' | 'browser_extension';
export type KnowledgeCaptureField =
  'title' | 'url' | 'selectedText' | 'description' | 'author' | 'publishedAt';

export type IncomingKnowledgeCaptureDraft = {
  schemaVersion: 1;
  channel: KnowledgeCaptureChannel;
  title: string | null;
  url: string | null;
  selectedText: string | null;
  description: string | null;
  author: string | null;
  publishedAt: string | null;
  capturedAt: string;
};

export type KnowledgeCaptureSubmission = {
  draft: IncomingKnowledgeCaptureDraft;
  selectedFields: KnowledgeCaptureField[];
  scope: KnowledgeScope;
  organizationGroupAccountIds: string[];
  sourceType: KnowledgeSourceType;
};

export type KnowledgeCapturePreview = KnowledgeCaptureSubmission & {
  captureId: string;
  omittedFields: KnowledgeCaptureField[];
  fieldCount: number;
  byteCount: number;
  duplicateCandidate: {
    detected: boolean;
    status: 'pending' | 'ready' | 'failed' | null;
  };
  requiresOrganizationConfirmation: boolean;
  previewToken: string;
  expiresAt: string;
};

export type KnowledgeCaptureResult = {
  captureId: string;
  requestCaptureId: string;
  itemId: string;
  snapshotId: string;
  status: 'pending' | 'ready' | 'failed';
  failureCode: string | null;
  reused: boolean;
  createdAt: string;
  committedAt: string | null;
  failedAt: string | null;
};

const fields: KnowledgeCaptureField[] = [
  'title',
  'url',
  'selectedText',
  'description',
  'author',
  'publishedAt',
];
const channels: KnowledgeCaptureChannel[] = [
  'pwa_share_target',
  'browser_extension',
];
const forbiddenObjectKeys = new Set(['__proto__', 'prototype', 'constructor']);
const limits = {
  titleCodePoints: 500,
  urlBytes: 4096,
  selectedTextBytes: 64 * 1024,
  descriptionBytes: 16 * 1024,
  authorCodePoints: 500,
  publishedAtBytes: 200,
  totalBytes: 128 * 1024,
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function invalidUnicode(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      (code >= 127 && code <= 159) ||
      code === 0xfffd ||
      code === 0xfeff ||
      code === 0x061c ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function nullableString(
  value: unknown,
  options: { bytes?: number; codePoints?: number },
) {
  if (value === null) return null;
  if (typeof value !== 'string' || invalidUnicode(value)) return undefined;
  if (
    (options.bytes !== undefined && utf8Bytes(value) > options.bytes) ||
    (options.codePoints !== undefined &&
      Array.from(value).length > options.codePoints)
  ) {
    return undefined;
  }
  return value;
}

function exactInstant(value: unknown, required: boolean) {
  const candidate = nullableString(value, {
    bytes: limits.publishedAtBytes,
  });
  if (candidate === undefined || (required && candidate === null)) {
    return undefined;
  }
  if (candidate === null || candidate === '') {
    return required ? undefined : null;
  }
  const parsed = new Date(candidate);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === candidate
    ? candidate
    : undefined;
}

function safeUrl(value: unknown) {
  const candidate = nullableString(value, { bytes: limits.urlBytes });
  if (candidate === undefined || candidate === null || candidate === '') {
    return candidate === '' ? null : candidate;
  }
  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username ||
      parsed.password
    ) {
      return undefined;
    }
    return candidate;
  } catch {
    return undefined;
  }
}

export function normalizeIncomingKnowledgeCapture(
  value: unknown,
): IncomingKnowledgeCaptureDraft | null {
  if (!record(value) || value.schemaVersion !== 1) return null;
  try {
    if (utf8Bytes(JSON.stringify(value)) > limits.totalBytes) return null;
  } catch {
    return null;
  }
  if (
    Object.keys(value).some(
      (key) => forbiddenObjectKeys.has(key) || invalidUnicode(key),
    ) ||
    Object.values(value).some(
      (entry) => typeof entry === 'object' && entry !== null,
    ) ||
    Object.values(value).some(
      (entry) => typeof entry === 'string' && invalidUnicode(entry),
    )
  ) {
    return null;
  }
  if (
    typeof value.channel !== 'string' ||
    !channels.includes(value.channel as KnowledgeCaptureChannel) ||
    typeof value.capturedAt !== 'string'
  ) {
    return null;
  }
  const optional = [
    nullableString(value.title, { codePoints: limits.titleCodePoints }),
    safeUrl(value.url),
    nullableString(value.selectedText, { bytes: limits.selectedTextBytes }),
    nullableString(value.description, { bytes: limits.descriptionBytes }),
    nullableString(value.author, { codePoints: limits.authorCodePoints }),
    exactInstant(value.publishedAt, false),
  ];
  if (optional.some((entry) => entry === undefined)) return null;
  const capturedAt = exactInstant(value.capturedAt, true);
  if (typeof capturedAt !== 'string') return null;
  const draft: IncomingKnowledgeCaptureDraft = {
    schemaVersion: 1,
    channel: value.channel as KnowledgeCaptureChannel,
    title: optional[0] ?? null,
    url: optional[1] ?? null,
    selectedText: optional[2] ?? null,
    description: optional[3] ?? null,
    author: optional[4] ?? null,
    publishedAt: optional[5] ?? null,
    capturedAt,
  };
  return utf8Bytes(JSON.stringify(draft)) <= limits.totalBytes ? draft : null;
}

export function defaultKnowledgeCaptureFields(
  draft: IncomingKnowledgeCaptureDraft,
) {
  return fields.filter(
    (field) =>
      ['title', 'url', 'selectedText'].includes(field) &&
      draft[field] !== null &&
      draft[field] !== '',
  );
}

export function splitKnowledgeGroupIds(value: string) {
  return [
    ...new Set(
      value
        .split(/[\s,]+/u)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}
