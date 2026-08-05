import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import type { KnowledgeActor } from './knowledgeItemPorts.js';
import type {
  KnowledgeCursorCodec,
  KnowledgeCursorFilter,
  KnowledgeSearchCursorBoundary,
} from './knowledgeSearchPorts.js';

const CURSOR_VERSION = 1 as const;
const CURSOR_SECRET_MIN_BYTES = 32;
const ACTOR_SCOPE_DOMAIN = 'erp4:knowledge-search:actor-scope:v1\0';
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const CANONICAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type CursorEnvelope = {
  v: typeof CURSOR_VERSION;
  updatedAt: string;
  id: string;
  filterHash: string;
  actorScopeFingerprint: string;
};

let nonProductionEphemeralSecret: Buffer | undefined;

export class KnowledgeCursorError extends Error {
  readonly code = 'invalid_cursor' as const;

  constructor() {
    super('invalid_cursor');
    this.name = 'KnowledgeCursorError';
  }
}

function invalidCursor(): KnowledgeCursorError {
  return new KnowledgeCursorError();
}

function stableClone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableClone);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(
      entries.map(([key, entryValue]) => [key, stableClone(entryValue)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  const serialized = JSON.stringify(stableClone(value));
  if (serialized === undefined) throw invalidCursor();
  return serialized;
}

export function hashKnowledgeCursorFilter(
  filter: KnowledgeCursorFilter,
): string {
  return createHash('sha256').update(stableJson(filter)).digest('hex');
}

export function fingerprintKnowledgeCursorActor(
  actor: KnowledgeActor,
  secret: Uint8Array,
): string {
  const canonicalActor = {
    userId: actor.userId.trim(),
    organizationId: actor.organizationId?.trim() || null,
    groupAccountIds: [
      ...new Set(
        actor.groupAccountIds.map((value) => value.trim()).filter(Boolean),
      ),
    ].sort(),
  };
  return createHmac('sha256', secret)
    .update(ACTOR_SCOPE_DOMAIN)
    .update(stableJson(canonicalActor))
    .digest('hex');
}

function resolveSigningSecret(env: NodeJS.ProcessEnv): Buffer {
  const configured = env.KNOWLEDGE_CURSOR_SIGNING_SECRET;
  if (configured !== undefined && configured.length > 0) {
    if (
      configured.trim().length === 0 ||
      Buffer.byteLength(configured, 'utf8') < CURSOR_SECRET_MIN_BYTES
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

  nonProductionEphemeralSecret ??= randomBytes(CURSOR_SECRET_MIN_BYTES);
  return Buffer.from(nonProductionEphemeralSecret);
}

function encodeBase64Url(value: Uint8Array | string): string {
  return Buffer.from(value).toString('base64url');
}

function decodeCanonicalBase64Url(value: string): Buffer {
  if (!BASE64URL_PATTERN.test(value)) throw invalidCursor();
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length === 0 || encodeBase64Url(decoded) !== value) {
    throw invalidCursor();
  }
  return decoded;
}

function signPayload(payload: string, secret: Uint8Array): Buffer {
  return createHmac('sha256', secret).update(payload, 'ascii').digest();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function parseEnvelope(payload: Buffer): CursorEnvelope {
  const parsed: unknown = JSON.parse(payload.toString('utf8'));
  if (!isPlainObject(parsed)) throw invalidCursor();

  const expectedKeys = [
    'actorScopeFingerprint',
    'filterHash',
    'id',
    'updatedAt',
    'v',
  ];
  const actualKeys = Object.keys(parsed).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw invalidCursor();
  }

  if (
    parsed.v !== CURSOR_VERSION ||
    typeof parsed.updatedAt !== 'string' ||
    !CANONICAL_DATE_PATTERN.test(parsed.updatedAt) ||
    typeof parsed.id !== 'string' ||
    parsed.id.length === 0 ||
    parsed.id.length > 100 ||
    parsed.id !== parsed.id.trim() ||
    typeof parsed.filterHash !== 'string' ||
    !SHA256_HEX_PATTERN.test(parsed.filterHash) ||
    typeof parsed.actorScopeFingerprint !== 'string' ||
    !SHA256_HEX_PATTERN.test(parsed.actorScopeFingerprint)
  ) {
    throw invalidCursor();
  }

  const parsedDate = new Date(parsed.updatedAt);
  if (
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString() !== parsed.updatedAt
  ) {
    throw invalidCursor();
  }

  return parsed as CursorEnvelope;
}

function canonicalBoundary(
  boundary: KnowledgeSearchCursorBoundary,
): KnowledgeSearchCursorBoundary {
  if (
    !(boundary.updatedAt instanceof Date) ||
    !Number.isFinite(boundary.updatedAt.getTime()) ||
    typeof boundary.id !== 'string' ||
    boundary.id.length === 0 ||
    boundary.id.length > 100 ||
    boundary.id !== boundary.id.trim()
  ) {
    throw invalidCursor();
  }
  return boundary;
}

class HmacKnowledgeCursorCodec implements KnowledgeCursorCodec {
  constructor(private readonly secret: Buffer) {}

  encode(input: {
    boundary: KnowledgeSearchCursorBoundary;
    filter: KnowledgeCursorFilter;
    actor: KnowledgeActor;
  }): string {
    const boundary = canonicalBoundary(input.boundary);
    const envelope: CursorEnvelope = {
      v: CURSOR_VERSION,
      updatedAt: boundary.updatedAt.toISOString(),
      id: boundary.id,
      filterHash: hashKnowledgeCursorFilter(input.filter),
      actorScopeFingerprint: fingerprintKnowledgeCursorActor(
        input.actor,
        this.secret,
      ),
    };
    const payload = encodeBase64Url(stableJson(envelope));
    const signature = encodeBase64Url(signPayload(payload, this.secret));
    return `${payload}.${signature}`;
  }

  decode(input: {
    cursor: string;
    filter: KnowledgeCursorFilter;
    actor: KnowledgeActor;
  }): KnowledgeSearchCursorBoundary {
    try {
      if (typeof input.cursor !== 'string') throw invalidCursor();
      const segments = input.cursor.split('.');
      if (segments.length !== 2) throw invalidCursor();
      const [payloadSegment, signatureSegment] = segments;
      if (!payloadSegment || !signatureSegment) throw invalidCursor();

      const payload = decodeCanonicalBase64Url(payloadSegment);
      const providedSignature = decodeCanonicalBase64Url(signatureSegment);
      const expectedSignature = signPayload(payloadSegment, this.secret);
      if (
        providedSignature.length !== expectedSignature.length ||
        !timingSafeEqual(providedSignature, expectedSignature)
      ) {
        throw invalidCursor();
      }

      const envelope = parseEnvelope(payload);
      const expectedFilterHash = hashKnowledgeCursorFilter(input.filter);
      const expectedActorScopeFingerprint = fingerprintKnowledgeCursorActor(
        input.actor,
        this.secret,
      );
      if (
        envelope.filterHash !== expectedFilterHash ||
        envelope.actorScopeFingerprint !== expectedActorScopeFingerprint
      ) {
        throw invalidCursor();
      }

      return {
        updatedAt: new Date(envelope.updatedAt),
        id: envelope.id,
      };
    } catch (error) {
      if (error instanceof KnowledgeCursorError) throw error;
      throw invalidCursor();
    }
  }
}

export function createKnowledgeCursorCodec(
  env: NodeJS.ProcessEnv = process.env,
): KnowledgeCursorCodec {
  return new HmacKnowledgeCursorCodec(resolveSigningSecret(env));
}
