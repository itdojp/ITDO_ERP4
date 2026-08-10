import { createHash } from 'node:crypto';

import type {
  KnowledgeActor,
  KnowledgeAuditActorContext,
} from './knowledgeItemPorts.js';
import {
  knowledgeShareLimits,
  type KnowledgeShareCardSnapshot,
  type KnowledgeShareChatActor,
  type KnowledgeShareChatIntegrationPort,
  type KnowledgeShareFailure,
  type KnowledgeShareSelection,
  type KnowledgeShareStatusRecord,
  type KnowledgeShareStorePort,
} from './knowledgeSharePorts.js';
import {
  createKnowledgeShareTokenCodec,
  KnowledgeShareTokenError,
} from './knowledgeShareToken.js';
import {
  hasKnowledgePrincipal,
  knowledgeProvenanceAuditActor,
} from './knowledgeProvenanceValidation.js';

type TokenCodec = ReturnType<typeof createKnowledgeShareTokenCodec>;

type KnowledgeShareFailureCode = KnowledgeShareFailure['code'];

export type KnowledgeShareUseCaseResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      statusCode: 400 | 404 | 409 | 502;
      code: KnowledgeShareFailureCode;
      message: string;
    };

class InvalidKnowledgeShareInput extends Error {
  constructor() {
    super('invalid_knowledge_share_input');
    this.name = 'InvalidKnowledgeShareInput';
  }
}

const CONTROL_OR_DIRECTIONAL_CODE_POINTS = new Set([
  0x061c, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d,
  0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
]);

function ok<T>(value: T): KnowledgeShareUseCaseResult<T> {
  return { ok: true, value };
}

function failure(
  statusCode: 400 | 404 | 409 | 502,
  code: KnowledgeShareFailureCode,
): KnowledgeShareUseCaseResult<never> {
  const messages: Record<KnowledgeShareFailureCode, string> = {
    invalid_request: 'Invalid request',
    not_found: 'Not found',
    stale_preview: 'Preview is stale',
    preview_token_invalid: 'Invalid preview token',
    preview_token_expired: 'Preview token expired',
    idempotency_conflict: 'Idempotency conflict',
    external_audience_not_supported: 'Destination is not supported',
    share_post_failed: 'Share post failed',
  };
  return { ok: false, statusCode, code, message: messages[code] };
}

function portFailure(
  error: KnowledgeShareFailure,
): KnowledgeShareUseCaseResult<never> {
  const expectedStatus =
    error.status === 400 ||
    error.status === 404 ||
    error.status === 409 ||
    error.status === 502
      ? error.status
      : 502;
  return failure(expectedStatus, error.code);
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
    throw new InvalidKnowledgeShareInput();
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new InvalidKnowledgeShareInput();
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

function boundedString(
  value: unknown,
  maximumCodePoints: number,
  maximumBytes = maximumCodePoints * 4,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    [...value].length > maximumCodePoints ||
    Buffer.byteLength(value, 'utf8') > maximumBytes ||
    hasUnsafeCodePoint(value)
  ) {
    throw new InvalidKnowledgeShareInput();
  }
  return value;
}

function boundedId(value: unknown): string {
  return boundedString(value, knowledgeShareLimits.id);
}

function positiveVersion(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 2_147_483_647
  ) {
    throw new InvalidKnowledgeShareInput();
  }
  return value;
}

function exactBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new InvalidKnowledgeShareInput();
  }
  return value;
}

function uniqueStrings(value: unknown, maximumItems: number): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new InvalidKnowledgeShareInput();
  }
  const normalized = value.map(boundedId);
  if (new Set(normalized).size !== normalized.length) {
    throw new InvalidKnowledgeShareInput();
  }
  return normalized;
}

