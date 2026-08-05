import { createHash, randomUUID } from 'node:crypto';

import type {
  KnowledgeActor,
  KnowledgeAuditActorContext,
} from './knowledgeItemPorts.js';
import type {
  KnowledgeArtifactPort,
  OpenedKnowledgeArtifact,
} from './knowledgeArtifactPort.js';
import {
  KnowledgeArtifactOpenError,
  KnowledgeArtifactStoreError,
} from './knowledgeArtifactPort.js';
import {
  KnowledgeSnapshotCaptureError,
  defaultOriginalName,
  materializeKnowledgeText,
  materializeKnowledgeUpload,
  materializeKnowledgeUrl,
  normalizeKnowledgeSnapshotOriginalName,
  normalizeKnowledgeSnapshotSourceUrl,
  type MaterializedKnowledgeSnapshot,
} from './knowledgeSnapshotCapture.js';
import {
  knowledgeSnapshotCaptureMethods,
  knowledgeSnapshotLimits,
  KnowledgeSnapshotTransactionConflictError,
  type KnowledgeSnapshot,
  type KnowledgeSnapshotCaptureMethod,
  type KnowledgeSnapshotReadRepository,
  type KnowledgeSnapshotTransaction,
  type KnowledgeSnapshotUnitOfWork,
} from './knowledgeSnapshotPorts.js';

export type CaptureKnowledgeSnapshotInput = {
  actor: KnowledgeActor;
  auditActor: KnowledgeAuditActorContext;
  itemId: string;
  requestKey: string;
  captureMethod: KnowledgeSnapshotCaptureMethod;
  originalName?: string;
  text?: string;
  url?: string;
  upload?: {
    body: Buffer;
    contentType: string;
    originalName: string;
  };
};

export type KnowledgeSnapshotApplicationFailure = {
  ok: false;
  statusCode: 400 | 404 | 409 | 413 | 415 | 502 | 504;
  code:
    | 'idempotency_conflict'
    | 'invalid_request'
    | 'not_found'
    | 'snapshot_capture_failed'
    | 'snapshot_capture_timeout'
    | 'snapshot_content_invalid'
    | 'snapshot_content_too_large'
    | 'snapshot_content_type_unsupported'
    | 'snapshot_download_failed'
    | 'snapshot_reconciliation_failed'
    | 'snapshot_reconciliation_pending'
    | 'snapshot_state_conflict'
    | 'snapshot_storage_failed'
    | 'snapshot_storage_pending';
  message: string;
};

export type KnowledgeSnapshotApplicationResult<T> =
  { ok: true; value: T } | KnowledgeSnapshotApplicationFailure;

type PreparedCapture = {
  captureMethod: KnowledgeSnapshotCaptureMethod;
  load: () => Promise<MaterializedKnowledgeSnapshot>;
  originalName: string;
  requestPayloadHash: string;
  sourceUrl: string | null;
};

type KnowledgeSnapshotServiceDependencies = {
  artifacts: KnowledgeArtifactPort;
  now?: () => Date;
  randomId?: () => string;
  reader: KnowledgeSnapshotReadRepository;
  unitOfWork: KnowledgeSnapshotUnitOfWork;
  materializeUrl?: typeof materializeKnowledgeUrl;
};

function hash(parts: Array<string | Buffer>) {
  const digest = createHash('sha256');
  for (const part of parts) {
    const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part, 'utf8');
    digest.update(String(buffer.length));
    digest.update(':');
    digest.update(buffer);
    digest.update('\0');
  }
  return digest.digest('hex');
}

function hasPrincipal(actor: KnowledgeActor) {
  return typeof actor?.userId === 'string' && actor.userId.trim().length > 0;
}

function isBoundedString(value: unknown, maximum: number) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    [...value].length <= maximum
  );
}

function invalid(message = 'Invalid snapshot request') {
  return {
    ok: false,
    statusCode: 400,
    code: 'invalid_request',
    message,
  } as const;
}

function notFound() {
  return {
    ok: false,
    statusCode: 404,
    code: 'not_found',
    message: 'Not found',
  } as const;
}

function stateConflict() {
  return {
    ok: false,
    statusCode: 409,
    code: 'snapshot_state_conflict',
    message: 'Snapshot state conflict',
  } as const;
}

function storageFailure() {
  return {
    ok: false,
    statusCode: 502,
    code: 'snapshot_storage_failed',
    message: 'Snapshot storage failed',
  } as const;
}

