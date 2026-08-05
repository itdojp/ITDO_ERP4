import { TextDecoder } from 'node:util';

import { safeFetch } from '../../services/safeHttpClient.js';
import { normalizeKnowledgeCanonicalUrl } from './knowledgeItemUseCases.js';
import {
  knowledgeSnapshotLimits,
  type KnowledgeSnapshotCaptureMethod,
} from './knowledgeSnapshotPorts.js';

export const knowledgeSnapshotContentTypes = [
  'text/plain',
  'text/html',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export type KnowledgeSnapshotContentType =
  (typeof knowledgeSnapshotContentTypes)[number];

export type MaterializedKnowledgeSnapshot = {
  body: Buffer;
  contentType: KnowledgeSnapshotContentType;
  extractedText: string | null;
  originalName: string;
  sourceUrl: string | null;
};

export class KnowledgeSnapshotCaptureError extends Error {
  constructor(
    readonly code:
      | 'snapshot_capture_failed'
      | 'snapshot_capture_timeout'
      | 'snapshot_content_invalid'
      | 'snapshot_content_too_large'
      | 'snapshot_content_type_unsupported',
  ) {
    super(code);
  }
}

export function normalizeKnowledgeSnapshotSourceUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      throw new KnowledgeSnapshotCaptureError('snapshot_content_invalid');
    }
  } catch (error) {
    if (error instanceof KnowledgeSnapshotCaptureError) throw error;
    throw new KnowledgeSnapshotCaptureError('snapshot_content_invalid');
  }
  const normalized = normalizeKnowledgeCanonicalUrl(value);
  if (!normalized.ok || typeof normalized.value !== 'string') {
    throw new KnowledgeSnapshotCaptureError('snapshot_content_invalid');
  }
  return normalized.value;
}

function codePointSlice(value: string, maximum: number) {
  return [...value].slice(0, maximum).join('');
}

function replaceControlCharacters(value: string, replacement: string) {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? replacement : character;
    })
    .join('');
}

function decodeUtf8(body: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw new KnowledgeSnapshotCaptureError('snapshot_content_invalid');
  }
}

const blockedHtmlElement =
  /<(script|style|template|noscript|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const htmlComment = /<!--[\s\S]*?-->/g;
const htmlTag = /<[^>]*>/g;
const safeHtmlEntity =
  /&(?:nbsp|amp|lt|gt|quot|apos|#39|#\d{1,7}|#x[0-9a-f]{1,6});/gi;

function decodeSafeHtmlEntities(value: string) {
  return value.replace(safeHtmlEntity, (entity) => {
    const normalized = entity.toLowerCase();
    switch (normalized) {
      case '&nbsp;':
        return ' ';
      case '&amp;':
        return '&';
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&quot;':
        return '"';
      case '&#39;':
      case '&apos;':
        return "'";
    }
    const decoded = normalized.startsWith('&#x')
      ? Number.parseInt(normalized.slice(3, -1), 16)
      : Number(normalized.slice(2, -1));
    return Number.isInteger(decoded) && decoded >= 32 && decoded <= 0x10ffff
      ? String.fromCodePoint(decoded)
      : ' ';
  });
}

export function extractKnowledgeHtmlText(body: Buffer) {
  const text = replaceControlCharacters(
    decodeSafeHtmlEntities(
      decodeUtf8(body)
        .replace(blockedHtmlElement, ' ')
        .replace(htmlComment, ' ')
        .replace(htmlTag, ' '),
    ),
    ' ',
  )
    .replace(/\s+/g, ' ')
    .trim();
  return codePointSlice(
    text,
    knowledgeSnapshotLimits.maxExtractedTextCodePoints,
  );
}

function normalizeContentType(value: string | null | undefined) {
  const normalized = value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return knowledgeSnapshotContentTypes.find((entry) => entry === normalized);
}

export function knowledgeSnapshotContentByteLimit(
  value: string | null | undefined,
) {
  const contentType = normalizeContentType(value);
  if (!contentType) return null;
  return contentType === 'text/plain' || contentType === 'text/html'
    ? knowledgeSnapshotLimits.maxTextBytes
    : knowledgeSnapshotLimits.maxBytes;
}

function assertMagic(body: Buffer, contentType: KnowledgeSnapshotContentType) {
  const ascii = body.subarray(0, 12).toString('ascii');
  const valid = (() => {
    switch (contentType) {
      case 'application/pdf':
        return ascii.startsWith('%PDF-');
      case 'image/png':
        return body
          .subarray(0, 8)
          .equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          );
      case 'image/jpeg':
        return body.length >= 3 && body[0] === 0xff && body[1] === 0xd8;
      case 'image/webp':
        return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
      case 'image/gif':
        return ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a');
      case 'text/html':
      case 'text/plain':
        decodeUtf8(body);
        return true;
    }
  })();
  if (!valid) {
    throw new KnowledgeSnapshotCaptureError('snapshot_content_invalid');
  }
}

function extractedText(
  body: Buffer,
  contentType: KnowledgeSnapshotContentType,
) {
  if (contentType === 'text/html') return extractKnowledgeHtmlText(body);
  if (contentType !== 'text/plain') return null;
  return codePointSlice(
    decodeUtf8(body),
    knowledgeSnapshotLimits.maxExtractedTextCodePoints,
  );
}

export function normalizeKnowledgeSnapshotOriginalName(
  value: string,
  fallback: string,
) {
  const normalized = replaceControlCharacters(value, '_')
    .replace(/[\\/]+/g, '_')
    .trim();
  if (!normalized) return fallback;
  return codePointSlice(normalized, knowledgeSnapshotLimits.originalName);
}

function validateMaterialized(
  body: Buffer,
  contentTypeValue: string | null | undefined,
  originalName: string,
  sourceUrl: string | null,
): MaterializedKnowledgeSnapshot {
  const contentType = normalizeContentType(contentTypeValue);
  if (!contentType) {
    throw new KnowledgeSnapshotCaptureError(
      'snapshot_content_type_unsupported',
    );
  }
  if (body.length > knowledgeSnapshotLimits.maxBytes) {
    throw new KnowledgeSnapshotCaptureError('snapshot_content_too_large');
  }
  if (
    (contentType === 'text/plain' || contentType === 'text/html') &&
    body.length > knowledgeSnapshotLimits.maxTextBytes
  ) {
    throw new KnowledgeSnapshotCaptureError('snapshot_content_too_large');
  }
  assertMagic(body, contentType);
  return {
    body,
    contentType,
    extractedText: extractedText(body, contentType),
    originalName: normalizeKnowledgeSnapshotOriginalName(
      originalName,
      'snapshot.bin',
    ),
    sourceUrl,
  };
}

export function materializeKnowledgeText(input: {
  text: string;
  originalName?: string;
}) {
  return validateMaterialized(
    Buffer.from(input.text, 'utf8'),
    'text/plain',
    input.originalName ?? 'manual-note.txt',
    null,
  );
}

export function materializeKnowledgeUpload(input: {
  body: Buffer;
  contentType: string;
  originalName: string;
}) {
  return validateMaterialized(
    input.body,
    input.contentType,
    input.originalName,
    null,
  );
}

async function readBoundedBody(
  response: Response,
  timeoutMs: number,
  maximumBytes: number,
) {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const chunks: Buffer[] = [];
  let sizeBytes = 0;
  let timer: NodeJS.Timeout | undefined;
  try {
    const declared = response.headers.get('content-length');
    if (declared !== null) {
      const parsed = Number(declared);
      if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new KnowledgeSnapshotCaptureError('snapshot_content_invalid');
      }
      if (parsed > maximumBytes) {
        throw new KnowledgeSnapshotCaptureError('snapshot_content_too_large');
      }
    }
    if (!response.body) {
      throw new KnowledgeSnapshotCaptureError('snapshot_capture_failed');
    }
    reader = response.body.getReader();
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(new KnowledgeSnapshotCaptureError('snapshot_capture_timeout')),
        timeoutMs,
      );
    });
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      const chunk = Buffer.from(value);
      sizeBytes += chunk.length;
      if (sizeBytes > maximumBytes) {
        throw new KnowledgeSnapshotCaptureError('snapshot_content_too_large');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, sizeBytes);
  } finally {
    if (timer) clearTimeout(timer);
    if (reader) {
      await reader.cancel().catch(() => undefined);
    } else {
      await response.body?.cancel().catch(() => undefined);
    }
  }
}

