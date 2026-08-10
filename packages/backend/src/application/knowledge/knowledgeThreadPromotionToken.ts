import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { TextDecoder } from 'node:util';

import type { KnowledgeActor } from './knowledgeItemPorts.js';
import { knowledgeThreadPromotionLimits } from './knowledgeThreadPromotionPorts.js';

const VERSION = 1 as const;
const PURPOSE = 'knowledge_thread_promotion_preview' as const;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_MINIMUM_BYTES = 32;
const CLOCK_SKEW_MS = 5_000;

type PreviewEnvelope = {
  v: typeof VERSION;
  purpose: typeof PURPOSE;
  promotionId: string;
  actorFingerprint: string;
  rootFingerprint: string;
  payloadBinding: string;
  issuedAt: number;
  expiresAt: number;
};

let ephemeralSecret: Buffer | undefined;

export class KnowledgeThreadPromotionTokenError extends Error {
  constructor(
    readonly code:
      'preview_token_invalid' | 'preview_token_expired' | 'stale_preview',
  ) {
    super(code);
    this.name = 'KnowledgeThreadPromotionTokenError';
  }
}

function invalid(): never {
  throw new KnowledgeThreadPromotionTokenError('preview_token_invalid');
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
    .update('erp4:knowledge:thread-promotion-preview-key:v1\0', 'utf8')
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
    'erp4:knowledge:thread-promotion-preview-actor:v1',
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
    'promotionId',
    'actorFingerprint',
    'rootFingerprint',
    'payloadBinding',
    'issuedAt',
    'expiresAt',
  ]);
  if (
    Object.keys(record).length !== allowed.size ||
    Object.keys(record).some((key) => !allowed.has(key)) ||
    record.v !== VERSION ||
    record.purpose !== PURPOSE ||
    typeof record.promotionId !== 'string' ||
    !UUID_PATTERN.test(record.promotionId) ||
    typeof record.actorFingerprint !== 'string' ||
    !HASH_PATTERN.test(record.actorFingerprint) ||
    typeof record.rootFingerprint !== 'string' ||
    !HASH_PATTERN.test(record.rootFingerprint) ||
    typeof record.payloadBinding !== 'string' ||
    !HASH_PATTERN.test(record.payloadBinding) ||
    typeof record.issuedAt !== 'number' ||
    !Number.isSafeInteger(record.issuedAt) ||
    typeof record.expiresAt !== 'number' ||
    !Number.isSafeInteger(record.expiresAt) ||
    record.expiresAt - record.issuedAt !==
      knowledgeThreadPromotionLimits.previewTtlMs
  ) {
    invalid();
  }
  return record as PreviewEnvelope;
}

export function createKnowledgeThreadPromotionTokenCodec(
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
    return `${payload}.${signature}`;
  }

  function authenticate(input: {
    actor: KnowledgeActor;
    rootMessageId: string;
    token: unknown;
  }) {
    if (
      typeof input.token !== 'string' ||
      Buffer.byteLength(input.token, 'utf8') >
        knowledgeThreadPromotionLimits.previewTokenBytes
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
      envelope.rootFingerprint !==
        fingerprint(
          secret,
          'erp4:knowledge:thread-promotion-preview-root:v1',
          input.rootMessageId,
        )
    ) {
      invalid();
    }
    return { envelope, current };
  }

  return {
    reservePromotionId() {
      const promotionId = randomId();
      if (!UUID_PATTERN.test(promotionId)) {
        throw new Error('knowledge_thread_promotion_token_contract_invalid');
      }
      return promotionId;
    },

    create(input: {
      actor: KnowledgeActor;
      rootMessageId: string;
      bindingHash: string;
      promotionId: string;
    }) {
      const issuedAt = now().getTime();
      if (
        !Number.isSafeInteger(issuedAt) ||
        !UUID_PATTERN.test(input.promotionId) ||
        !HASH_PATTERN.test(input.bindingHash)
      ) {
        throw new Error('knowledge_thread_promotion_token_contract_invalid');
      }
      const expiresAt = issuedAt + knowledgeThreadPromotionLimits.previewTtlMs;
      return {
        promotionId: input.promotionId,
        expiresAt: new Date(expiresAt),
        token: sign({
          v: VERSION,
          purpose: PURPOSE,
          promotionId: input.promotionId,
          actorFingerprint: actorFingerprint(input.actor, secret),
          rootFingerprint: fingerprint(
            secret,
            'erp4:knowledge:thread-promotion-preview-root:v1',
            input.rootMessageId,
          ),
          payloadBinding: fingerprint(
            secret,
            'erp4:knowledge:thread-promotion-preview-payload:v1',
            input.bindingHash,
          ),
          issuedAt,
          expiresAt,
        }),
      };
    },

    readForReplay(input: {
      actor: KnowledgeActor;
      rootMessageId: string;
      token: unknown;
    }) {
      try {
        const { envelope } = authenticate(input);
        return {
          promotionId: envelope.promotionId,
          payloadBinding: envelope.payloadBinding,
          expiresAt: new Date(envelope.expiresAt),
        };
      } catch (error) {
        if (error instanceof KnowledgeThreadPromotionTokenError) throw error;
        invalid();
      }
    },

    verify(input: {
      actor: KnowledgeActor;
      rootMessageId: string;
      bindingHash: string;
      token: unknown;
    }) {
      try {
        const { envelope, current } = authenticate(input);
        if (envelope.expiresAt <= current) {
          throw new KnowledgeThreadPromotionTokenError('preview_token_expired');
        }
        if (
          envelope.payloadBinding !==
          fingerprint(
            secret,
            'erp4:knowledge:thread-promotion-preview-payload:v1',
            input.bindingHash,
          )
        ) {
          throw new KnowledgeThreadPromotionTokenError('stale_preview');
        }
        return {
          promotionId: envelope.promotionId,
          payloadBinding: envelope.payloadBinding,
          expiresAt: new Date(envelope.expiresAt),
        };
      } catch (error) {
        if (error instanceof KnowledgeThreadPromotionTokenError) throw error;
        invalid();
      }
    },
  };
}
