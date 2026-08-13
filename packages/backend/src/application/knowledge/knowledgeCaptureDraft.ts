import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

import { normalizeKnowledgeCanonicalUrl } from './knowledgeItemUseCases.js';

export const knowledgeCaptureChannels = [
  'pwa_share_target',
  'browser_extension',
] as const;
export type KnowledgeCaptureChannel = (typeof knowledgeCaptureChannels)[number];

export const knowledgeCaptureFieldNames = [
  'title',
  'url',
  'selectedText',
  'description',
  'author',
  'publishedAt',
] as const;
export type KnowledgeCaptureFieldName =
  (typeof knowledgeCaptureFieldNames)[number];

export const knowledgeCaptureLimits = {
  titleCodePoints: 500,
  urlBytes: 4096,
  selectedTextBytes: 64 * 1024,
  descriptionBytes: 16 * 1024,
  authorCodePoints: 500,
  publishedAtBytes: 200,
  totalBytes: 128 * 1024,
  httpEnvelopeBytes: 128 * 1024 * 2 + 32 * 1024,
  requestKeyCodePoints: 200,
  previewTokenBytes: 4 * 1024,
  previewTtlMs: 10 * 60 * 1000,
} as const;

export type KnowledgeCaptureDraft = {
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

export type CanonicalKnowledgeCapture = {
  draft: KnowledgeCaptureDraft;
  selectedFields: KnowledgeCaptureFieldName[];
  omittedFields: KnowledgeCaptureFieldName[];
  selectedPayload: string;
  payloadByteCount: number;
  payloadHash: string;
};

export class KnowledgeCaptureValidationError extends Error {
  constructor(
    readonly code:
      | 'capture_payload_invalid'
      | 'capture_payload_oversize'
      | 'capture_url_invalid'
      | 'capture_selection_invalid',
  ) {
    super(code);
    this.name = 'KnowledgeCaptureValidationError';
  }
}

const forbiddenObjectKeys = new Set(['__proto__', 'prototype', 'constructor']);
const unpairedSurrogatePattern = /[\uD800-\uDFFF]/u;

function hasForbiddenControl(value: string) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? -1;
    return (
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
    );
  });
}

function invalid(code: KnowledgeCaptureValidationError['code']): never {
  throw new KnowledgeCaptureValidationError(code);
}

function plainRecord(value: unknown) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalid('capture_payload_invalid');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        forbiddenObjectKeys.has(key) ||
        hasForbiddenControl(key) ||
        unpairedSurrogatePattern.test(key),
    )
  ) {
    invalid('capture_payload_invalid');
  }
  if (
    Object.values(record).some(
      (entry) => typeof entry === 'object' && entry !== null,
    )
  ) {
    invalid('capture_payload_invalid');
  }
  if (
    Object.values(record).some(
      (entry) =>
        typeof entry === 'string' &&
        (hasForbiddenControl(entry) || unpairedSurrogatePattern.test(entry)),
    )
  ) {
    invalid('capture_payload_invalid');
  }
  if (
    Buffer.byteLength(JSON.stringify(record), 'utf8') >
    knowledgeCaptureLimits.totalBytes
  ) {
    invalid('capture_payload_oversize');
  }
  return record;
}

function cleanOptionalString(
  value: unknown,
  options: { bytes?: number; codePoints?: number },
) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') invalid('capture_payload_invalid');
  if (hasForbiddenControl(value) || unpairedSurrogatePattern.test(value)) {
    invalid('capture_payload_invalid');
  }
  const normalized = value.replace(/\r\n?/gu, '\n').trim();
  if (!normalized) return null;
  if (
    (options.bytes !== undefined &&
      Buffer.byteLength(normalized, 'utf8') > options.bytes) ||
    (options.codePoints !== undefined &&
      Array.from(normalized).length > options.codePoints)
  ) {
    invalid('capture_payload_oversize');
  }
  return normalized;
}

function normalizeUrl(value: unknown) {
  const candidate = cleanOptionalString(value, {
    bytes: knowledgeCaptureLimits.urlBytes,
  });
  if (candidate === null) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.username || parsed.password) invalid('capture_url_invalid');
  } catch {
    invalid('capture_url_invalid');
  }
  const normalized = normalizeKnowledgeCanonicalUrl(candidate);
  if (!normalized.ok || !normalized.value) invalid('capture_url_invalid');
  return normalized.value;
}

function normalizeInstant(value: unknown, required: boolean) {
  const candidate = cleanOptionalString(value, {
    bytes: knowledgeCaptureLimits.publishedAtBytes,
  });
  if (candidate === null) {
    if (required) invalid('capture_payload_invalid');
    return null;
  }
  const date = new Date(candidate);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== candidate) {
    invalid('capture_payload_invalid');
  }
  return candidate;
}

