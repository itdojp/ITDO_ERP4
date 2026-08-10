import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { TextDecoder } from 'node:util';

import type { KnowledgeActor } from './knowledgeItemPorts.js';
import { knowledgeShareLimits } from './knowledgeSharePorts.js';

const VERSION = 1 as const;
const PURPOSE = 'knowledge_share_preview' as const;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_MINIMUM_BYTES = 32;
const CLOCK_SKEW_MS = 5000;

type PreviewEnvelope = {
  v: typeof VERSION;
  purpose: typeof PURPOSE;
  shareId: string;
  actorFingerprint: string;
  sourceFingerprint: string;
  roomFingerprint: string;
  payloadBinding: string;
  issuedAt: number;
  expiresAt: number;
};

let ephemeralSecret: Buffer | undefined;

export class KnowledgeShareTokenError extends Error {
  constructor(
    readonly code:
      'preview_token_invalid' | 'preview_token_expired' | 'stale_preview',
  ) {
    super(code);
    this.name = 'KnowledgeShareTokenError';
  }
}

function invalid(): never {
  throw new KnowledgeShareTokenError('preview_token_invalid');
}

function resolveRootSecret(env: NodeJS.ProcessEnv) {
  const configured = env.KNOWLEDGE_CURSOR_SIGNING_SECRET;
  if (configured !== undefined && configured.length > 0) {
    if (
      configured.trim().length === 0 ||
      Buffer.byteLength(configured, 'utf8') < SECRET_MINIMUM_BYTES
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
  ephemeralSecret ??= randomBytes(SECRET_MINIMUM_BYTES);
  return Buffer.from(ephemeralSecret);
}

function deriveSecret(root: Buffer) {
  return createHmac('sha256', root)
    .update('erp4:knowledge:share-preview-key:v1\0', 'utf8')
    .digest();
}

function encode(value: string | Uint8Array) {
  return Buffer.from(value).toString('base64url');
}

function decode(value: string) {
  if (!BASE64URL_PATTERN.test(value)) invalid();
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length === 0 || encode(decoded) !== value) invalid();
  return decoded;
}

function fingerprint(secret: Buffer, domain: string, value: string) {
  return createHmac('sha256', secret)
    .update(domain, 'utf8')
    .update('\0', 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

function actorFingerprint(actor: KnowledgeActor, secret: Buffer) {
  return fingerprint(
    secret,
    'erp4:knowledge:share-preview-actor:v1',
    actor.userId,
  );
}

function parseEnvelope(value: Buffer): PreviewEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(value),
    ) as unknown;
  } catch {
    invalid();
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    invalid();
  }
  const record = parsed as Record<string, unknown>;
  const allowed = new Set([
    'v',
    'purpose',
    'shareId',
    'actorFingerprint',
    'sourceFingerprint',
    'roomFingerprint',
    'payloadBinding',
    'issuedAt',
    'expiresAt',
  ]);
  if (
    Object.keys(record).length !== allowed.size ||
    Object.keys(record).some((key) => !allowed.has(key)) ||
    record.v !== VERSION ||
    record.purpose !== PURPOSE ||
    typeof record.shareId !== 'string' ||
    !UUID_PATTERN.test(record.shareId) ||
    typeof record.actorFingerprint !== 'string' ||
    !HASH_PATTERN.test(record.actorFingerprint) ||
    typeof record.sourceFingerprint !== 'string' ||
    !HASH_PATTERN.test(record.sourceFingerprint) ||
    typeof record.roomFingerprint !== 'string' ||
    !HASH_PATTERN.test(record.roomFingerprint) ||
    typeof record.payloadBinding !== 'string' ||
    !HASH_PATTERN.test(record.payloadBinding) ||
    typeof record.issuedAt !== 'number' ||
    !Number.isSafeInteger(record.issuedAt) ||
    typeof record.expiresAt !== 'number' ||
    !Number.isSafeInteger(record.expiresAt) ||
    record.expiresAt - record.issuedAt !== knowledgeShareLimits.previewTtlMs
  ) {
    invalid();
  }
  return record as PreviewEnvelope;
}

