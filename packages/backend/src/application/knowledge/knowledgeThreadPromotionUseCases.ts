import { createHash } from 'node:crypto';

import type {
  KnowledgeActor,
  KnowledgeAuditActorContext,
} from './knowledgeItemPorts.js';
import {
  knowledgeThreadPromotionLimits,
  type KnowledgeThreadPromotionCommitRecord,
  type KnowledgeThreadPromotionDestination,
  type KnowledgeThreadPromotionFailure,
  type KnowledgeThreadPromotionRequest,
  type KnowledgeThreadPromotionResolvedPreview,
  type KnowledgeThreadPromotionShareCardPreview,
  type KnowledgeThreadPromotionStorePort,
} from './knowledgeThreadPromotionPorts.js';
import {
  createKnowledgeThreadPromotionTokenCodec,
  KnowledgeThreadPromotionTokenError,
} from './knowledgeThreadPromotionToken.js';
import {
  hasKnowledgePrincipal,
  knowledgeProvenanceAuditActor,
} from './knowledgeProvenanceValidation.js';

type TokenCodec = ReturnType<typeof createKnowledgeThreadPromotionTokenCodec>;
type FailureCode = KnowledgeThreadPromotionFailure['code'];

export type KnowledgeThreadPromotionUseCaseResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      statusCode: 400 | 404 | 409;
      code: FailureCode;
      message: string;
    };

class InvalidKnowledgeThreadPromotionInput extends Error {
  constructor() {
    super('invalid_knowledge_thread_promotion_input');
    this.name = 'InvalidKnowledgeThreadPromotionInput';
  }
}

const CONTROL_OR_DIRECTIONAL_CODE_POINTS = new Set([
  0x061c, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d,
  0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
]);

function ok<T>(value: T): KnowledgeThreadPromotionUseCaseResult<T> {
  return { ok: true, value };
}

function failure(
  statusCode: 400 | 404 | 409,
  code: FailureCode,
): KnowledgeThreadPromotionUseCaseResult<never> {
  const messages: Record<FailureCode, string> = {
    invalid_request: 'Invalid request',
    not_found: 'Not found',
    stale_preview: 'Preview is stale',
    preview_token_invalid: 'Invalid preview token',
    preview_token_expired: 'Preview token expired',
    idempotency_conflict: 'Idempotency conflict',
    organization_confirmation_required:
      'Organization audience confirmation is required',
    promotion_conflict: 'Promotion conflict',
  };
  return { ok: false, statusCode, code, message: messages[code] };
}

function portFailure(error: KnowledgeThreadPromotionFailure) {
  const statusCode =
    error.status === 400 || error.status === 404 || error.status === 409
      ? error.status
      : 409;
  return failure(statusCode, error.code);
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new InvalidKnowledgeThreadPromotionInput();
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  if (
    Object.keys(record).length !== allowed.size ||
    Object.keys(record).some((key) => !allowed.has(key))
  ) {
    throw new InvalidKnowledgeThreadPromotionInput();
  }
  return record;
}

function hasUnsafeCodePoint(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint < 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      CONTROL_OR_DIRECTIONAL_CODE_POINTS.has(codePoint)
    ) {
      return true;
    }
  }
  return false;
}

function boundedIdentifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    [...value].length > knowledgeThreadPromotionLimits.id ||
    Buffer.byteLength(value, 'utf8') > knowledgeThreadPromotionLimits.id * 4 ||
    hasUnsafeCodePoint(value)
  ) {
    throw new InvalidKnowledgeThreadPromotionInput();
  }
  return value;
}

function boundedRequestKey(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    [...value].length > knowledgeThreadPromotionLimits.requestKey ||
    Buffer.byteLength(value, 'utf8') >
      knowledgeThreadPromotionLimits.requestKey * 4 ||
    hasUnsafeCodePoint(value)
  ) {
    throw new InvalidKnowledgeThreadPromotionInput();
  }
  return value;
}

