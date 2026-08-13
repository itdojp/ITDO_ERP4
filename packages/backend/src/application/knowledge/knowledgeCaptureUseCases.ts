import { createHash, randomUUID } from 'node:crypto';

import {
  KnowledgeArtifactStoreError,
  type KnowledgeArtifactPort,
} from './knowledgeArtifactPort.js';
import {
  canonicalizeKnowledgeCapture,
  knowledgeCaptureLimits,
  renderKnowledgeCaptureSnapshot,
  type CanonicalKnowledgeCapture,
} from './knowledgeCaptureDraft.js';
import type {
  KnowledgeCapture,
  KnowledgeCaptureTransaction,
  KnowledgeCaptureUnitOfWork,
} from './knowledgeCapturePorts.js';
import {
  createKnowledgeCaptureTokenCodec,
  KnowledgeCaptureTokenError,
  type KnowledgeCapturePreviewBinding,
} from './knowledgeCaptureToken.js';
import {
  knowledgeItemInputLimits,
  knowledgeSourceTypes,
  type KnowledgeActor,
  type KnowledgeAuditActorContext,
  type KnowledgeItemScope,
  type KnowledgeSourceType,
} from './knowledgeItemPorts.js';

export type KnowledgeCaptureFailure = {
  ok: false;
  statusCode: 400 | 403 | 404 | 409 | 502;
  code: string;
  message: string;
};

export type KnowledgeCaptureResult<T> =
  { ok: true; value: T } | KnowledgeCaptureFailure;

export type KnowledgeCaptureRequestShape = {
  draft: unknown;
  selectedFields: unknown;
  scope: unknown;
  organizationGroupAccountIds: unknown;
  sourceType: unknown;
};

type Prepared = {
  canonical: CanonicalKnowledgeCapture;
  binding: KnowledgeCapturePreviewBinding;
};

function failure(
  statusCode: KnowledgeCaptureFailure['statusCode'],
  code: string,
  message: string,
): KnowledgeCaptureFailure {
  return { ok: false, statusCode, code, message };
}

function invalid() {
  return failure(400, 'invalid_request', 'Capture request is invalid');
}

function notFound() {
  return failure(404, 'not_found', 'Capture was not found');
}

function auditActor(
  actor: KnowledgeActor,
  context: KnowledgeAuditActorContext,
) {
  return { userId: actor.userId, ...context };
}

function groups(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error('invalid_groups');
  }
  const result = [
    ...new Set(value.map((entry) => entry.trim()).filter(Boolean)),
  ].sort();
  if (
    result.length > knowledgeItemInputLimits.organizationGroupIds ||
    result.some(
      (entry) => entry.length > knowledgeItemInputLimits.organizationGroupId,
    )
  ) {
    throw new Error('invalid_groups');
  }
  return result;
}

function prepare(
  actor: KnowledgeActor,
  input: KnowledgeCaptureRequestShape,
): Prepared {
  const canonical = canonicalizeKnowledgeCapture(input);
  if (input.scope !== 'personal' && input.scope !== 'organization') {
    throw new Error('invalid_scope');
  }
  const scope = input.scope as KnowledgeItemScope;
  const organizationGroupAccountIds = groups(input.organizationGroupAccountIds);
  const organizationId = actor.organizationId?.trim() || null;
  if (
    scope === 'personal'
      ? organizationGroupAccountIds.length !== 0
      : !organizationId ||
        organizationGroupAccountIds.length === 0 ||
        organizationGroupAccountIds.some(
          (groupAccountId) => !actor.groupAccountIds.includes(groupAccountId),
        )
  ) {
    throw new Error('invalid_scope');
  }
  const sourceType =
    input.sourceType === undefined
      ? canonical.draft.url
        ? 'web'
        : 'manual'
      : input.sourceType;
  if (
    typeof sourceType !== 'string' ||
    !knowledgeSourceTypes.includes(sourceType as KnowledgeSourceType)
  ) {
    throw new Error('invalid_source_type');
  }
  return {
    canonical,
    binding: {
      canonical,
      scope,
      organizationId: scope === 'organization' ? organizationId : null,
      groupAccountIds: organizationGroupAccountIds,
      sourceType: sourceType as KnowledgeSourceType,
    },
  };
}

function captureResponse(capture: KnowledgeCapture, reused: boolean) {
  return {
    captureId: capture.id,
    itemId: capture.knowledgeItemId,
    snapshotId: capture.snapshotId,
    status: capture.status,
    failureCode: capture.failureCode,
    reused,
    createdAt: capture.createdAt,
    committedAt: capture.committedAt,
    failedAt: capture.failedAt,
  };
}

