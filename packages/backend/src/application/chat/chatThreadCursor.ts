import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import {
  chatThreadLimits,
  type ChatThreadActor,
  type ChatThreadBoundary,
  type ChatThreadCursorCodec,
} from './chatThreadPorts.js';

const VERSION = 1 as const;
const KIND = 'chat_thread_replies' as const;
const SECRET_MIN_BYTES = 32;
const TOKEN_VERSION = 'v1';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let ephemeralSecret: Buffer | undefined;
const ENCRYPTION_AAD = Buffer.from('erp4:chat-thread:cursor:v1', 'utf8');

type CursorEnvelope = {
  v: typeof VERSION;
  kind: typeof KIND;
  actorFingerprint: string;
  rootFingerprint: string;
  createdAt: string;
  id: string;
};

export class ChatThreadCursorError extends Error {
  readonly code = 'invalid_cursor' as const;

  constructor() {
    super('invalid_cursor');
    this.name = 'ChatThreadCursorError';
  }
}

function invalidCursor(): ChatThreadCursorError {
  return new ChatThreadCursorError();
}

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    ),
  );
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

function fingerprint(
  secret: Uint8Array,
  domain: string,
  value: string,
): string {
  return createHmac('sha256', secret)
    .update(`erp4:chat-thread:${domain}:v1\0`, 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

function encryptionKey(secret: Uint8Array): Buffer {
  return createHmac('sha256', secret)
    .update('erp4:chat-thread:cursor-encryption-key:v1\0', 'utf8')
    .digest();
}

function signToken(secret: Uint8Array, signedValue: string): Buffer {
  return createHmac('sha256', secret)
    .update('erp4:chat-thread:cursor-signature:v1\0', 'utf8')
    .update(signedValue, 'ascii')
    .digest();
}

function actorFingerprint(secret: Uint8Array, actor: ChatThreadActor): string {
  const canonical = stableJson({
    groupAccountIds: [...new Set(actor.groupAccountIds)].sort(),
    groupIds: [...new Set(actor.groupIds)].sort(),
    projectIds: [...new Set(actor.projectIds)].sort(),
    roles: [...new Set(actor.roles)].sort(),
    userId: actor.userId,
  });
  return fingerprint(secret, 'actor', canonical);
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
    'createdAt',
    'id',
    'kind',
    'rootFingerprint',
    'v',
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw invalidCursor();
  }
  if (
    record.v !== VERSION ||
    record.kind !== KIND ||
    typeof record.actorFingerprint !== 'string' ||
    !HASH_PATTERN.test(record.actorFingerprint) ||
    typeof record.rootFingerprint !== 'string' ||
    !HASH_PATTERN.test(record.rootFingerprint) ||
    typeof record.createdAt !== 'string' ||
    !DATE_PATTERN.test(record.createdAt) ||
    new Date(record.createdAt).toISOString() !== record.createdAt ||
    typeof record.id !== 'string' ||
    record.id.length === 0 ||
    record.id.length > chatThreadLimits.id ||
    record.id !== record.id.trim()
  ) {
    throw invalidCursor();
  }
  return record as CursorEnvelope;
}

export function createChatThreadCursorCodec(
  env: NodeJS.ProcessEnv = process.env,
): ChatThreadCursorCodec {
  const secret = resolveSecret(env);

  return {
    encode(input): string {
      const envelope: CursorEnvelope = {
        v: VERSION,
        kind: KIND,
        actorFingerprint: actorFingerprint(secret, input.actor),
        rootFingerprint: fingerprint(secret, 'root', input.rootMessageId),
        createdAt: input.boundary.createdAt.toISOString(),
        id: input.boundary.id,
      };
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
      cipher.setAAD(ENCRYPTION_AAD);
      const encrypted = Buffer.concat([
        cipher.update(stableJson(envelope), 'utf8'),
        cipher.final(),
      ]);
      const signedValue = [
        TOKEN_VERSION,
        encodeBase64Url(iv),
        encodeBase64Url(encrypted),
        encodeBase64Url(cipher.getAuthTag()),
      ].join('.');
      return `${signedValue}.${encodeBase64Url(signToken(secret, signedValue))}`;
    },
    decode(input): ChatThreadBoundary {
      try {
        if (
          input.cursor.length === 0 ||
          input.cursor.length > chatThreadLimits.cursor
        ) {
          throw invalidCursor();
        }
        const segments = input.cursor.split('.');
        if (segments.length !== 5) throw invalidCursor();
        const [
          tokenVersion,
          ivSegment,
          payloadSegment,
          tagSegment,
          signatureSegment,
        ] = segments;
        if (
          tokenVersion !== TOKEN_VERSION ||
          !ivSegment ||
          !payloadSegment ||
          !tagSegment ||
          !signatureSegment
        ) {
          throw invalidCursor();
        }
        const signedValue = segments.slice(0, 4).join('.');
        const provided = decodeBase64Url(signatureSegment);
        const expected = signToken(secret, signedValue);
        if (
          provided.length !== expected.length ||
          !timingSafeEqual(provided, expected)
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
          encryptionKey(secret),
          iv,
        );
        decipher.setAAD(ENCRYPTION_AAD);
        decipher.setAuthTag(authTag);
        const envelope = parseEnvelope(
          Buffer.concat([decipher.update(encrypted), decipher.final()]),
        );
        if (
          envelope.actorFingerprint !== actorFingerprint(secret, input.actor) ||
          envelope.rootFingerprint !==
            fingerprint(secret, 'root', input.rootMessageId)
        ) {
          throw invalidCursor();
        }
        return {
          createdAt: new Date(envelope.createdAt),
          id: envelope.id,
        };
      } catch (error) {
        if (error instanceof ChatThreadCursorError) throw error;
        throw invalidCursor();
      }
    },
  };
}