export async function materializeKnowledgeUrl(
  input: { url: string; originalName?: string },
  dependencies: {
    fetchImpl?: typeof safeFetch;
    timeoutMs?: number;
  } = {},
) {
  const normalized = normalizeKnowledgeSnapshotSourceUrl(input.url);
  const controller = new AbortController();
  const timeoutMs =
    dependencies.timeoutMs ?? knowledgeSnapshotLimits.fetchTimeoutMs;
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  let response: Response | undefined;
  let responseBodyOwnedByReader = false;
  try {
    response = await (dependencies.fetchImpl ?? safeFetch)(
      normalized,
      { signal: controller.signal },
      { timeoutMs },
    );
    if (!response.ok) {
      throw new KnowledgeSnapshotCaptureError('snapshot_capture_failed');
    }
    const contentType = response.headers.get('content-type');
    const maximumBytes = knowledgeSnapshotContentByteLimit(contentType);
    if (maximumBytes === null) {
      throw new KnowledgeSnapshotCaptureError(
        'snapshot_content_type_unsupported',
      );
    }
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      throw new KnowledgeSnapshotCaptureError('snapshot_capture_timeout');
    }
    responseBodyOwnedByReader = true;
    const body = await readBoundedBody(response, remainingMs, maximumBytes);
    return validateMaterialized(
      body,
      contentType,
      input.originalName ?? 'captured-page',
      normalized,
    );
  } catch (error) {
    if (error instanceof KnowledgeSnapshotCaptureError) throw error;
    if (controller.signal.aborted) {
      throw new KnowledgeSnapshotCaptureError('snapshot_capture_timeout');
    }
    throw new KnowledgeSnapshotCaptureError('snapshot_capture_failed');
  } finally {
    clearTimeout(timer);
    if (response && !responseBodyOwnedByReader) {
      await response.body?.cancel().catch(() => undefined);
    }
  }
}

export function defaultOriginalName(method: KnowledgeSnapshotCaptureMethod) {
  if (method === 'text') return 'manual-note.txt';
  if (method === 'url') return 'captured-page';
  return 'upload.bin';
}