async function validGroups(
  transaction: KnowledgeCaptureTransaction,
  binding: KnowledgeCapturePreviewBinding,
) {
  if (binding.scope === 'personal') return true;
  return (
    (await transaction.captures.countActiveGroups(binding.groupAccountIds)) ===
    binding.groupAccountIds.length
  );
}

export function createKnowledgeCaptureService(dependencies: {
  artifacts: KnowledgeArtifactPort;
  unitOfWork: KnowledgeCaptureUnitOfWork;
  reader: {
    findOwnedById: KnowledgeCaptureTransaction['captures']['findOwnedById'];
    findOwnedArtifactState: KnowledgeCaptureTransaction['captures']['findOwnedArtifactState'];
  };
  tokenCodec?: ReturnType<typeof createKnowledgeCaptureTokenCodec>;
  now?: () => Date;
  randomId?: () => string;
  reportInternalError?: (error: unknown) => void;
}) {
  const tokenCodec =
    dependencies.tokenCodec ?? createKnowledgeCaptureTokenCodec();
  const now = dependencies.now ?? (() => new Date());
  const randomId = dependencies.randomId ?? randomUUID;
  const reportInternalError =
    dependencies.reportInternalError ?? (() => undefined);

  return {
    async preview(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      request: KnowledgeCaptureRequestShape;
    }): Promise<
      KnowledgeCaptureResult<{
        captureId: string;
        normalizedDraft: CanonicalKnowledgeCapture['draft'];
        selectedFields: CanonicalKnowledgeCapture['selectedFields'];
        omittedFields: CanonicalKnowledgeCapture['omittedFields'];
        scope: KnowledgeItemScope;
        sourceType: KnowledgeSourceType;
        fieldCount: number;
        byteCount: number;
        duplicateCandidate: {
          detected: boolean;
          status: KnowledgeCapture['status'] | null;
        };
        requiresOrganizationConfirmation: boolean;
        previewToken: string;
        expiresAt: Date;
      }>
    > {
      if (!input.actor.userId) return failure(403, 'forbidden', 'Forbidden');
      let prepared: Prepared;
      try {
        prepared = prepare(input.actor, input.request);
      } catch {
        return invalid();
      }
      const token = tokenCodec.create({
        actor: input.actor,
        binding: prepared.binding,
      });
      const payloadHash = tokenCodec.payloadHash(prepared.binding);
      const outcome = await dependencies.unitOfWork.run(async (transaction) => {
        if (!(await validGroups(transaction, prepared.binding))) {
          return { authorized: false as const, duplicate: null };
        }
        const duplicate = await transaction.captures.findRecentByPayload({
          ownerUserId: input.actor.userId,
          payloadHash,
        });
        await transaction.audit.write({
          action: 'knowledge_capture_previewed',
          actor: auditActor(input.actor, input.auditActor),
          targetId: token.captureId,
          metadata: {
            channel: prepared.canonical.draft.channel,
            scope: prepared.binding.scope,
            fieldCount: prepared.canonical.selectedFields.length,
            byteCount: prepared.canonical.payloadByteCount,
            resultCode: duplicate ? 'duplicate_candidate' : 'preview_ready',
          },
        });
        return { authorized: true as const, duplicate };
      });
      if (!outcome.authorized) return notFound();
      return {
        ok: true,
        value: {
          captureId: token.captureId,
          normalizedDraft: prepared.canonical.draft,
          selectedFields: prepared.canonical.selectedFields,
          omittedFields: prepared.canonical.omittedFields,
          scope: prepared.binding.scope,
          sourceType: prepared.binding.sourceType,
          fieldCount: prepared.canonical.selectedFields.length,
          byteCount: prepared.canonical.payloadByteCount,
          duplicateCandidate: {
            detected: outcome.duplicate !== null,
            status: outcome.duplicate?.status ?? null,
          },
          requiresOrganizationConfirmation:
            prepared.binding.scope === 'organization',
          previewToken: token.token,
          expiresAt: token.expiresAt,
        },
      };
    },

    async commit(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      request: KnowledgeCaptureRequestShape & {
        confirmed: unknown;
        organizationConfirmed: unknown;
        previewToken: unknown;
        requestKey: unknown;
      };
    }): Promise<KnowledgeCaptureResult<ReturnType<typeof captureResponse>>> {
      if (!input.actor.userId) return failure(403, 'forbidden', 'Forbidden');
      let prepared: Prepared;
      try {
        prepared = prepare(input.actor, input.request);
      } catch {
        return invalid();
      }
      if (
        input.request.confirmed !== true ||
        (prepared.binding.scope === 'organization' &&
          input.request.organizationConfirmed !== true) ||
        typeof input.request.requestKey !== 'string' ||
        input.request.requestKey.length === 0 ||
        Array.from(input.request.requestKey).length >
          knowledgeCaptureLimits.requestKeyCodePoints
      ) {
        return invalid();
      }
      let verified: { captureId: string };
      try {
        verified = tokenCodec.verify({
          actor: input.actor,
          binding: prepared.binding,
          token: input.request.previewToken,
        });
      } catch (error) {
        if (error instanceof KnowledgeCaptureTokenError) {
          return failure(
            409,
            error.code,
            'Capture preview is invalid or expired',
          );
        }
        throw error;
      }
      const requestKeyHash = tokenCodec.requestKeyHash(
        input.actor,
        input.request.requestKey,
      );
      const payloadHash = tokenCodec.payloadHash(prepared.binding);
      const body = Buffer.from(
        renderKnowledgeCaptureSnapshot(prepared.canonical),
        'utf8',
      );
      const sha256 = createHash('sha256').update(body).digest('hex');
      const itemId = randomId();
      const snapshotId = randomId();
      const intent = await dependencies.unitOfWork.run(async (transaction) => {
        const existing = await transaction.captures.findByRequestKey({
          ownerUserId: input.actor.userId,
          requestKeyHash,
        });
        if (existing) {
          if (existing.payloadHash !== payloadHash)
            return { kind: 'conflict' as const };
          await transaction.audit.write({
            action: 'knowledge_capture_duplicate_detected',
            actor: auditActor(input.actor, input.auditActor),
            targetId: existing.id,
            metadata: {
              channel: existing.channel,
              scope: existing.scope,
              fieldCount: existing.selectedFieldCount,
              byteCount: existing.payloadByteCount,
              resultCode: 'reused',
            },
          });
          return { kind: 'existing' as const, capture: existing };
        }
        if (!(await validGroups(transaction, prepared.binding))) {
          return { kind: 'not_found' as const };
        }
        const capture = await transaction.captures.createAggregate({
          id: verified.captureId,
          ownerUserId: input.actor.userId,
          requestKeyHash,
          payloadHash,
          channel: prepared.canonical.draft.channel,
          scope: prepared.binding.scope,
          organizationId: prepared.binding.organizationId,
          groupAccountIds: prepared.binding.groupAccountIds,
          sourceType: prepared.binding.sourceType,
          canonicalUrl: prepared.canonical.selectedFields.includes('url')
            ? prepared.canonical.draft.url
            : null,
          title: prepared.canonical.selectedFields.includes('title')
            ? prepared.canonical.draft.title
            : null,
          sourceAuthor: prepared.canonical.selectedFields.includes('author')
            ? prepared.canonical.draft.author
            : null,
          publishedAt:
            prepared.canonical.selectedFields.includes('publishedAt') &&
            prepared.canonical.draft.publishedAt
              ? new Date(prepared.canonical.draft.publishedAt)
              : null,
          capturedAt: new Date(prepared.canonical.draft.capturedAt),
          itemId,
          snapshotId,
          snapshotRequestKeyHash: createHash('sha256')
            .update(
              `erp4:knowledge:capture-snapshot-request:v1\0${requestKeyHash}`,
            )
            .digest('hex'),
          snapshotPayloadHash: prepared.canonical.payloadHash,
          selectedFieldCount: prepared.canonical.selectedFields.length,
          payloadByteCount: prepared.canonical.payloadByteCount,
          createdBy: input.actor.userId,
        });
        await transaction.audit.write({
          action: 'knowledge_capture_pending',
          actor: auditActor(input.actor, input.auditActor),
          targetId: capture.id,
          metadata: {
            channel: capture.channel,
            scope: capture.scope,
            fieldCount: capture.selectedFieldCount,
            byteCount: capture.payloadByteCount,
            resultCode: 'artifact_pending',
          },
        });
        return { kind: 'created' as const, capture };
      });
      if (intent.kind === 'conflict') {
        return failure(
          409,
          'idempotency_conflict',
          'Request key conflicts with another capture',
        );
      }
      if (intent.kind === 'not_found') return notFound();
      if (intent.kind === 'existing') {
        return { ok: true, value: captureResponse(intent.capture, true) };
      }

      const contentType = 'text/plain';
      try {
        const recorded = await dependencies.unitOfWork.run((transaction) =>
          transaction.captures.recordMaterialized({
            captureId: intent.capture.id,
            contentType,
            extractedText: body.toString('utf8'),
            sha256,
            sizeBytes: body.length,
          }),
        );
        if (!recorded) {
          return { ok: true, value: captureResponse(intent.capture, false) };
        }
      } catch (error) {
        reportInternalError(error);
        return { ok: true, value: captureResponse(intent.capture, false) };
      }

      let artifact: Awaited<ReturnType<KnowledgeArtifactPort['store']>>;
      try {
        artifact = await dependencies.artifacts.store({
          body,
          contentType,
          createdBy: input.actor.userId,
          idempotencyNamespace: `knowledge-capture:${intent.capture.id}:${requestKeyHash}`,
          originalName: 'knowledge-capture.txt',
          sha256,
          sizeBytes: body.length,
          snapshotId: intent.capture.snapshotId,
        });
      } catch (error) {
        if (
          error instanceof KnowledgeArtifactStoreError &&
          error.outcome === 'failed'
        ) {
          const failedCapture = await dependencies.unitOfWork.run(
            async (transaction) => {
              const failed = await transaction.captures.markFailed({
                captureId: intent.capture.id,
                failedAt: now(),
                failureCode: 'snapshot_storage_failed',
              });
              if (failed) {
                await transaction.audit.write({
                  action: 'knowledge_capture_rejected',
                  actor: auditActor(input.actor, input.auditActor),
                  targetId: failed.id,
                  metadata: {
                    channel: failed.channel,
                    scope: failed.scope,
                    fieldCount: failed.selectedFieldCount,
                    byteCount: failed.payloadByteCount,
                    resultCode: 'snapshot_storage_failed',
                  },
                });
              }
              return failed;
            },
          );
          if (failedCapture)
            return { ok: true, value: captureResponse(failedCapture, false) };
        }
        return { ok: true, value: captureResponse(intent.capture, false) };
      }
      if (
        artifact.contentType !== contentType ||
        artifact.sha256 !== sha256 ||
        artifact.sizeBytes !== body.length
      ) {
        return { ok: true, value: captureResponse(intent.capture, false) };
      }
      try {
        const ready = await dependencies.unitOfWork.run(async (transaction) => {
          const updated = await transaction.captures.markReady({
            captureId: intent.capture.id,
            artifactId: artifact.artifactId,
            contentType,
            sha256,
            sizeBytes: body.length,
            committedAt: now(),
          });
          if (updated) {
            await transaction.audit.write({
              action: 'knowledge_capture_committed',
              actor: auditActor(input.actor, input.auditActor),
              targetId: updated.id,
              metadata: {
                channel: updated.channel,
                scope: updated.scope,
                fieldCount: updated.selectedFieldCount,
                byteCount: updated.payloadByteCount,
                resultCode: 'ready',
              },
            });
          }
          return updated;
        });
        return ready
          ? { ok: true, value: captureResponse(ready, false) }
          : { ok: true, value: captureResponse(intent.capture, false) };
      } catch (error) {
        reportInternalError(error);
        return { ok: true, value: captureResponse(intent.capture, false) };
      }
    },

    async detail(input: { actor: KnowledgeActor; captureId: string }) {
      if (!input.actor.userId || !input.captureId) return invalid();
      const capture = await dependencies.reader.findOwnedById(input);
      return capture
        ? ({ ok: true, value: captureResponse(capture, false) } as const)
        : notFound();
    },

    async reconcile(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      captureId: string;
    }): Promise<KnowledgeCaptureResult<ReturnType<typeof captureResponse>>> {
      if (!input.actor.userId || !input.captureId) return invalid();
      const state = await dependencies.reader.findOwnedArtifactState(input);
      if (!state) return notFound();
      if (state.capture.status !== 'pending') {
        return { ok: true, value: captureResponse(state.capture, true) };
      }
      if (!state.contentType || !state.sha256 || state.sizeBytes === null) {
        return { ok: true, value: captureResponse(state.capture, true) };
      }
      const artifact = await dependencies.artifacts
        .reconcile({
          contentType: state.contentType,
          idempotencyNamespace: `knowledge-capture:${state.capture.id}:${state.capture.requestKeyHash}`,
          originalName: state.originalName,
          sha256: state.sha256,
          sizeBytes: state.sizeBytes,
          snapshotId: state.capture.snapshotId,
        })
        .catch(() => null);
      if (!artifact) {
        return { ok: true, value: captureResponse(state.capture, true) };
      }
      const ready = await dependencies.unitOfWork.run(async (transaction) => {
        const updated = await transaction.captures.markReady({
          captureId: state.capture.id,
          artifactId: artifact.artifactId,
          contentType: state.contentType as string,
          sha256: state.sha256 as string,
          sizeBytes: state.sizeBytes as number,
          committedAt: now(),
        });
        if (updated) {
          await transaction.audit.write({
            action: 'knowledge_capture_reconciled',
            actor: auditActor(input.actor, input.auditActor),
            targetId: updated.id,
            metadata: {
              channel: updated.channel,
              scope: updated.scope,
              fieldCount: updated.selectedFieldCount,
              byteCount: updated.payloadByteCount,
              resultCode: 'ready',
            },
          });
        }
        return updated;
      });
      return ready
        ? { ok: true, value: captureResponse(ready, false) }
        : { ok: true, value: captureResponse(state.capture, true) };
    },
  };
}