export function createKnowledgeShareTokenCodec(
  options: {
    env?: NodeJS.ProcessEnv;
    now?: () => Date;
    randomId?: () => string;
  } = {},
) {
  const secret = deriveSecret(resolveRootSecret(options.env ?? process.env));
  const now = options.now ?? (() => new Date());
  const randomId = options.randomId ?? randomUUID;

  function sign(envelope: PreviewEnvelope) {
    const payload = encode(JSON.stringify(envelope));
    const signature = encode(
      createHmac('sha256', secret).update(payload, 'ascii').digest(),
    );
    return payload + '.' + signature;
  }

  function authenticate(input: {
    actor: KnowledgeActor;
    sourceItemId: string;
    destinationRoomId: string;
    token: unknown;
  }) {
    if (
      typeof input.token !== 'string' ||
      Buffer.byteLength(input.token, 'utf8') >
        knowledgeShareLimits.previewTokenBytes
    ) {
      invalid();
    }
    const segments = input.token.split('.');
    if (segments.length !== 2) invalid();
    const payloadSegment = segments[0];
    const signatureSegment = segments[1];
    if (!payloadSegment || !signatureSegment) invalid();
    const payload = decode(payloadSegment);
    const provided = decode(signatureSegment);
    const expected = createHmac('sha256', secret)
      .update(payloadSegment, 'ascii')
      .digest();
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      invalid();
    }
    const envelope = parseEnvelope(payload);
    const current = now().getTime();
    if (
      envelope.issuedAt > current + CLOCK_SKEW_MS ||
      envelope.actorFingerprint !== actorFingerprint(input.actor, secret) ||
      envelope.sourceFingerprint !==
        fingerprint(
          secret,
          'erp4:knowledge:share-preview-source:v1',
          input.sourceItemId,
        ) ||
      envelope.roomFingerprint !==
        fingerprint(
          secret,
          'erp4:knowledge:share-preview-room:v1',
          input.destinationRoomId,
        )
    ) {
      invalid();
    }
    return { envelope, current };
  }

  return {
    reserveShareId() {
      const shareId = randomId();
      if (!UUID_PATTERN.test(shareId)) {
        throw new Error('knowledge_share_token_contract_invalid');
      }
      return shareId;
    },

    create(input: {
      actor: KnowledgeActor;
      sourceItemId: string;
      destinationRoomId: string;
      bindingHash: string;
      shareId: string;
    }) {
      const issuedAt = now().getTime();
      if (
        !Number.isSafeInteger(issuedAt) ||
        !UUID_PATTERN.test(input.shareId) ||
        !HASH_PATTERN.test(input.bindingHash)
      ) {
        throw new Error('knowledge_share_token_contract_invalid');
      }
      const expiresAt = issuedAt + knowledgeShareLimits.previewTtlMs;
      return {
        shareId: input.shareId,
        expiresAt: new Date(expiresAt),
        token: sign({
          v: VERSION,
          purpose: PURPOSE,
          shareId: input.shareId,
          actorFingerprint: actorFingerprint(input.actor, secret),
          sourceFingerprint: fingerprint(
            secret,
            'erp4:knowledge:share-preview-source:v1',
            input.sourceItemId,
          ),
          roomFingerprint: fingerprint(
            secret,
            'erp4:knowledge:share-preview-room:v1',
            input.destinationRoomId,
          ),
          payloadBinding: fingerprint(
            secret,
            'erp4:knowledge:share-preview-payload:v1',
            input.bindingHash,
          ),
          issuedAt,
          expiresAt,
        }),
      };
    },

    readForReplay(input: {
      actor: KnowledgeActor;
      sourceItemId: string;
      destinationRoomId: string;
      token: unknown;
    }) {
      try {
        const { envelope } = authenticate(input);
        return {
          shareId: envelope.shareId,
          payloadBinding: envelope.payloadBinding,
          expiresAt: new Date(envelope.expiresAt),
        };
      } catch (error) {
        if (error instanceof KnowledgeShareTokenError) throw error;
        invalid();
      }
    },

    verify(input: {
      actor: KnowledgeActor;
      sourceItemId: string;
      destinationRoomId: string;
      bindingHash: string;
      token: unknown;
    }) {
      try {
        const { envelope, current } = authenticate(input);
        if (envelope.expiresAt <= current) {
          throw new KnowledgeShareTokenError('preview_token_expired');
        }
        if (
          envelope.payloadBinding !==
          fingerprint(
            secret,
            'erp4:knowledge:share-preview-payload:v1',
            input.bindingHash,
          )
        ) {
          throw new KnowledgeShareTokenError('stale_preview');
        }
        return {
          shareId: envelope.shareId,
          payloadBinding: envelope.payloadBinding,
          expiresAt: new Date(envelope.expiresAt),
        };
      } catch (error) {
        if (error instanceof KnowledgeShareTokenError) throw error;
        invalid();
      }
    },
  };
}
