import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import type { KnowledgeActor } from './knowledgeItemPorts.js';
import {
  knowledgeProvenanceLimits,
  type KnowledgePageBoundary,
  type KnowledgeSequenceBoundary,
} from './knowledgeProvenancePorts.js';

const CURSOR_VERSION = 1 as const;
const CONFIDENTIAL_CURSOR_VERSION = 'v2';
const SECRET_MIN_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const knowledgeProvenanceCursorKinds = [
  'annotations',
  'annotations_with_deleted',
  'annotation_revisions',
  'conversations',
  'conversation_turns',
  'syntheses',
  'synthesis_versions',
  'llm_context_sources',
] as const;
export type KnowledgeProvenanceCursorKind =
  (typeof knowledgeProvenanceCursorKinds)[number];

type CursorEnvelope = {
  v: typeof CURSOR_VERSION;
  kind: KnowledgeProvenanceCursorKind;
  parentHash: string;
  actorFingerprint: string;
  id: string;
  updatedAt?: string;
  sequence?: number;
};

let ephemeralSecret: Buffer | undefined;
const CONFIDENTIAL_CURSOR_AAD = Buffer.from(
  'erp4:knowledge-provenance:llm-context-cursor:v2',
  'utf8',
);

export class KnowledgeProvenanceCursorError extends Error {
  readonly code = 'invalid_cursor' as const;

  constructor() {
    super('invalid_cursor');
    this.name = 'KnowledgeProvenanceCursorError';
  }
}

function invalidCursor(): KnowledgeProvenanceCursorError {
  return new KnowledgeProvenanceCursorError();
}

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    ),
  );
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function actorFingerprint(actor: KnowledgeActor, secret: Uint8Array): string {
  const canonical = stableJson({
    groupAccountIds: [
      ...new Set(
        actor.groupAccountIds.map((value) => value.trim()).filter(Boolean),
      ),
    ].sort(),
    organizationId: actor.organizationId?.trim() || null,
    userId: actor.userId.trim(),
  });
  return createHmac('sha256', secret)
    .update('erp4:knowledge-provenance:actor:v1\0', 'utf8')
    .update(canonical, 'utf8')
    .digest('hex');
}

function confidentialCursorKey(secret: Uint8Array): Buffer {
  return createHmac('sha256', secret)
    .update(
      'erp4:knowledge-provenance:llm-context-cursor-encryption-key:v2\0',
      'utf8',
    )
    .digest();
}

function resolveSecret(env: NodeJS.ProcessEnv): Buffer {
  const configured = env.KNOWLEDGE_CURSOR_SIGNING_SECRET;
  if (configured !== undefined && configured.length > 0) {
    if (
      configured.trim().length === 0 ||
      Buffer.byteLength(configured, 'utf8') < SECRET_MIN_BYTES
    ) {
      throw new Error(
        'KNOWLEDGE_CURSOR_SIGNING_SECRET must contain at least 32 UTF-8 bytes',
      );
    }
    return Buffer.from(configured, 'utf8');
  }
  if ((env.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
    throw new Error(
      'KNOWLEDGE_CURSOR_SIGNING_SECRET is required in production',
    );
  }
  ephemeralSecret ??= randomBytes(SECRET_MIN_BYTES);
  return Buffer.from(ephemeralSecret);
}

function encodeBase64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value: string): Buffer {
  if (!BASE64URL_PATTERN.test(value)) throw invalidCursor();
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length === 0 || encodeBase64Url(decoded) !== value) {
    throw invalidCursor();
  }
  return decoded;
}

function parseEnvelope(value: Buffer): CursorEnvelope {
  const parsed: unknown = JSON.parse(value.toString('utf8'));
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    throw invalidCursor();
  }
  const record = parsed as Record<string, unknown>;
  const allowed = new Set([
    'actorFingerprint',
    'id',
    'kind',
    'parentHash',
    'sequence',
    'updatedAt',
    'v',
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw invalidCursor();
  }
  if (
    record.v !== CURSOR_VERSION ||
    typeof record.kind !== 'string' ||
    !knowledgeProvenanceCursorKinds.some((kind) => kind === record.kind) ||
    typeof record.parentHash !== 'string' ||
    !HASH_PATTERN.test(record.parentHash) ||
    typeof record.actorFingerprint !== 'string' ||
    !HASH_PATTERN.test(record.actorFingerprint) ||
    typeof record.id !== 'string' ||
    record.id.length === 0 ||
    record.id.length > knowledgeProvenanceLimits.id ||
    record.id !== record.id.trim()
  ) {
    throw invalidCursor();
  }
  const hasDate = record.updatedAt !== undefined;
  const hasSequence = record.sequence !== undefined;
  if (hasDate === hasSequence) throw invalidCursor();
  if (
    hasDate &&
    (typeof record.updatedAt !== 'string' ||
      !DATE_PATTERN.test(record.updatedAt) ||
      new Date(record.updatedAt).toISOString() !== record.updatedAt)
  ) {
    throw invalidCursor();
  }
  if (
    hasSequence &&
    (typeof record.sequence !== 'number' ||
      !Number.isInteger(record.sequence) ||
      record.sequence < 1 ||
      record.sequence > knowledgeProvenanceLimits.sequence)
  ) {
    throw invalidCursor();
  }
  return record as CursorEnvelope;
}