function boundedText(value: unknown, maximumCodePoints: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    [...value].length > maximumCodePoints
  ) {
    throw new InvalidKnowledgeThreadPromotionInput();
  }
  return value;
}

function boundedContent(value: unknown, maximumBytes: number): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    Buffer.byteLength(value, 'utf8') > maximumBytes
  ) {
    throw new InvalidKnowledgeThreadPromotionInput();
  }
  return value;
}

function normalizeSelectedReplies(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > knowledgeThreadPromotionLimits.selectedReplies
  ) {
    throw new InvalidKnowledgeThreadPromotionInput();
  }
  const selected = value.map(boundedIdentifier);
  if (new Set(selected).size !== selected.length) {
    throw new InvalidKnowledgeThreadPromotionInput();
  }
  return selected;
}

function normalizeUnresolvedQuestions(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > knowledgeThreadPromotionLimits.unresolvedQuestions
  ) {
    throw new InvalidKnowledgeThreadPromotionInput();
  }
  return value.map((question) =>
    boundedText(
      question,
      knowledgeThreadPromotionLimits.unresolvedQuestionCodePoints,
    ),
  );
}

function normalizeConfidence(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 10_000
  ) {
    throw new InvalidKnowledgeThreadPromotionInput();
  }
  return value;
}

function normalizeDestination(
  value: unknown,
  actor: KnowledgeActor,
): KnowledgeThreadPromotionDestination {
  const record = exactRecord(value, ['scope', 'organizationGroupAccountIds']);
  if (!Array.isArray(record.organizationGroupAccountIds)) {
    throw new InvalidKnowledgeThreadPromotionInput();
  }
  const groupAccountIds =
    record.organizationGroupAccountIds.map(boundedIdentifier);
  if (
    groupAccountIds.length >
      knowledgeThreadPromotionLimits.organizationGroupAccountIds ||
    new Set(groupAccountIds).size !== groupAccountIds.length
  ) {
    throw new InvalidKnowledgeThreadPromotionInput();
  }
  groupAccountIds.sort();
  if (record.scope === 'personal') {
    if (groupAccountIds.length !== 0) {
      throw new InvalidKnowledgeThreadPromotionInput();
    }
    return { scope: 'personal', organizationGroupAccountIds: [] };
  }
  if (
    record.scope !== 'organization' ||
    groupAccountIds.length === 0 ||
    typeof actor.organizationId !== 'string' ||
    actor.organizationId.trim().length === 0 ||
    groupAccountIds.some(
      (groupAccountId) => !actor.groupAccountIds.includes(groupAccountId),
    )
  ) {
    throw new InvalidKnowledgeThreadPromotionInput();
  }
  return {
    scope: 'organization',
    organizationGroupAccountIds: groupAccountIds,
  };
}

function normalizeRequest(
  value: unknown,
  actor: KnowledgeActor,
): KnowledgeThreadPromotionRequest {
  const record = exactRecord(value, [
    'selectedReplyMessageIds',
    'includeSharedCard',
    'destination',
    'synthesis',
  ]);
  if (typeof record.includeSharedCard !== 'boolean') {
    throw new InvalidKnowledgeThreadPromotionInput();
  }
  const synthesis = exactRecord(record.synthesis, [
    'title',
    'content',
    'confidenceBasisPoints',
    'unresolvedQuestions',
  ]);
  return {
    selectedReplyMessageIds: normalizeSelectedReplies(
      record.selectedReplyMessageIds,
    ),
    includeSharedCard: record.includeSharedCard,
    destination: normalizeDestination(record.destination, actor),
    synthesis: {
      title: boundedText(
        synthesis.title,
        knowledgeThreadPromotionLimits.titleCodePoints,
      ),
      content: boundedContent(
        synthesis.content,
        knowledgeThreadPromotionLimits.synthesisContentBytes,
      ),
      confidenceBasisPoints: normalizeConfidence(
        synthesis.confidenceBasisPoints,
      ),
      unresolvedQuestions: normalizeUnresolvedQuestions(
        synthesis.unresolvedQuestions,
      ),
    },
  };
}