function normalizeSelection(value: unknown): KnowledgeShareSelection {
  const record = exactRecord(value, [
    'includeTitle',
    'includeSourceType',
    'includeCanonicalUrl',
    'snapshot',
    'labelAssignmentIds',
    'annotations',
    'conversationTurnIds',
    'syntheses',
    'sharerNote',
  ]);
  const includeTitle = exactBoolean(record.includeTitle);
  const includeSourceType = exactBoolean(record.includeSourceType);
  const includeCanonicalUrl = exactBoolean(record.includeCanonicalUrl);

  let snapshot: KnowledgeShareSelection['snapshot'];
  if (record.snapshot === null) {
    snapshot = null;
  } else {
    const snapshotRecord = exactRecord(record.snapshot, [
      'snapshotId',
      'includeProvenance',
      'includeExcerpt',
    ]);
    const includeProvenance = exactBoolean(snapshotRecord.includeProvenance);
    const includeExcerpt = exactBoolean(snapshotRecord.includeExcerpt);
    if (!includeProvenance && !includeExcerpt) {
      throw new InvalidKnowledgeShareInput();
    }
    snapshot = {
      snapshotId: boundedId(snapshotRecord.snapshotId),
      includeProvenance,
      includeExcerpt,
    };
  }

  const labelAssignmentIds = uniqueStrings(
    record.labelAssignmentIds,
    knowledgeShareLimits.labels,
  );
  const conversationTurnIds = uniqueStrings(
    record.conversationTurnIds,
    knowledgeShareLimits.turns,
  );

  if (
    !Array.isArray(record.annotations) ||
    record.annotations.length > knowledgeShareLimits.annotations
  ) {
    throw new InvalidKnowledgeShareInput();
  }
  const annotations = record.annotations.map((value) => {
    const selector = exactRecord(value, ['annotationId', 'revision']);
    return {
      annotationId: boundedId(selector.annotationId),
      revision: positiveVersion(selector.revision),
    };
  });
  if (
    new Set(
      annotations.map(
        (selector) => `${selector.annotationId}\0${selector.revision}`,
      ),
    ).size !== annotations.length
  ) {
    throw new InvalidKnowledgeShareInput();
  }

  if (
    !Array.isArray(record.syntheses) ||
    record.syntheses.length > knowledgeShareLimits.syntheses
  ) {
    throw new InvalidKnowledgeShareInput();
  }
  const syntheses = record.syntheses.map((value) => {
    const selector = exactRecord(value, ['synthesisId', 'version']);
    return {
      synthesisId: boundedId(selector.synthesisId),
      version: positiveVersion(selector.version),
    };
  });
  if (
    new Set(
      syntheses.map(
        (selector) => `${selector.synthesisId}\0${selector.version}`,
      ),
    ).size !== syntheses.length
  ) {
    throw new InvalidKnowledgeShareInput();
  }

  let sharerNote: string | null;
  if (record.sharerNote === null) {
    sharerNote = null;
  } else {
    sharerNote = boundedString(
      record.sharerNote,
      knowledgeShareLimits.sharerNoteBytes,
      knowledgeShareLimits.sharerNoteBytes,
    );
  }

  if (
    !includeTitle &&
    !includeSourceType &&
    !includeCanonicalUrl &&
    snapshot === null &&
    labelAssignmentIds.length === 0 &&
    annotations.length === 0 &&
    conversationTurnIds.length === 0 &&
    syntheses.length === 0 &&
    sharerNote === null
  ) {
    throw new InvalidKnowledgeShareInput();
  }

  return {
    includeTitle,
    includeSourceType,
    includeCanonicalUrl,
    snapshot,
    labelAssignmentIds,
    annotations,
    conversationTurnIds,
    syntheses,
    sharerNote,
  };
}

function validChatActor(
  actor: KnowledgeActor,
  chatActor: KnowledgeShareChatActor,
): boolean {
  if (chatActor.canonicalUserId !== actor.userId) return false;
  try {
    boundedId(chatActor.canonicalUserId);
    boundedId(chatActor.userId);
    for (const values of [
      chatActor.roles,
      chatActor.projectIds,
      chatActor.groupIds,
      chatActor.groupAccountIds,
    ]) {
      if (!Array.isArray(values) || new Set(values).size !== values.length) {
        return false;
      }
      values.forEach((value) => boundedId(value));
    }
    return true;
  } catch (error) {
    if (error instanceof InvalidKnowledgeShareInput) return false;
    throw error;
  }
}

function normalizedAuditActor(
  actor: KnowledgeActor,
  auditActor: KnowledgeAuditActorContext,
): KnowledgeAuditActorContext {
  return knowledgeProvenanceAuditActor(actor, auditActor);
}

function canonicalSelection(selection: KnowledgeShareSelection) {
  return {
    includeTitle: selection.includeTitle,
    includeSourceType: selection.includeSourceType,
    includeCanonicalUrl: selection.includeCanonicalUrl,
    snapshot: selection.snapshot,
    labelAssignmentIds: selection.labelAssignmentIds,
    annotations: selection.annotations,
    conversationTurnIds: selection.conversationTurnIds,
    syntheses: selection.syntheses,
    sharerNote: selection.sharerNote,
  };
}

