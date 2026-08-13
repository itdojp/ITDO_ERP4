import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import type {
  KnowledgeActor,
  KnowledgeItemScope,
  KnowledgeSourceType,
} from './knowledgeItemPorts.js';
import {
  knowledgeCaptureLimits,
  type CanonicalKnowledgeCapture,
} from './knowledgeCaptureDraft.js';

const VERSION = 1 as const;
const PURPOSE = 'knowledge_capture_preview' as const;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const HASH = /^[a-f0-9]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_BYTES = 32;
const CLOCK_SKEW_MS = 5_000;

export type KnowledgeCapturePreviewBinding = {
  canonical: CanonicalKnowledgeCapture;
  scope: KnowledgeItemScope;
  organizationId: string | null;
  groupAccountIds: string[];
  sourceType: KnowledgeSourceType;
};

type Envelope = {
  v: typeof VERSION;
  purpose: typeof PURPOSE;
  captureId: string;
  actor: string;
  binding: string;
  issuedAt: number;
  expiresAt: number;
};

let ephemeralSecret: Buffer | undefined;

export class KnowledgeCaptureTokenError extends Error {
  constructor(
    readonly code: 'preview_token_invalid' | 'preview_token_expired',
  ) {
    super(code);
    this.name = 'KnowledgeCaptureTokenError';
  }
}

function invalid(): never {
  throw new KnowledgeCaptureTokenError('preview_token_invalid');
}