function validActor(actor: KnowledgeActor): boolean {
  if (!hasKnowledgePrincipal(actor) || !actor.chat?.userId) return false;
  try {
    boundedIdentifier(actor.userId);
    boundedIdentifier(actor.chat.userId);
    for (const values of [
      actor.groupAccountIds,
      actor.chat.roles,
      actor.chat.projectIds,
      actor.chat.groupIds,
      actor.chat.groupAccountIds,
    ]) {
      if (!Array.isArray(values) || new Set(values).size !== values.length) {
        return false;
      }
      values.forEach((value) => boundedIdentifier(value));
    }
    return true;
  } catch (error) {
    if (error instanceof InvalidKnowledgeThreadPromotionInput) return false;
    throw error;
  }
}

function normalizedAuditActor(
  actor: KnowledgeActor,
  auditActor: KnowledgeAuditActorContext,
): KnowledgeAuditActorContext {
  return knowledgeProvenanceAuditActor(actor, auditActor);
}

function canonicalRequest(request: KnowledgeThreadPromotionRequest) {
  return {
    selectedReplyMessageIds: request.selectedReplyMessageIds,
    includeSharedCard: request.includeSharedCard,
    destination: request.destination,
    synthesis: request.synthesis,
  };
}

export function hashKnowledgeThreadPromotionRequestKey(
  actor: KnowledgeActor,
  requestKey: string,
): string {
  return createHash('sha256')
    .update('erp4:knowledge:thread-promotion-request-key:v1\0', 'utf8')
    .update(actor.userId, 'utf8')
    .update('\0', 'utf8')
    .update(requestKey, 'utf8')
    .digest('hex');
}

function hashRequestPayload(input: {
  rootMessageId: string;
  request: KnowledgeThreadPromotionRequest;
  previewPayloadBinding: string;
}): string {
  return createHash('sha256')
    .update('erp4:knowledge:thread-promotion-request-payload:v1\0', 'utf8')
    .update(
      JSON.stringify({
        rootMessageId: input.rootMessageId,
        request: canonicalRequest(input.request),
        previewPayloadBinding: input.previewPayloadBinding,
      }),
      'utf8',
    )
    .digest('hex');
}

function publicCard(card: KnowledgeThreadPromotionShareCardPreview) {
  return {
    schemaVersion: card.schemaVersion,
    shareVersion: card.shareVersion,
    ...(card.title === undefined ? {} : { title: card.title }),
    ...(card.sourceType === undefined ? {} : { sourceType: card.sourceType }),
    ...(card.canonicalUrl === undefined
      ? {}
      : { canonicalUrl: card.canonicalUrl }),
    ...(card.snapshot === undefined
      ? {}
      : {
          snapshot: {
            version: card.snapshot.version,
            sha256: card.snapshot.sha256,
            ...(card.snapshot.excerpt === undefined
              ? {}
              : { excerpt: card.snapshot.excerpt }),
          },
        }),
    ...(card.sharerNote === undefined ? {} : { sharerNote: card.sharerNote }),
    labels: card.labels.map((entry) => ({
      displayName: entry.displayName,
      ordinal: entry.ordinal,
    })),
    annotations: card.annotations.map((entry) => ({
      revision: entry.revision,
      kind: entry.kind,
      origin: entry.origin,
      content: entry.content,
      ordinal: entry.ordinal,
    })),
    turns: card.turns.map((entry) => ({
      role: entry.role,
      origin: entry.origin,
      content: entry.content,
      name: entry.name,
      occurredAt: entry.occurredAt?.toISOString() ?? null,
      ordinal: entry.ordinal,
    })),
    syntheses: card.syntheses.map((entry) => ({
      version: entry.version,
      title: entry.title,
      content: entry.content,
      confidenceBasisPoints: entry.confidenceBasisPoints,
      unresolvedQuestions: [...entry.unresolvedQuestions],
      ordinal: entry.ordinal,
    })),
    selectedCategories: [...card.selectedCategories],
    omittedCategories: [...card.omittedCategories],
  };
}