export function hashKnowledgeShareRequestKey(
  actor: KnowledgeActor,
  requestKey: string,
): string {
  return createHash('sha256')
    .update('erp4:knowledge:share-request-key:v1\0', 'utf8')
    .update(actor.userId, 'utf8')
    .update('\0', 'utf8')
    .update(requestKey, 'utf8')
    .digest('hex');
}

function hashRequestPayload(input: {
  itemId: string;
  destinationRoomId: string;
  selection: KnowledgeShareSelection;
  previewPayloadBinding: string;
}): string {
  return createHash('sha256')
    .update('erp4:knowledge:share-request-payload:v1\0', 'utf8')
    .update(
      JSON.stringify({
        itemId: input.itemId,
        destinationRoomId: input.destinationRoomId,
        selection: canonicalSelection(input.selection),
        previewPayloadBinding: input.previewPayloadBinding,
      }),
      'utf8',
    )
    .digest('hex');
}

function publicCard(snapshot: KnowledgeShareCardSnapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    ...(snapshot.title === undefined ? {} : { title: snapshot.title }),
    ...(snapshot.sourceType === undefined
      ? {}
      : { sourceType: snapshot.sourceType }),
    ...(snapshot.canonicalUrl === undefined
      ? {}
      : { canonicalUrl: snapshot.canonicalUrl }),
    ...(snapshot.snapshot === undefined
      ? {}
      : {
          snapshot: {
            ...(snapshot.selectedCategories.includes('snapshot_provenance')
              ? {
                  version: snapshot.snapshot.version,
                  sha256: snapshot.snapshot.sha256,
                }
              : {}),
            ...(!snapshot.selectedCategories.includes('snapshot_excerpt') ||
            snapshot.snapshot.excerpt === undefined
              ? {}
              : { excerpt: snapshot.snapshot.excerpt }),
          },
        }),
    ...(snapshot.sharerNote === undefined
      ? {}
      : { sharerNote: snapshot.sharerNote }),
    labels: snapshot.labels.map((label) => ({
      displayName: label.displayName,
      ordinal: label.ordinal,
    })),
    annotations: snapshot.annotations.map((annotation) => ({
      revision: annotation.revision,
      kind: annotation.kind,
      origin: annotation.origin,
      content: annotation.content,
      ordinal: annotation.ordinal,
    })),
    turns: snapshot.turns.map((turn) => ({
      role: turn.role,
      origin: turn.origin,
      content: turn.content,
      name: turn.name,
      occurredAt: turn.occurredAt?.toISOString() ?? null,
      ordinal: turn.ordinal,
    })),
    syntheses: snapshot.syntheses.map((synthesis) => ({
      version: synthesis.version,
      title: synthesis.title,
      content: synthesis.content,
      confidenceBasisPoints: synthesis.confidenceBasisPoints,
      unresolvedQuestions: [...synthesis.unresolvedQuestions],
      ordinal: synthesis.ordinal,
    })),
    selectedCategories: [...snapshot.selectedCategories],
    omittedCategories: [...snapshot.omittedCategories],
  };
}

function publicStatus(record: KnowledgeShareStatusRecord) {
  return {
    shareId: record.shareId,
    status: record.status,
    version: record.version,
    chatMessageId: record.chatMessageId,
    failureCode: record.failureCode,
    createdAt: record.createdAt.toISOString(),
    postedAt: record.postedAt?.toISOString() ?? null,
    failedAt: record.failedAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
  };
}

function validateContext(input: {
  actor: KnowledgeActor;
  chatActor: KnowledgeShareChatActor;
}): KnowledgeShareUseCaseResult<never> | null {
  return hasKnowledgePrincipal(input.actor) &&
    validChatActor(input.actor, input.chatActor)
    ? null
    : failure(404, 'not_found');
}