function rootSecret(env: NodeJS.ProcessEnv) {
  const configured = env.KNOWLEDGE_CURSOR_SIGNING_SECRET;
  if (configured) {
    if (
      configured.trim().length === 0 ||
      Buffer.byteLength(configured, 'utf8') < SECRET_BYTES
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
  ephemeralSecret ??= randomBytes(SECRET_BYTES);
  return Buffer.from(ephemeralSecret);
}

function derivePreviewKey(root: Buffer) {
  return createHmac('sha256', root)
    .update('erp4:knowledge:capture-preview-key:v1\0', 'utf8')
    .digest();
}

function idempotencyRootSecret(env: NodeJS.ProcessEnv, fallback: Buffer) {
  const configured = env.KNOWLEDGE_CAPTURE_IDEMPOTENCY_SECRET;
  if (configured) {
    if (
      configured.trim().length === 0 ||
      Buffer.byteLength(configured, 'utf8') < SECRET_BYTES
    ) {
      throw new Error(
        'KNOWLEDGE_CAPTURE_IDEMPOTENCY_SECRET must contain at least 32 UTF-8 bytes',
      );
    }
    return Buffer.from(configured, 'utf8');
  }
  if ((env.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
    throw new Error(
      'KNOWLEDGE_CAPTURE_IDEMPOTENCY_SECRET is required in production',
    );
  }
  // Non-production keeps the zero-configuration behavior. Production uses a
  // distinct durable key so cursor rotation cannot invalidate capture ledger
  // lookups and create duplicate item/snapshot aggregates.
  return Buffer.from(fallback);
}

function deriveIdempotencyKey(root: Buffer) {
  return createHmac('sha256', root)
    .update('erp4:knowledge:capture-idempotency-key:v1\0', 'utf8')
    .digest();
}

function encode(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

function decode(value: string) {
  if (!BASE64URL.test(value)) invalid();
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

function actorFingerprint(secret: Buffer, actor: KnowledgeActor) {
  return fingerprint(secret, 'erp4:knowledge:capture-actor:v1', actor.userId);
}

function bindingFingerprint(
  secret: Buffer,
  input: KnowledgeCapturePreviewBinding,
) {
  return fingerprint(
    secret,
    'erp4:knowledge:capture-binding:v1',
    JSON.stringify({
      channel: input.canonical.draft.channel,
      capturedAt: input.canonical.draft.capturedAt,
      payloadHash: input.canonical.payloadHash,
      selectedFields: input.canonical.selectedFields,
      scope: input.scope,
      organizationId: input.organizationId,
      groupAccountIds: [...input.groupAccountIds].sort(),
      sourceType: input.sourceType,
    }),
  );
}

function previewBindingFingerprint(
  secret: Buffer,
  input: KnowledgeCapturePreviewBinding,
  requestKey: string,
) {
  return fingerprint(
    secret,
    'erp4:knowledge:capture-preview-binding:v1',
    JSON.stringify({
      binding: bindingFingerprint(secret, input),
      requestKey: fingerprint(
        secret,
        'erp4:knowledge:capture-preview-request-key:v1',
        requestKey,
      ),
    }),
  );
}

function parse(value: Buffer): Envelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.toString('utf8')) as unknown;
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
  const keys = [
    'v',
    'purpose',
    'captureId',
    'actor',
    'binding',
    'issuedAt',
    'expiresAt',
  ];
  if (
    Object.keys(record).length !== keys.length ||
    Object.keys(record).some((key) => !keys.includes(key)) ||
    record.v !== VERSION ||
    record.purpose !== PURPOSE ||
    typeof record.captureId !== 'string' ||
    !UUID.test(record.captureId) ||
    typeof record.actor !== 'string' ||
    !HASH.test(record.actor) ||
    typeof record.binding !== 'string' ||
    !HASH.test(record.binding) ||
    typeof record.issuedAt !== 'number' ||
    !Number.isSafeInteger(record.issuedAt) ||
    typeof record.expiresAt !== 'number' ||
    !Number.isSafeInteger(record.expiresAt) ||
    record.expiresAt - record.issuedAt !== knowledgeCaptureLimits.previewTtlMs
  ) {
    invalid();
  }
  return record as Envelope;
}

export function createKnowledgeCaptureTokenCodec(
  options: {
    env?: NodeJS.ProcessEnv;
    now?: () => Date;
    randomId?: () => string;
  } = {},
) {
  const env = options.env ?? process.env;
  const root = rootSecret(env);
  const previewSecret = derivePreviewKey(root);
  const idempotencySecret = deriveIdempotencyKey(
    idempotencyRootSecret(env, root),
  );
  const now = options.now ?? (() => new Date());
  const randomId = options.randomId ?? randomUUID;

  function sign(envelope: Envelope) {
    const payload = encode(JSON.stringify(envelope));
    const signature = encode(
      createHmac('sha256', previewSecret).update(payload, 'ascii').digest(),
    );
    return `${payload}.${signature}`;
  }

  return {
    requestKeyHash(actor: KnowledgeActor, requestKey: string) {
      return fingerprint(
        idempotencySecret,
        'erp4:knowledge:capture-request-key:v1',
        `${actor.userId}\0${requestKey}`,
      );
    },

    payloadHash(binding: KnowledgeCapturePreviewBinding) {
      return bindingFingerprint(idempotencySecret, binding);
    },

    create(input: {
      actor: KnowledgeActor;
      binding: KnowledgeCapturePreviewBinding;
      requestKey: string;
    }) {
      const issuedAt = now().getTime();
      const captureId = randomId();
      if (!Number.isSafeInteger(issuedAt) || !UUID.test(captureId)) {
        throw new Error('knowledge_capture_token_contract_invalid');
      }
      const expiresAt = issuedAt + knowledgeCaptureLimits.previewTtlMs;
      const token = sign({
        v: VERSION,
        purpose: PURPOSE,
        captureId,
        actor: actorFingerprint(previewSecret, input.actor),
        binding: previewBindingFingerprint(
          previewSecret,
          input.binding,
          input.requestKey,
        ),
        issuedAt,
        expiresAt,
      });
      if (
        Buffer.byteLength(token, 'utf8') >
        knowledgeCaptureLimits.previewTokenBytes
      ) {
        throw new Error('knowledge_capture_token_contract_invalid');
      }
      return { captureId, expiresAt: new Date(expiresAt), token };
    },

    verify(input: {
      actor: KnowledgeActor;
      binding: KnowledgeCapturePreviewBinding;
      requestKey: string;
      token: unknown;
      allowExpired?: boolean;
    }) {
      try {
        if (
          typeof input.token !== 'string' ||
          Buffer.byteLength(input.token, 'utf8') >
            knowledgeCaptureLimits.previewTokenBytes
        )
          invalid();
        const parts = input.token.split('.');
        if (parts.length !== 2) invalid();
        const [payload, encodedSignature] = parts as [string, string];
        const signature = decode(encodedSignature);
        const expected = createHmac('sha256', previewSecret)
          .update(payload, 'ascii')
          .digest();
        if (
          signature.length !== expected.length ||
          !timingSafeEqual(signature, expected)
        )
          invalid();
        const envelope = parse(decode(payload));
        if (
          envelope.actor !== actorFingerprint(previewSecret, input.actor) ||
          envelope.binding !==
            previewBindingFingerprint(
              previewSecret,
              input.binding,
              input.requestKey,
            )
        )
          invalid();
        const current = now().getTime();
        if (
          !input.allowExpired &&
          current > envelope.expiresAt + CLOCK_SKEW_MS
        ) {
          throw new KnowledgeCaptureTokenError('preview_token_expired');
        }
        if (current + CLOCK_SKEW_MS < envelope.issuedAt) invalid();
        return {
          captureId: envelope.captureId,
          expiresAt: new Date(envelope.expiresAt),
        };
      } catch (error) {
        if (error instanceof KnowledgeCaptureTokenError) throw error;
        invalid();
      }
    },
  };
}