function downloadFailure() {
  return {
    ok: false,
    statusCode: 502,
    code: 'snapshot_download_failed',
    message: 'Snapshot download failed',
  } as const;
}

function captureFailure(error: KnowledgeSnapshotCaptureError) {
  const statusCode = (() => {
    switch (error.code) {
      case 'snapshot_content_too_large':
        return 413;
      case 'snapshot_content_type_unsupported':
        return 415;
      case 'snapshot_capture_timeout':
        return 504;
      case 'snapshot_capture_failed':
        return 502;
      case 'snapshot_content_invalid':
        return 400;
    }
  })();
  return {
    ok: false,
    statusCode,
    code: error.code,
    message: 'Snapshot capture failed',
  } as const;
}

const captureFailureCodes = new Set<KnowledgeSnapshotCaptureError['code']>([
  'snapshot_capture_failed',
  'snapshot_capture_timeout',
  'snapshot_content_invalid',
  'snapshot_content_too_large',
  'snapshot_content_type_unsupported',
]);

function replayResult(snapshot: KnowledgeSnapshot) {
  if (snapshot.status === 'ready') {
    return {
      ok: true,
      value: { replayed: true, snapshot },
    } as const;
  }
  if (snapshot.status === 'failed') {
    if (snapshot.failureCode === 'snapshot_storage_failed') {
      return storageFailure();
    }
    const code = captureFailureCodes.has(
      snapshot.failureCode as KnowledgeSnapshotCaptureError['code'],
    )
      ? (snapshot.failureCode as KnowledgeSnapshotCaptureError['code'])
      : 'snapshot_capture_failed';
    return captureFailure(new KnowledgeSnapshotCaptureError(code));
  }
  if (snapshot.contentType && snapshot.sha256 && snapshot.sizeBytes !== null) {
    return {
      ok: false,
      statusCode: 502,
      code: 'snapshot_storage_pending',
      message: 'Snapshot storage result requires reconciliation',
    } as const;
  }
  return stateConflict();
}

function auditActor(
  actor: KnowledgeActor,
  context: KnowledgeAuditActorContext,
) {
  return {
    userId: actor.userId,
    requestId: context.requestId,
    source: context.source,
  };
}

function requestKeyHash(actor: KnowledgeActor, itemId: string, value: string) {
  return hash([
    'knowledge-snapshot-request:v1',
    actor.userId,
    itemId,
    value.trim(),
  ]);
}

function artifactNamespace(
  actor: KnowledgeActor,
  itemId: string,
  value: string,
) {
  return hash([
    'knowledge-snapshot-artifact:v1',
    actor.userId,
    itemId,
    value.trim(),
  ]);
}

function prepareCapture(
  input: CaptureKnowledgeSnapshotInput,
  dependencies: KnowledgeSnapshotServiceDependencies,
): PreparedCapture | null {
  const allowedInputKeys = new Set([
    'actor',
    'auditActor',
    'itemId',
    'requestKey',
    'captureMethod',
    'originalName',
    'text',
    'url',
    'upload',
  ]);
  if (Object.keys(input).some((key) => !allowedInputKeys.has(key))) {
    return null;
  }
  if (!knowledgeSnapshotCaptureMethods.includes(input.captureMethod)) {
    return null;
  }
  const originalName = normalizeKnowledgeSnapshotOriginalName(
    input.originalName ??
      input.upload?.originalName ??
      defaultOriginalName(input.captureMethod),
    defaultOriginalName(input.captureMethod),
  );
  if (input.captureMethod === 'text') {
    if (
      typeof input.text !== 'string' ||
      input.url !== undefined ||
      input.upload !== undefined
    ) {
      return null;
    }
    const materialized = materializeKnowledgeText({
      text: input.text,
      originalName,
    });
    return {
      captureMethod: 'text',
      originalName: materialized.originalName,
      sourceUrl: null,
      requestPayloadHash: hash([
        'knowledge-snapshot-payload:v1',
        'text',
        materialized.originalName,
        materialized.contentType,
        materialized.body,
      ]),
      load: async () => materialized,
    };
  }
  if (input.captureMethod === 'upload') {
    if (
      !input.upload ||
      input.text !== undefined ||
      input.url !== undefined ||
      !Buffer.isBuffer(input.upload.body)
    ) {
      return null;
    }
    const materialized = materializeKnowledgeUpload({
      ...input.upload,
      originalName,
    });
    return {
      captureMethod: 'upload',
      originalName: materialized.originalName,
      sourceUrl: null,
      requestPayloadHash: hash([
        'knowledge-snapshot-payload:v1',
        'upload',
        materialized.originalName,
        materialized.contentType,
        materialized.body,
      ]),
      load: async () => materialized,
    };
  }
  if (
    typeof input.url !== 'string' ||
    input.text !== undefined ||
    input.upload !== undefined
  ) {
    return null;
  }
  try {
    const normalized = normalizeKnowledgeSnapshotSourceUrl(input.url);
    return {
      captureMethod: 'url',
      originalName,
      sourceUrl: normalized,
      requestPayloadHash: hash([
        'knowledge-snapshot-payload:v1',
        'url',
        originalName,
        normalized,
      ]),
      load: () =>
        (dependencies.materializeUrl ?? materializeKnowledgeUrl)({
          url: input.url as string,
          originalName,
        }),
    };
  } catch {
    return null;
  }
}