export function decodeKnowledgeCaptureJson(input: Buffer) {
  if (input.length > knowledgeCaptureLimits.httpEnvelopeBytes) {
    invalid('capture_payload_oversize');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    invalid('capture_payload_invalid');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    invalid('capture_payload_invalid');
  }
}

export function isValidKnowledgeCaptureRequestKey(
  value: unknown,
): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9._-]+$/.test(value) &&
    Array.from(value).length <= knowledgeCaptureLimits.requestKeyCodePoints &&
    !hasForbiddenControl(value) &&
    !unpairedSurrogatePattern.test(value)
  );
}

export function normalizeKnowledgeCaptureDraft(
  value: unknown,
): KnowledgeCaptureDraft {
  const record = plainRecord(value);
  if (record.schemaVersion !== 1) invalid('capture_payload_invalid');
  if (
    typeof record.channel !== 'string' ||
    !knowledgeCaptureChannels.includes(
      record.channel as KnowledgeCaptureChannel,
    )
  ) {
    invalid('capture_payload_invalid');
  }
  const draft: KnowledgeCaptureDraft = {
    schemaVersion: 1,
    channel: record.channel as KnowledgeCaptureChannel,
    title: cleanOptionalString(record.title, {
      codePoints: knowledgeCaptureLimits.titleCodePoints,
    }),
    url: normalizeUrl(record.url),
    selectedText: cleanOptionalString(record.selectedText, {
      bytes: knowledgeCaptureLimits.selectedTextBytes,
    }),
    description: cleanOptionalString(record.description, {
      bytes: knowledgeCaptureLimits.descriptionBytes,
    }),
    author: cleanOptionalString(record.author, {
      codePoints: knowledgeCaptureLimits.authorCodePoints,
    }),
    publishedAt: normalizeInstant(record.publishedAt, false),
    capturedAt: normalizeInstant(record.capturedAt, true) as string,
  };
  if (
    Buffer.byteLength(JSON.stringify(draft), 'utf8') >
    knowledgeCaptureLimits.totalBytes
  ) {
    invalid('capture_payload_oversize');
  }
  return draft;
}

function selectedPayload(
  draft: KnowledgeCaptureDraft,
  fields: readonly KnowledgeCaptureFieldName[],
) {
  const rows = fields.map((field) => [field, draft[field]] as const);
  return JSON.stringify({ schemaVersion: 1, fields: rows });
}

export function canonicalizeKnowledgeCapture(input: {
  draft: unknown;
  selectedFields: unknown;
}): CanonicalKnowledgeCapture {
  const draft = normalizeKnowledgeCaptureDraft(input.draft);
  if (
    !Array.isArray(input.selectedFields) ||
    input.selectedFields.length === 0
  ) {
    invalid('capture_selection_invalid');
  }
  const selectedSet = new Set<KnowledgeCaptureFieldName>();
  for (const value of input.selectedFields) {
    if (
      typeof value !== 'string' ||
      !knowledgeCaptureFieldNames.includes(
        value as KnowledgeCaptureFieldName,
      ) ||
      selectedSet.has(value as KnowledgeCaptureFieldName) ||
      draft[value as KnowledgeCaptureFieldName] === null
    ) {
      invalid('capture_selection_invalid');
    }
    selectedSet.add(value as KnowledgeCaptureFieldName);
  }
  const selectedFields = knowledgeCaptureFieldNames.filter((field) =>
    selectedSet.has(field),
  );
  const omittedFields = knowledgeCaptureFieldNames.filter(
    (field) => !selectedSet.has(field) && draft[field] !== null,
  );
  const payload = selectedPayload(draft, selectedFields);
  const payloadByteCount = Buffer.byteLength(payload, 'utf8');
  if (payloadByteCount > knowledgeCaptureLimits.totalBytes) {
    invalid('capture_payload_oversize');
  }
  return {
    draft,
    selectedFields,
    omittedFields,
    selectedPayload: payload,
    payloadByteCount,
    payloadHash: createHash('sha256').update(payload, 'utf8').digest('hex'),
  };
}

export function renderKnowledgeCaptureSnapshot(
  canonical: CanonicalKnowledgeCapture,
) {
  return [
    'ERP4 Knowledge capture v1',
    ...canonical.selectedFields.flatMap((field) => {
      const value = canonical.draft[field];
      return [
        `field:${field}`,
        `bytes:${Buffer.byteLength(value ?? '', 'utf8')}`,
        value ?? '',
      ];
    }),
  ].join('\n');
}