export function createKnowledgeProvenanceCursorCodec(
  env: NodeJS.ProcessEnv = process.env,
) {
  const secret = resolveSecret(env);

  function encode(envelope: CursorEnvelope): string {
    if (envelope.kind === 'llm_context_sources') {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(
        'aes-256-gcm',
        confidentialCursorKey(secret),
        iv,
      );
      cipher.setAAD(CONFIDENTIAL_CURSOR_AAD);
      const encrypted = Buffer.concat([
        cipher.update(stableJson(envelope), 'utf8'),
        cipher.final(),
      ]);
      return [
        CONFIDENTIAL_CURSOR_VERSION,
        encodeBase64Url(iv),
        encodeBase64Url(encrypted),
        encodeBase64Url(cipher.getAuthTag()),
      ].join('.');
    }
    const payload = encodeBase64Url(stableJson(envelope));
    const signature = encodeBase64Url(
      createHmac('sha256', secret).update(payload, 'ascii').digest(),
    );
    return `${payload}.${signature}`;
  }

  function decode(input: {
    cursor: string;
    kind: KnowledgeProvenanceCursorKind;
    parentId?: string;
    actor: KnowledgeActor;
  }): CursorEnvelope {
    try {
      if (
        input.cursor.length === 0 ||
        input.cursor.length > knowledgeProvenanceLimits.cursor
      ) {
        throw invalidCursor();
      }
      const segments = input.cursor.split('.');
      if (input.kind === 'llm_context_sources') {
        if (segments.length !== 4) throw invalidCursor();
        const [version, ivSegment, payloadSegment, tagSegment] = segments;
        if (
          version !== CONFIDENTIAL_CURSOR_VERSION ||
          !ivSegment ||
          !payloadSegment ||
          !tagSegment
        ) {
          throw invalidCursor();
        }
        const iv = decodeBase64Url(ivSegment);
        const encrypted = decodeBase64Url(payloadSegment);
        const authTag = decodeBase64Url(tagSegment);
        if (
          iv.length !== IV_BYTES ||
          encrypted.length === 0 ||
          authTag.length !== AUTH_TAG_BYTES
        ) {
          throw invalidCursor();
        }
        const decipher = createDecipheriv(
          'aes-256-gcm',
          confidentialCursorKey(secret),
          iv,
        );
        decipher.setAAD(CONFIDENTIAL_CURSOR_AAD);
        decipher.setAuthTag(authTag);
        const envelope = parseEnvelope(
          Buffer.concat([decipher.update(encrypted), decipher.final()]),
        );
        if (
          envelope.kind !== input.kind ||
          envelope.parentHash !== hash(input.parentId ?? '') ||
          envelope.actorFingerprint !== actorFingerprint(input.actor, secret)
        ) {
          throw invalidCursor();
        }
        return envelope;
      }
      if (segments.length !== 2) throw invalidCursor();
      const [payloadSegment, signatureSegment] = segments;
      if (!payloadSegment || !signatureSegment) throw invalidCursor();
      const payload = decodeBase64Url(payloadSegment);
      const provided = decodeBase64Url(signatureSegment);
      const expected = createHmac('sha256', secret)
        .update(payloadSegment, 'ascii')
        .digest();
      if (
        provided.length !== expected.length ||
        !timingSafeEqual(provided, expected)
      ) {
        throw invalidCursor();
      }
      const envelope = parseEnvelope(payload);
      if (
        envelope.kind !== input.kind ||
        envelope.parentHash !== hash(input.parentId ?? '') ||
        envelope.actorFingerprint !== actorFingerprint(input.actor, secret)
      ) {
        throw invalidCursor();
      }
      return envelope;
    } catch (error) {
      if (error instanceof KnowledgeProvenanceCursorError) throw error;
      throw invalidCursor();
    }
  }

  return {
    encodePage(input: {
      kind: KnowledgeProvenanceCursorKind;
      parentId?: string;
      actor: KnowledgeActor;
      boundary: KnowledgePageBoundary;
    }): string {
      return encode({
        v: CURSOR_VERSION,
        kind: input.kind,
        parentHash: hash(input.parentId ?? ''),
        actorFingerprint: actorFingerprint(input.actor, secret),
        id: input.boundary.id,
        updatedAt: input.boundary.updatedAt.toISOString(),
      });
    },
    decodePage(input: {
      cursor: string;
      kind: KnowledgeProvenanceCursorKind;
      parentId?: string;
      actor: KnowledgeActor;
    }): KnowledgePageBoundary {
      const envelope = decode(input);
      if (!envelope.updatedAt || envelope.sequence !== undefined) {
        throw invalidCursor();
      }
      return { updatedAt: new Date(envelope.updatedAt), id: envelope.id };
    },
    encodeSequence(input: {
      kind: KnowledgeProvenanceCursorKind;
      parentId: string;
      actor: KnowledgeActor;
      boundary: KnowledgeSequenceBoundary;
    }): string {
      return encode({
        v: CURSOR_VERSION,
        kind: input.kind,
        parentHash: hash(input.parentId),
        actorFingerprint: actorFingerprint(input.actor, secret),
        id: input.boundary.id,
        sequence: input.boundary.sequence,
      });
    },
    decodeSequence(input: {
      cursor: string;
      kind: KnowledgeProvenanceCursorKind;
      parentId: string;
      actor: KnowledgeActor;
    }): KnowledgeSequenceBoundary {
      const envelope = decode(input);
      if (envelope.sequence === undefined || envelope.updatedAt !== undefined) {
        throw invalidCursor();
      }
      return { sequence: envelope.sequence, id: envelope.id };
    },
  };
}

export type KnowledgeProvenanceCursorCodec = ReturnType<
  typeof createKnowledgeProvenanceCursorCodec
>;