export function createKnowledgeShareUseCases(dependencies: {
  store: KnowledgeShareStorePort;
  chatIntegration: KnowledgeShareChatIntegrationPort;
  tokenCodec?: TokenCodec;
}) {
  const tokenCodec =
    dependencies.tokenCodec ?? createKnowledgeShareTokenCodec();

  return {
    async preview(input: {
      actor: KnowledgeActor;
      chatActor: KnowledgeShareChatActor;
      auditActor: KnowledgeAuditActorContext;
      itemId: unknown;
      body: unknown;
    }): Promise<KnowledgeShareUseCaseResult<unknown>> {
      const contextFailure = validateContext(input);
      if (contextFailure) return contextFailure;
      const shareId = tokenCodec.reserveShareId();
      let itemId: string;
      let destinationRoomId: string;
      let selection: KnowledgeShareSelection;
      try {
        itemId = boundedId(input.itemId);
        const body = exactRecord(input.body, [
          'destinationRoomId',
          'selection',
        ]);
        destinationRoomId = boundedId(body.destinationRoomId);
        selection = normalizeSelection(body.selection);
      } catch (error) {
        if (error instanceof InvalidKnowledgeShareInput) {
          return failure(400, 'invalid_request');
        }
        throw error;
      }
      const resolved = await dependencies.store.preview({
        actor: input.actor,
        chatActor: input.chatActor,
        auditActor: normalizedAuditActor(input.actor, input.auditActor),
        shareId,
        itemId,
        destinationRoomId,
        selection,
      });
      if (!resolved.ok) return portFailure(resolved.error);
      const token = tokenCodec.create({
        actor: input.actor,
        sourceItemId: itemId,
        destinationRoomId,
        bindingHash: resolved.value.bindingHash,
        shareId,
      });
      return ok({
        destinationRoom: {
          name: resolved.value.destinationRoomName,
          type: resolved.value.destinationRoomType,
        },
        card: publicCard(resolved.value.snapshot),
        previewToken: token.token,
        expiresAt: token.expiresAt.toISOString(),
        requiresConfirmation: true,
      });
    },

    async commit(input: {
      actor: KnowledgeActor;
      chatActor: KnowledgeShareChatActor;
      auditActor: KnowledgeAuditActorContext;
      itemId: unknown;
      body: unknown;
    }): Promise<KnowledgeShareUseCaseResult<unknown>> {
      const contextFailure = validateContext(input);
      if (contextFailure) return contextFailure;
      let itemId: string;
      let destinationRoomId: string;
      let selection: KnowledgeShareSelection;
      let previewToken: unknown;
      let requestKey: string;
      try {
        itemId = boundedId(input.itemId);
        const body = exactRecord(input.body, [
          'destinationRoomId',
          'selection',
          'previewToken',
          'requestKey',
          'confirmed',
        ]);
        if (body.confirmed !== true) {
          throw new InvalidKnowledgeShareInput();
        }
        destinationRoomId = boundedId(body.destinationRoomId);
        selection = normalizeSelection(body.selection);
        requestKey = boundedString(
          body.requestKey,
          knowledgeShareLimits.requestKey,
        );
        previewToken = body.previewToken;
      } catch (error) {
        if (error instanceof InvalidKnowledgeShareInput) {
          return failure(400, 'invalid_request');
        }
        throw error;
      }

      let replayToken;
      try {
        replayToken = tokenCodec.readForReplay({
          actor: input.actor,
          sourceItemId: itemId,
          destinationRoomId,
          token: previewToken,
        });
      } catch (error) {
        if (!(error instanceof KnowledgeShareTokenError)) throw error;
        return failure(400, error.code);
      }

      const requestKeyHash = hashKnowledgeShareRequestKey(
        input.actor,
        requestKey,
      );
      const requestPayloadHash = hashRequestPayload({
        itemId,
        destinationRoomId,
        selection,
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
          ...publicStatus(replay.value),
          created: false,
          reused: true,
          resultUnknown: false,
        });
      }

      const resolved = await dependencies.store.resolveForCommit({
        actor: input.actor,
        chatActor: input.chatActor,
        itemId,
        destinationRoomId,
        selection,
      });
      if (!resolved.ok) return portFailure(resolved.error);
      let verified;
      try {
        verified = tokenCodec.verify({
          actor: input.actor,
          sourceItemId: itemId,
          destinationRoomId,
          bindingHash: resolved.value.bindingHash,
          token: previewToken,
        });
      } catch (error) {
        if (!(error instanceof KnowledgeShareTokenError)) throw error;
        return failure(error.code === 'stale_preview' ? 409 : 400, error.code);
      }
      if (verified.shareId !== replayToken.shareId) {
        return failure(400, 'preview_token_invalid');
      }

      const pending = await dependencies.store.createPending({
        actor: input.actor,
        chatActor: input.chatActor,
        auditActor: normalizedAuditActor(input.actor, input.auditActor),
        itemId,
        destinationRoomId,
        selection,
        expectedBindingHash: resolved.value.bindingHash,
        requestKeyHash,
        requestPayloadHash,
        shareId: verified.shareId,
      });
      if (!pending.ok) return portFailure(pending.error);

      if (!pending.value.created || pending.value.status !== 'pending') {
        return ok({
          ...publicStatus(pending.value),
          created: false,
          reused: true,
          resultUnknown: false,
        });
      }

      try {
        const posted = await dependencies.chatIntegration.postPending({
          actor: input.actor,
          chatActor: input.chatActor,
          auditActor: normalizedAuditActor(input.actor, input.auditActor),
          shareId: pending.value.shareId,
          expectedBindingHash: resolved.value.bindingHash,
        });
        if (!posted.ok) return portFailure(posted.error);
        try {
          await dependencies.chatIntegration.notifyPosted({
            actor: input.actor,
            chatActor: input.chatActor,
            auditActor: normalizedAuditActor(input.actor, input.auditActor),
            shareId: pending.value.shareId,
          });
        } catch {
          // Chat notification delivery is intentionally fail-open after the
          // message/share transaction has committed. The integration adapter
          // records only a sanitized warning on failure.
        }
        return ok({
          ...publicStatus(posted.value),
          created: true,
          reused: false,
          resultUnknown: false,
        });
      } catch {
        return ok({
          ...publicStatus(pending.value),
          created: true,
          reused: false,
          resultUnknown: true,
        });
      }
    },

    async status(input: {
      actor: KnowledgeActor;
      chatActor: KnowledgeShareChatActor;
      shareId: unknown;
    }): Promise<KnowledgeShareUseCaseResult<unknown>> {
      const contextFailure = validateContext(input);
      if (contextFailure) return contextFailure;
      let shareId: string;
      try {
        shareId = boundedId(input.shareId);
      } catch (error) {
        if (error instanceof InvalidKnowledgeShareInput) {
          return failure(400, 'invalid_request');
        }
        throw error;
      }
      const result = await dependencies.store.findStatus({
        actor: input.actor,
        chatActor: input.chatActor,
        shareId,
      });
      return result.ok
        ? ok(publicStatus(result.value))
        : portFailure(result.error);
    },

    async reconcile(input: {
      actor: KnowledgeActor;
      chatActor: KnowledgeShareChatActor;
      auditActor: KnowledgeAuditActorContext;
      shareId: unknown;
    }): Promise<KnowledgeShareUseCaseResult<unknown>> {
      const contextFailure = validateContext(input);
      if (contextFailure) return contextFailure;
      let shareId: string;
      try {
        shareId = boundedId(input.shareId);
      } catch (error) {
        if (error instanceof InvalidKnowledgeShareInput) {
          return failure(400, 'invalid_request');
        }
        throw error;
      }
      const result = await dependencies.chatIntegration.reconcile({
        actor: input.actor,
        chatActor: input.chatActor,
        auditActor: normalizedAuditActor(input.actor, input.auditActor),
        shareId,
      });
      if (!result.ok) return portFailure(result.error);
      if (result.value.status === 'posted') {
        try {
          await dependencies.chatIntegration.notifyPosted({
            actor: input.actor,
            chatActor: input.chatActor,
            auditActor: normalizedAuditActor(input.actor, input.auditActor),
            shareId,
          });
        } catch {
          // Reconciliation may safely retry the idempotent, content-free
          // notification side effect without changing share lifecycle state.
        }
      }
      return ok(publicStatus(result.value));
    },

    async revoke(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      shareId: unknown;
    }): Promise<KnowledgeShareUseCaseResult<unknown>> {
      if (!hasKnowledgePrincipal(input.actor)) {
        return failure(404, 'not_found');
      }
      let shareId: string;
      try {
        shareId = boundedId(input.shareId);
      } catch (error) {
        if (error instanceof InvalidKnowledgeShareInput) {
          return failure(400, 'invalid_request');
        }
        throw error;
      }
      const result = await dependencies.store.revoke({
        actor: input.actor,
        auditActor: normalizedAuditActor(input.actor, input.auditActor),
        shareId,
      });
      return result.ok
        ? ok(publicStatus(result.value))
        : portFailure(result.error);
    },

    async openSource(input: {
      actor: KnowledgeActor;
      chatActor: KnowledgeShareChatActor;
      shareId: unknown;
    }): Promise<KnowledgeShareUseCaseResult<unknown>> {
      const contextFailure = validateContext(input);
      if (contextFailure) return contextFailure;
      let shareId: string;
      try {
        shareId = boundedId(input.shareId);
      } catch (error) {
        if (error instanceof InvalidKnowledgeShareInput) {
          return failure(400, 'invalid_request');
        }
        throw error;
      }
      const result = await dependencies.store.openSource({
        actor: input.actor,
        chatActor: input.chatActor,
        shareId,
      });
      return result.ok ? ok(result.value) : portFailure(result.error);
    },
  };
}

export type KnowledgeShareUseCases = ReturnType<
  typeof createKnowledgeShareUseCases
>;