function safeFailureCode(error: KnowledgeSnapshotCaptureError) {
  return error.code;
}

export function createKnowledgeSnapshotService(
  dependencies: KnowledgeSnapshotServiceDependencies,
) {
  const now = dependencies.now ?? (() => new Date());
  const randomId = dependencies.randomId ?? randomUUID;

  const markSnapshotFailedInTransaction = async (
    transaction: KnowledgeSnapshotTransaction,
    input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      failureCode: string;
      snapshot: KnowledgeSnapshot;
    },
  ) => {
    const failed = await transaction.snapshots.markFailed({
      snapshotId: input.snapshot.id,
      failedAt: now(),
      failureCode: input.failureCode,
    });
    if (!failed) return null;
    await transaction.audit.write({
      action: 'knowledge_snapshot_capture_failed',
      actor: auditActor(input.actor, input.auditActor),
      targetId: failed.id,
      metadata: {
        itemId: failed.knowledgeItemId,
        version: failed.version,
        status: failed.status,
        captureMethod: failed.captureMethod,
        failureCode: failed.failureCode ?? undefined,
      },
    });
    return failed;
  };

  const markSnapshotFailed = async (input: {
    actor: KnowledgeActor;
    auditActor: KnowledgeAuditActorContext;
    failureCode: string;
    snapshot: KnowledgeSnapshot;
  }) =>
    dependencies.unitOfWork.run((transaction) =>
      markSnapshotFailedInTransaction(transaction, input),
    );

  return {
    async capture(input: CaptureKnowledgeSnapshotInput): Promise<
      KnowledgeSnapshotApplicationResult<{
        replayed: boolean;
        snapshot: KnowledgeSnapshot;
      }>
    > {
      if (
        !hasPrincipal(input.actor) ||
        !isBoundedString(input.itemId, knowledgeSnapshotLimits.itemId) ||
        !isBoundedString(input.requestKey, knowledgeSnapshotLimits.requestKey)
      ) {
        return invalid();
      }
      let prepared: PreparedCapture | null;
      try {
        prepared = prepareCapture(input, dependencies);
      } catch (error) {
        if (error instanceof KnowledgeSnapshotCaptureError) {
          return captureFailure(error);
        }
        return invalid();
      }
      if (!prepared) return invalid();

      const keyHash = requestKeyHash(
        input.actor,
        input.itemId,
        input.requestKey,
      );
      let intent:
        | { replayed: true; snapshot: KnowledgeSnapshot }
        | { replayed: false; snapshot: KnowledgeSnapshot };
      try {
        const created = await dependencies.unitOfWork.run(
          async (transaction) => {
            const owned = await transaction.snapshots.findOwnedItem({
              actor: input.actor,
              itemId: input.itemId,
            });
            if (!owned) return { kind: 'not_found' } as const;
            const existing = await transaction.snapshots.findByRequestKey({
              itemId: input.itemId,
              requestKeyHash: keyHash,
            });
            if (existing) {
              return existing.requestPayloadHash === prepared.requestPayloadHash
                ? ({ kind: 'existing', snapshot: existing } as const)
                : ({ kind: 'idempotency_conflict' } as const);
            }
            const version = await transaction.snapshots.nextVersion(
              input.itemId,
            );
            const snapshot = await transaction.snapshots.createIntent({
              id: randomId(),
              knowledgeItemId: input.itemId,
              version,
              captureMethod: prepared.captureMethod,
              sourceUrl: prepared.sourceUrl,
              originalName: prepared.originalName,
              requestKeyHash: keyHash,
              requestPayloadHash: prepared.requestPayloadHash,
              capturedAt: now(),
              capturedBy: input.actor.userId,
            });
            await transaction.audit.write({
              action: 'knowledge_snapshot_capture_requested',
              actor: auditActor(input.actor, input.auditActor),
              targetId: snapshot.id,
              metadata: {
                itemId: snapshot.knowledgeItemId,
                version: snapshot.version,
                status: snapshot.status,
                captureMethod: snapshot.captureMethod,
              },
            });
            return { kind: 'created', snapshot } as const;
          },
        );
        if (created.kind === 'not_found') return notFound();
        if (created.kind === 'idempotency_conflict') {
          return {
            ok: false,
            statusCode: 409,
            code: 'idempotency_conflict',
            message: 'Snapshot request key conflict',
          };
        }
        intent = {
          replayed: created.kind === 'existing',
          snapshot: created.snapshot,
        };
      } catch (error) {
        if (error instanceof KnowledgeSnapshotTransactionConflictError) {
          return stateConflict();
        }
        throw error;
      }

      if (intent.replayed) {
        return replayResult(intent.snapshot);
      }

      let materialized: MaterializedKnowledgeSnapshot;
      try {
        materialized = await prepared.load();
      } catch (error) {
        const captureError =
          error instanceof KnowledgeSnapshotCaptureError
            ? error
            : new KnowledgeSnapshotCaptureError('snapshot_capture_failed');
        await markSnapshotFailed({
          actor: input.actor,
          auditActor: input.auditActor,
          failureCode: safeFailureCode(captureError),
          snapshot: intent.snapshot,
        }).catch(() => undefined);
        return captureFailure(captureError);
      }

      const sha256 = createHash('sha256')
        .update(materialized.body)
        .digest('hex');
      const sizeBytes = materialized.body.length;
      let recordedOutcome:
        | { kind: 'not_found' }
        | { kind: 'recorded'; snapshot: KnowledgeSnapshot | null };
      try {
        recordedOutcome = await dependencies.unitOfWork.run(
          async (transaction) => {
            const authorized = await transaction.snapshots.findOwnedSnapshot({
              actor: input.actor,
              itemId: input.itemId,
              snapshotId: intent.snapshot.id,
            });
            if (!authorized) {
              await markSnapshotFailedInTransaction(transaction, {
                actor: input.actor,
                auditActor: input.auditActor,
                failureCode: 'snapshot_capture_failed',
                snapshot: intent.snapshot,
              });
              return { kind: 'not_found' } as const;
            }
            const snapshot = await transaction.snapshots.recordMaterialized({
              snapshotId: intent.snapshot.id,
              contentType: materialized.contentType,
              extractedText: materialized.extractedText,
              sha256,
              sizeBytes,
            });
            return { kind: 'recorded', snapshot } as const;
          },
        );
      } catch {
        const captureError = new KnowledgeSnapshotCaptureError(
          'snapshot_capture_failed',
        );
        await markSnapshotFailed({
          actor: input.actor,
          auditActor: input.auditActor,
          failureCode: safeFailureCode(captureError),
          snapshot: intent.snapshot,
        }).catch(() => undefined);
        return captureFailure(captureError);
      }
      if (recordedOutcome.kind === 'not_found') return notFound();
      const recorded = recordedOutcome.snapshot;
      if (!recorded) return stateConflict();
      if (
        !recorded.contentType ||
        recorded.contentType !== materialized.contentType ||
        recorded.sha256 !== sha256 ||
        recorded.sizeBytes !== sizeBytes
      ) {
        return stateConflict();
      }
      const recordedContentType = recorded.contentType;

      let artifact: Awaited<ReturnType<KnowledgeArtifactPort['store']>>;
      try {
        artifact = await dependencies.artifacts.store({
          body: materialized.body,
          contentType: materialized.contentType,
          createdBy: input.actor.userId,
          idempotencyNamespace: artifactNamespace(
            input.actor,
            input.itemId,
            input.requestKey,
          ),
          originalName: recorded.originalName,
          sha256,
          sizeBytes,
          snapshotId: recorded.id,
        });
      } catch (error) {
        if (
          error instanceof KnowledgeArtifactStoreError &&
          error.outcome === 'failed'
        ) {
          const failed = await markSnapshotFailed({
            actor: input.actor,
            auditActor: input.auditActor,
            failureCode: 'snapshot_storage_failed',
            snapshot: intent.snapshot,
          }).catch(() => null);
          if (failed) return storageFailure();
        }
        return {
          ok: false,
          statusCode: 502,
          code: 'snapshot_storage_pending',
          message: 'Snapshot storage result requires reconciliation',
        };
      }
      if (
        artifact.contentType !== recorded.contentType ||
        artifact.sha256 !== sha256 ||
        artifact.sizeBytes !== sizeBytes
      ) {
        return {
          ok: false,
          statusCode: 502,
          code: 'snapshot_storage_pending',
          message: 'Snapshot storage result requires reconciliation',
        };
      }

      try {
        const finalization = await dependencies.unitOfWork.run(
          async (transaction) => {
            const authorized = await transaction.snapshots.findOwnedSnapshot({
              actor: input.actor,
              itemId: input.itemId,
              snapshotId: recorded.id,
            });
            if (!authorized) return { kind: 'not_found' } as const;
            if (
              authorized.status === 'ready' &&
              authorized.artifactId === artifact.artifactId &&
              authorized.contentType === recordedContentType &&
              authorized.sha256 === sha256 &&
              authorized.sizeBytes === sizeBytes
            ) {
              return { kind: 'ready', snapshot: authorized } as const;
            }
            const finalized = await transaction.snapshots.markReady({
              snapshotId: intent.snapshot.id,
              artifactId: artifact.artifactId,
              contentType: recordedContentType,
              sha256,
              sizeBytes,
              readyAt: now(),
            });
            if (!finalized) {
              const current = await transaction.snapshots.findOwnedSnapshot({
                actor: input.actor,
                itemId: input.itemId,
                snapshotId: recorded.id,
              });
              return current?.status === 'ready' &&
                current.artifactId === artifact.artifactId &&
                current.contentType === recordedContentType &&
                current.sha256 === sha256 &&
                current.sizeBytes === sizeBytes
                ? ({ kind: 'ready', snapshot: current } as const)
                : ({ kind: 'pending' } as const);
            }
            await transaction.audit.write({
              action: 'knowledge_snapshot_capture_ready',
              actor: auditActor(input.actor, input.auditActor),
              targetId: finalized.id,
              metadata: {
                itemId: finalized.knowledgeItemId,
                version: finalized.version,
                status: finalized.status,
                captureMethod: finalized.captureMethod,
                contentType: finalized.contentType ?? undefined,
                sha256: finalized.sha256 ?? undefined,
                sizeBytes: finalized.sizeBytes ?? undefined,
              },
            });
            return { kind: 'ready', snapshot: finalized } as const;
          },
        );
        if (finalization.kind === 'not_found') return notFound();
        if (finalization.kind === 'pending') {
          return {
            ok: false,
            statusCode: 502,
            code: 'snapshot_storage_pending',
            message: 'Snapshot finalization requires reconciliation',
          };
        }
        return {
          ok: true,
          value: { replayed: false, snapshot: finalization.snapshot },
        };
      } catch {
        return {
          ok: false,
          statusCode: 502,
          code: 'snapshot_storage_pending',
          message: 'Snapshot finalization requires reconciliation',
        };
      }
    },

    async list(input: {
      actor: KnowledgeActor;
      itemId: string;
      limit: number;
    }): Promise<
      KnowledgeSnapshotApplicationResult<{ items: KnowledgeSnapshot[] }>
    > {
      if (
        !hasPrincipal(input.actor) ||
        !isBoundedString(input.itemId, knowledgeSnapshotLimits.itemId) ||
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > knowledgeSnapshotLimits.listLimit
      ) {
        return invalid();
      }
      const items = await dependencies.reader.listVisible(input);
      return items ? { ok: true, value: { items } } : notFound();
    },

    async detail(input: {
      actor: KnowledgeActor;
      itemId: string;
      snapshotId: string;
    }): Promise<KnowledgeSnapshotApplicationResult<KnowledgeSnapshot>> {
      if (
        !hasPrincipal(input.actor) ||
        !isBoundedString(input.itemId, knowledgeSnapshotLimits.itemId) ||
        !isBoundedString(input.snapshotId, knowledgeSnapshotLimits.snapshotId)
      ) {
        return invalid();
      }
      const snapshot = await dependencies.reader.findVisibleById(input);
      return snapshot ? { ok: true, value: snapshot } : notFound();
    },

    async reconcile(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      itemId: string;
      requestKey: string;
      snapshotId: string;
    }): Promise<KnowledgeSnapshotApplicationResult<KnowledgeSnapshot>> {
      if (
        !hasPrincipal(input.actor) ||
        !isBoundedString(input.itemId, knowledgeSnapshotLimits.itemId) ||
        !isBoundedString(
          input.snapshotId,
          knowledgeSnapshotLimits.snapshotId,
        ) ||
        !isBoundedString(input.requestKey, knowledgeSnapshotLimits.requestKey)
      ) {
        return invalid();
      }
      const pending = await dependencies.unitOfWork.run((transaction) =>
        transaction.snapshots.findOwnedSnapshot({
          actor: input.actor,
          itemId: input.itemId,
          snapshotId: input.snapshotId,
        }),
      );
      if (!pending) return notFound();
      if (pending.status === 'ready') {
        return { ok: true, value: pending };
      }
      if (
        pending.status !== 'pending' ||
        !pending.contentType ||
        !pending.sha256 ||
        pending.sizeBytes === null ||
        pending.requestKeyHash !==
          requestKeyHash(input.actor, input.itemId, input.requestKey)
      ) {
        return stateConflict();
      }
      const pendingContentType = pending.contentType;
      const pendingSha256 = pending.sha256;
      const pendingSizeBytes = pending.sizeBytes;

      const authorized = await dependencies.unitOfWork.run((transaction) =>
        transaction.snapshots.findOwnedSnapshot({
          actor: input.actor,
          itemId: input.itemId,
          snapshotId: input.snapshotId,
        }),
      );
      if (!authorized) return notFound();
      if (
        authorized.status !== 'pending' ||
        authorized.contentType !== pendingContentType ||
        authorized.sha256 !== pendingSha256 ||
        authorized.sizeBytes !== pendingSizeBytes ||
        authorized.originalName !== pending.originalName ||
        authorized.requestKeyHash !== pending.requestKeyHash
      ) {
        return stateConflict();
      }

      let artifact: Awaited<ReturnType<KnowledgeArtifactPort['reconcile']>>;
      try {
        artifact = await dependencies.artifacts.reconcile({
          contentType: pendingContentType,
          idempotencyNamespace: artifactNamespace(
            input.actor,
            input.itemId,
            input.requestKey,
          ),
          originalName: pending.originalName,
          sha256: pendingSha256,
          sizeBytes: pendingSizeBytes,
          snapshotId: pending.id,
        });
      } catch {
        return {
          ok: false,
          statusCode: 502,
          code: 'snapshot_reconciliation_failed',
          message: 'Snapshot reconciliation failed',
        };
      }
      if (!artifact) {
        return {
          ok: false,
          statusCode: 409,
          code: 'snapshot_reconciliation_pending',
          message: 'No verified artifact is available',
        };
      }
      if (
        artifact.contentType !== pendingContentType ||
        artifact.sha256 !== pendingSha256 ||
        artifact.sizeBytes !== pendingSizeBytes
      ) {
        return {
          ok: false,
          statusCode: 502,
          code: 'snapshot_reconciliation_failed',
          message: 'Snapshot reconciliation failed',
        };
      }
      const outcome = await dependencies.unitOfWork.run(async (transaction) => {
        const current = await transaction.snapshots.findOwnedSnapshot({
          actor: input.actor,
          itemId: input.itemId,
          snapshotId: input.snapshotId,
        });
        if (!current) return { kind: 'not_found' } as const;
        if (current.status === 'ready') {
          return { kind: 'ready', snapshot: current } as const;
        }
        const finalized = await transaction.snapshots.markReady({
          snapshotId: current.id,
          artifactId: artifact.artifactId,
          contentType: pendingContentType,
          sha256: pendingSha256,
          sizeBytes: pendingSizeBytes,
          readyAt: now(),
        });
        if (!finalized) return { kind: 'conflict' } as const;
        await transaction.audit.write({
          action: 'knowledge_snapshot_reconciled',
          actor: auditActor(input.actor, input.auditActor),
          targetId: finalized.id,
          metadata: {
            itemId: finalized.knowledgeItemId,
            version: finalized.version,
            status: finalized.status,
            captureMethod: finalized.captureMethod,
            contentType: finalized.contentType ?? undefined,
            sha256: finalized.sha256 ?? undefined,
            sizeBytes: finalized.sizeBytes ?? undefined,
          },
        });
        return { kind: 'ready', snapshot: finalized } as const;
      });
      if (outcome.kind === 'not_found') return notFound();
      if (outcome.kind === 'conflict') return stateConflict();
      return { ok: true, value: outcome.snapshot };
    },

    async openDownload(input: {
      actor: KnowledgeActor;
      auditActor: KnowledgeAuditActorContext;
      itemId: string;
      snapshotId: string;
    }): Promise<
      KnowledgeSnapshotApplicationResult<{
        opened: OpenedKnowledgeArtifact;
        snapshot: KnowledgeSnapshot;
      }>
    > {
      if (
        !hasPrincipal(input.actor) ||
        !isBoundedString(input.itemId, knowledgeSnapshotLimits.itemId) ||
        !isBoundedString(input.snapshotId, knowledgeSnapshotLimits.snapshotId)
      ) {
        return invalid();
      }
      const visible = await dependencies.reader.findVisibleById(input);
      if (!visible) return notFound();
      if (
        visible.status !== 'ready' ||
        !visible.artifactId ||
        !visible.contentType ||
        !visible.sha256 ||
        visible.sizeBytes === null
      ) {
        return stateConflict();
      }
      const authorizedBeforeOpen = await dependencies.unitOfWork.run(
        (transaction) =>
          transaction.snapshots.findVisibleById({
            actor: input.actor,
            itemId: input.itemId,
            snapshotId: input.snapshotId,
          }),
      );
      if (
        !authorizedBeforeOpen ||
        authorizedBeforeOpen.status !== 'ready' ||
        authorizedBeforeOpen.artifactId !== visible.artifactId ||
        authorizedBeforeOpen.contentType !== visible.contentType ||
        authorizedBeforeOpen.sha256 !== visible.sha256 ||
        authorizedBeforeOpen.sizeBytes !== visible.sizeBytes
      ) {
        return notFound();
      }
      let opened: OpenedKnowledgeArtifact;
      try {
        opened = await dependencies.artifacts.open({
          artifactId: visible.artifactId,
          snapshotId: visible.id,
        });
      } catch (error) {
        return error instanceof KnowledgeArtifactOpenError &&
          error.kind === 'not_found'
          ? notFound()
          : downloadFailure();
      }
      if (
        opened.artifact.artifactId !== visible.artifactId ||
        opened.artifact.contentType !== visible.contentType ||
        opened.artifact.sha256 !== visible.sha256 ||
        opened.artifact.sizeBytes !== visible.sizeBytes
      ) {
        opened.stream.destroy();
        return downloadFailure();
      }
      try {
        const authorized = await dependencies.unitOfWork.run(
          async (transaction) => {
            const current = await transaction.snapshots.findVisibleById({
              actor: input.actor,
              itemId: input.itemId,
              snapshotId: input.snapshotId,
            });
            if (
              !current ||
              current.status !== 'ready' ||
              current.artifactId !== opened.artifact.artifactId ||
              current.contentType !== opened.artifact.contentType ||
              current.sha256 !== opened.artifact.sha256 ||
              current.sizeBytes !== opened.artifact.sizeBytes
            ) {
              return null;
            }
            await transaction.audit.write({
              action: 'knowledge_snapshot_downloaded',
              actor: auditActor(input.actor, input.auditActor),
              targetId: current.id,
              metadata: {
                itemId: current.knowledgeItemId,
                version: current.version,
                status: current.status,
                captureMethod: current.captureMethod,
                contentType: current.contentType ?? undefined,
                sha256: current.sha256 ?? undefined,
                sizeBytes: current.sizeBytes ?? undefined,
              },
            });
            return current;
          },
        );
        if (!authorized) {
          opened.stream.destroy();
          return notFound();
        }
        return {
          ok: true,
          value: { opened, snapshot: authorized },
        };
      } catch (error) {
        opened.stream.destroy();
        throw error;
      }
    },
  };
}

export type KnowledgeSnapshotService = ReturnType<
  typeof createKnowledgeSnapshotService
>;
