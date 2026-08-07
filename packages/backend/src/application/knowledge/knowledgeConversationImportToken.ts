import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { TextDecoder } from 'node:util';

import type { KnowledgeActor } from './knowledgeItemPorts.js';
import {
  knowledgeConversationImportLimits,
  type CanonicalKnowledgeConversationImport,
} from './knowledgeConversationImportPorts.js';

const VERSION = 1 as const;
const PURPOSE = 'knowledge_conversation_import_preview' as const;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_MINIMUM_BYTES = 32;
const CLOCK_SKEW_MS = 5_000;

type PreviewEnvelope = {
  v: typeof VERSION;
  purpose: typeof PURPOSE;
  importId: string;
  actorFingerprint: string;
  format: CanonicalKnowledgeConversationImport['format'];
  payloadBinding: string;
  linkedItemsHash: string;
  issuedAt: number;
  expiresAt: number;
};

let ephemeralSecret: Buffer | undefined;

export class KnowledgeConversationImportTokenError extends Error {
  constructor(
    readonly code: 'preview_token_invalid' | 'preview_token_expired',
  ) {
    super(code);
    this.name = 'KnowledgeConversationImportTokenError';
  }
}

function invalid(): never {
  throw new KnowledgeConversationImportTokenError('preview_token_invalid');
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
    .update('erp4:knowledge:conversation-import-preview-key:v1\0', 'utf8')
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

function actorFingerprint(actor: KnowledgeActor, secret: Buffer) {
  return createHmac('sha256', secret)
    .update('erp4:knowledge:conversation-import-actor:v1\0', 'utf8')
    .update(actor.userId, 'utf8')
    .digest('hex');
}

function linkedItemsHash(
  canonical: CanonicalKnowledgeConversationImport,
  secret: Buffer,
) {
  return createHmac('sha256', secret)
    .update('erp4:knowledge:conversation-import-items:v1\0', 'utf8')
    .update(
      JSON.stringify(
        canonical.linkedItems.map((item) => ({
          itemId: item.itemId,
          relationType: item.relationType,
          ordinal: item.ordinal,
        })),
      ),
      'utf8',
    )
    .digest('hex');
}

function payloadBinding(
  canonical: CanonicalKnowledgeConversationImport,
  secret: Buffer,
) {
  return createHmac('sha256', secret)
    .update('erp4:knowledge:conversation-import-payload-binding:v1\0', 'utf8')
    .update(canonical.canonicalPayloadHash, 'ascii')
    .digest('hex');
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
    'importId',
    'actorFingerprint',
    'format',
    'payloadBinding',
    'linkedItemsHash',
    'issuedAt',
    'expiresAt',
  ]);
  if (
    Object.keys(record).length !== allowed.size ||
    Object.keys(record).some((key) => !allowed.has(key)) ||
    record.v !== VERSION ||
    record.purpose !== PURPOSE ||
    typeof record.importId !== 'string' ||
    !UUID_PATTERN.test(record.importId) ||
    typeof record.actorFingerprint !== 'string' ||
    !HASH_PATTERN.test(record.actorFingerprint) ||
    (record.format !== 'manual' &&
      record.format !== 'json' &&
      record.format !== 'markdown') ||
    typeof record.payloadBinding !== 'string' ||
    !HASH_PATTERN.test(record.payloadBinding) ||
    typeof record.linkedItemsHash !== 'string' ||
    !HASH_PATTERN.test(record.linkedItemsHash) ||
    typeof record.issuedAt !== 'number' ||
    !Number.isSafeInteger(record.issuedAt) ||
    typeof record.expiresAt !== 'number' ||
    !Number.isSafeInteger(record.expiresAt) ||
    record.expiresAt - record.issuedAt !==
      knowledgeConversationImportLimits.previewTtlMs
  ) {
    invalid();
  }
  return record as PreviewEnvelope;
}

export function createKnowledgeConversationImportTokenCodec(
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

  return {
    create(input: {
      actor: KnowledgeActor;
      canonical: CanonicalKnowledgeConversationImport;
    }) {
      const issuedAt = now().getTime();
      const importId = randomId();
      if (!Number.isSafeInteger(issuedAt) || !UUID_PATTERN.test(importId)) {
        throw new Error('knowledge_conversation_import_token_contract_invalid');
      }
      const expiresAt =
        issuedAt + knowledgeConversationImportLimits.previewTtlMs;
      return {
        importId,
        expiresAt: new Date(expiresAt),
        token: sign({
          v: VERSION,
          purpose: PURPOSE,
          importId,
          actorFingerprint: actorFingerprint(input.actor, secret),
          format: input.canonical.format,
          payloadBinding: payloadBinding(input.canonical, secret),
          linkedItemsHash: linkedItemsHash(input.canonical, secret),
          issuedAt,
          expiresAt,
        }),
      };
    },

    verify(input: {
      actor: KnowledgeActor;
      canonical: CanonicalKnowledgeConversationImport;
      token: unknown;
    }) {
      try {
        if (
          typeof input.token !== 'string' ||
          Buffer.byteLength(input.token, 'utf8') >
            knowledgeConversationImportLimits.previewTokenBytes
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
        if (envelope.expiresAt <= current) {
          throw new KnowledgeConversationImportTokenError(
            'preview_token_expired',
          );
        }
        if (
          envelope.issuedAt > current + CLOCK_SKEW_MS ||
          envelope.actorFingerprint !== actorFingerprint(input.actor, secret) ||
          envelope.format !== input.canonical.format ||
          envelope.payloadBinding !== payloadBinding(input.canonical, secret) ||
          envelope.linkedItemsHash !== linkedItemsHash(input.canonical, secret)
        ) {
          invalid();
        }
        return {
          importId: envelope.importId,
          expiresAt: new Date(envelope.expiresAt),
        };
      } catch (error) {
        if (error instanceof KnowledgeConversationImportTokenError) throw error;
        invalid();
      }
    },
  };
}