function publicPreview(resolved: KnowledgeThreadPromotionResolvedPreview) {
  return {
    sourceThread: {
      roomName: resolved.sourceRoomName,
      roomType: resolved.sourceRoomType,
      replyCount: resolved.threadReplyCount,
    },
    selectedMessages: resolved.selectedMessages.map((message) => ({
      ordinal: message.ordinal,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      authorCategory: message.authorCategory,
    })),
    selectedMessageCount: resolved.selectedMessages.length,
    omittedMessageCount: Math.max(
      0,
      resolved.threadReplyCount - resolved.selectedMessages.length,
    ),
    sharedCard:
      resolved.selectedShareCard === null
        ? null
        : publicCard(resolved.selectedShareCard),
    destination: {
      scope: resolved.destination.scope,
      organizationGroupCount:
        resolved.destination.organizationGroupAccountIds.length,
    },
  };
}

function publicCommit(record: KnowledgeThreadPromotionCommitRecord) {
  return {
    promotionId: record.promotionId,
    synthesisId: record.synthesisId,
    synthesisVersionId: record.synthesisVersionId,
    synthesisVersion: record.synthesisVersion,
    scope: record.scope,
    selectedMessageCount: record.selectedMessageCount,
    includesSharedCard: record.includesSharedCard,
    createdAt: record.createdAt.toISOString(),
  };
}

export function createKnowledgeThreadPromotionUseCases(dependencies: {
  store: KnowledgeThreadPromotionStorePort;
  tokenCodec?: TokenCodec;
}) {
  const tokenCodec =
    dependencies.tokenCodec ?? createKnowledgeThreadPromotionTokenCodec();

  return {
    async preview(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      rootMessageId: unknown;
      body: unknown;
    }): Promise<KnowledgeThreadPromotionUseCaseResult<unknown>> {
      if (!validActor(input.actor)) return failure(404, 'not_found');
      let rootMessageId: string;
      let request: KnowledgeThreadPromotionRequest;
      try {
        rootMessageId = boundedIdentifier(input.rootMessageId);
        request = normalizeRequest(input.body, input.actor);
      } catch (error) {
        if (error instanceof InvalidKnowledgeThreadPromotionInput) {
          return failure(400, 'invalid_request');
        }
        throw error;
      }
      const promotionId = tokenCodec.reservePromotionId();
      const resolved = await dependencies.store.preview({
        actor: input.actor,
        auditActor: normalizedAuditActor(input.actor, input.auditActor),
        rootMessageId,
        promotionId,
        request,
      });
      if (!resolved.ok) return portFailure(resolved.error);
      if (
        resolved.value.promotionId !== promotionId ||
        resolved.value.rootMessageId !== rootMessageId ||
        resolved.value.destination.scope !== request.destination.scope
      ) {
        return failure(409, 'promotion_conflict');
      }
      const token = tokenCodec.create({
        actor: input.actor,
        rootMessageId,
        bindingHash: resolved.value.bindingHash,
        promotionId,
      });
      const preview = publicPreview(resolved.value);
      return ok({
        ...preview,
        synthesis: {
          ...request.synthesis,
          unresolvedQuestions: [...request.synthesis.unresolvedQuestions],
        },
        previewToken: token.token,
        expiresAt: token.expiresAt.toISOString(),
        requiresConfirmation: true,
        requiresOrganizationAudienceConfirmation:
          request.destination.scope === 'organization',
      });
    },

    async commit(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      rootMessageId: unknown;
      body: unknown;
    }): Promise<KnowledgeThreadPromotionUseCaseResult<unknown>> {
      if (!validActor(input.actor)) return failure(404, 'not_found');
      let rootMessageId: string;
      let request: KnowledgeThreadPromotionRequest;
      let previewToken: unknown;
      let requestKey: string;
      try {
        rootMessageId = boundedIdentifier(input.rootMessageId);
        const body = exactRecord(input.body, [
          'selectedReplyMessageIds',
          'includeSharedCard',
          'destination',
          'synthesis',
          'previewToken',
          'requestKey',
          'confirmed',
          'organizationAudienceConfirmed',
        ]);
        if (body.confirmed !== true) {
          throw new InvalidKnowledgeThreadPromotionInput();
        }
        request = normalizeRequest(
          {
            selectedReplyMessageIds: body.selectedReplyMessageIds,
            includeSharedCard: body.includeSharedCard,
            destination: body.destination,
            synthesis: body.synthesis,
          },
          input.actor,
        );
        if (
          request.destination.scope === 'organization' &&
          body.organizationAudienceConfirmed !== true
        ) {
          return failure(400, 'organization_confirmation_required');
        }
        if (
          request.destination.scope === 'personal' &&
          body.organizationAudienceConfirmed !== false
        ) {
          throw new InvalidKnowledgeThreadPromotionInput();
        }
        previewToken = body.previewToken;
        requestKey = boundedRequestKey(body.requestKey);
      } catch (error) {
        if (error instanceof InvalidKnowledgeThreadPromotionInput) {
          return failure(400, 'invalid_request');
        }
        throw error;
      }

      let replayToken;
      try {
        replayToken = tokenCodec.readForReplay({
          actor: input.actor,
          rootMessageId,
          token: previewToken,
        });
      } catch (error) {
        if (!(error instanceof KnowledgeThreadPromotionTokenError)) throw error;
        return failure(400, error.code);
      }

      const requestKeyHash = hashKnowledgeThreadPromotionRequestKey(
        input.actor,
        requestKey,
      );
      const requestPayloadHash = hashRequestPayload({
        rootMessageId,
        request,
        previewPayloadBinding: replayToken.payloadBinding,
      });
      const replay = await dependencies.store.findIdempotent({
        actor: input.actor,
        auditActor: normalizedAuditActor(input.actor, input.auditActor),
        requestKeyHash,
        requestPayloadHash,
      });
      if (!replay.ok) return portFailure(replay.error);
      if (replay.value) {
        return ok({
          ...publicCommit(replay.value),
          created: false,
          reused: true,
        });
      }

      const resolved = await dependencies.store.resolveForCommit({
        actor: input.actor,
        rootMessageId,
        promotionId: replayToken.promotionId,
        request,
      });
      if (!resolved.ok) return portFailure(resolved.error);
      if (
        resolved.value.promotionId !== replayToken.promotionId ||
        resolved.value.rootMessageId !== rootMessageId ||
        resolved.value.destination.scope !== request.destination.scope
      ) {
        return failure(409, 'promotion_conflict');
      }
      let verified;
      try {
        verified = tokenCodec.verify({
          actor: input.actor,
          rootMessageId,
          bindingHash: resolved.value.bindingHash,
          token: previewToken,
        });
      } catch (error) {
        if (!(error instanceof KnowledgeThreadPromotionTokenError)) throw error;
        return failure(error.code === 'stale_preview' ? 409 : 400, error.code);
      }
      if (verified.promotionId !== replayToken.promotionId) {
        return failure(400, 'preview_token_invalid');
      }

      const committed = await dependencies.store.commit({
        actor: input.actor,
        auditActor: normalizedAuditActor(input.actor, input.auditActor),
        rootMessageId,
        promotionId: verified.promotionId,
        request,
        expectedBindingHash: resolved.value.bindingHash,
        requestKeyHash,
        requestPayloadHash,
      });
      if (!committed.ok) return portFailure(committed.error);
      return ok({
        ...publicCommit(committed.value),
        created: committed.value.created,
        reused: !committed.value.created,
      });
    },
  };
}

export type KnowledgeThreadPromotionUseCases = ReturnType<
  typeof createKnowledgeThreadPromotionUseCases
>;
