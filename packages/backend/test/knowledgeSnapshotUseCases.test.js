import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { KnowledgeSnapshotCaptureError } from '../dist/application/knowledge/knowledgeSnapshotCapture.js';
import {
  KnowledgeArtifactOpenError,
  KnowledgeArtifactStoreError,
} from '../dist/application/knowledge/knowledgeArtifactPort.js';
import { createKnowledgeSnapshotService } from '../dist/application/knowledge/knowledgeSnapshotUseCases.js';

const fixedNow = new Date('2026-08-05T07:00:00.000Z');
const owner = {
  userId: 'owner-1',
  organizationId: 'org-1',
  groupAccountIds: ['group-1'],
};
const outsider = {
  userId: 'outsider-1',
  organizationId: 'org-1',
  groupAccountIds: ['group-1'],
};

function auditContext(requestId = 'request-1') {
  return { requestId, source: 'api' };
}

function textCapture(overrides = {}) {
  return {
    actor: owner,
    auditActor: auditContext(),
    itemId: 'item-1',
    requestKey: 'request-key-1',
    captureMethod: 'text',
    text: 'Snapshot body',
    ...overrides,
  };
}

function clone(value) {
  return structuredClone(value);
}

function createHarness(options = {}) {
  const events = [];
  const audits = [];
  const snapshots = new Map();
  const artifactStoreInputs = [];
  const reconcileInputs = [];
  const openInputs = [];
  const openedStreams = [];
  const artifacts = new Map();
  const behavior = {
    ownerUserId: 'owner-1',
    storeError: null,
    reconcileError: null,
    reconcileResult: null,
    openError: null,
    concurrentReadyOnFinalize: false,
    visible: ({ actor: requestActor }) =>
      requestActor.userId === behavior.ownerUserId,
    owned: ({ actor: requestActor }) =>
      requestActor.userId === behavior.ownerUserId,
    ...options.behavior,
  };
  let snapshotSequence = 0;
  let artifactSequence = 0;

  const repository = {
    findVisibleById: async (input) => {
      events.push('snapshot:find-visible');
      const snapshot = snapshots.get(input.snapshotId);
      if (
        !snapshot ||
        snapshot.knowledgeItemId !== input.itemId ||
        !behavior.visible(input)
      ) {
        return null;
      }
      return clone(snapshot);
    },
    listVisible: async ({ actor: requestActor, itemId, limit }) => {
      events.push('snapshot:list-visible');
      if (!behavior.visible({ actor: requestActor, itemId })) return null;
      return [...snapshots.values()]
        .filter((snapshot) => snapshot.knowledgeItemId === itemId)
        .slice(0, limit)
        .map(clone);
    },
    findByRequestKey: async ({ itemId, requestKeyHash }) => {
      events.push('snapshot:find-request');
      const found = [...snapshots.values()].find(
        (snapshot) =>
          snapshot.knowledgeItemId === itemId &&
          snapshot.requestKeyHash === requestKeyHash,
      );
      return found ? clone(found) : null;
    },
    findOwnedItem: async ({ actor: requestActor, itemId }) => {
      events.push('item:find-owned');
      return itemId === 'item-1' &&
        behavior.owned({ actor: requestActor, itemId })
        ? { id: itemId, ownerUserId: behavior.ownerUserId }
        : null;
    },
    findOwnedSnapshot: async ({ actor: requestActor, itemId, snapshotId }) => {
      events.push('snapshot:find-owned');
      const snapshot = snapshots.get(snapshotId);
      return snapshot &&
        snapshot.knowledgeItemId === itemId &&
        behavior.owned({ actor: requestActor, itemId, snapshotId })
        ? clone(snapshot)
        : null;
    },
    nextVersion: async (itemId) => {
      events.push('snapshot:next-version');
      return (
        Math.max(
          0,
          ...[...snapshots.values()]
            .filter((snapshot) => snapshot.knowledgeItemId === itemId)
            .map((snapshot) => snapshot.version),
        ) + 1
      );
    },
    createIntent: async (input) => {
      events.push('intent:create');
      snapshotSequence += 1;
      const snapshot = {
        id: input.id || `snapshot-${snapshotSequence}`,
        knowledgeItemId: input.knowledgeItemId,
        artifactId: null,
        version: input.version,
        status: 'pending',
        captureMethod: input.captureMethod,
        sourceUrl: input.sourceUrl,
        originalName: input.originalName,
        contentType: null,
        sizeBytes: null,
        sha256: null,
        extractedText: null,
        requestKeyHash: input.requestKeyHash,
        requestPayloadHash: input.requestPayloadHash,
        failureCode: null,
        capturedAt: input.capturedAt,
        capturedBy: input.capturedBy,
        readyAt: null,
        failedAt: null,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      };
      snapshots.set(snapshot.id, snapshot);
      return clone(snapshot);
    },
    recordMaterialized: async (input) => {
      events.push('materialized:record');
      const current = snapshots.get(input.snapshotId);
      if (!current || current.status !== 'pending') return null;
      const updated = {
        ...current,
        contentType: input.contentType,
        extractedText: input.extractedText,
        sha256: input.sha256,
        sizeBytes: input.sizeBytes,
        updatedAt: fixedNow,
      };
      snapshots.set(updated.id, updated);
      return clone(updated);
    },
    markReady: async (input) => {
      events.push('snapshot:finalize');
      const current = snapshots.get(input.snapshotId);
      if (
        !current ||
        current.status !== 'pending' ||
        current.sha256 !== input.sha256 ||
        current.sizeBytes !== input.sizeBytes
      ) {
        return null;
      }
      const updated = {
        ...current,
        artifactId: input.artifactId,
        status: 'ready',
        readyAt: input.readyAt,
        updatedAt: fixedNow,
      };
      snapshots.set(updated.id, updated);
      if (behavior.concurrentReadyOnFinalize) return null;
      return clone(updated);
    },
    markFailed: async (input) => {
      events.push('snapshot:fail');
      const current = snapshots.get(input.snapshotId);
      if (!current || current.status !== 'pending') return null;
      const updated = {
        ...current,
        status: 'failed',
        failureCode: input.failureCode,
        failedAt: input.failedAt,
        updatedAt: fixedNow,
      };
      snapshots.set(updated.id, updated);
      return clone(updated);
    },
  };

  const unitOfWork = {
    run: async (work) =>
      work({
        snapshots: repository,
        audit: {
          write: async (entry) => {
            events.push(`audit:${entry.action}`);
            audits.push(clone(entry));
          },
        },
      }),
  };

  const artifactPort = {
    store: async (input) => {
      events.push('artifact:store');
      artifactStoreInputs.push(clone(input));
      if (behavior.storeError) throw behavior.storeError;
      artifactSequence += 1;
      const artifact = {
        artifactId: `artifact-${artifactSequence}`,
        contentType: input.contentType,
        createdAt: fixedNow.toISOString(),
        originalName: input.originalName,
        provider: 'local',
        sha256: input.sha256,
        sizeBytes: input.sizeBytes,
      };
      artifacts.set(artifact.artifactId, artifact);
      return clone(artifact);
    },
    reconcile: async (input) => {
      events.push('artifact:reconcile');
      reconcileInputs.push(clone(input));
      if (behavior.reconcileError) throw behavior.reconcileError;
      return behavior.reconcileResult ? clone(behavior.reconcileResult) : null;
    },
    open: async (input) => {
      events.push('artifact:open');
      openInputs.push(clone(input));
      if (behavior.openError) throw behavior.openError;
      const artifact = artifacts.get(input.artifactId);
      if (!artifact) throw new Error('artifact not found');
      const stream = Readable.from(Buffer.from('Snapshot body', 'utf8'));
      openedStreams.push(stream);
      return {
        artifact: clone(artifact),
        stream,
      };
    },
  };

  const materializeUrl =
    options.materializeUrl ??
    (async ({ url, originalName }) => {
      events.push('capture:materialize');
      const body = Buffer.from('Captured URL body', 'utf8');
      return {
        body,
        contentType: 'text/plain',
        extractedText: body.toString('utf8'),
        originalName,
        sourceUrl: url,
      };
    });

  const service = createKnowledgeSnapshotService({
    artifacts: artifactPort,
    reader: repository,
    unitOfWork,
    materializeUrl,
    now: () => fixedNow,
    randomId: () => `snapshot-${snapshotSequence + 1}`,
  });

  return {
    artifactStoreInputs,
    artifacts,
    audits,
    behavior,
    events,
    openInputs,
    openedStreams,
    reconcileInputs,
    service,
    snapshots,
  };
}

function assertFailure(result, statusCode, code) {
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, statusCode);
  assert.equal(result.code, code);
}

test('same request key and payload replays without repeated capture or storage, while a changed payload conflicts', async () => {
  const harness = createHarness();
  const first = await harness.service.capture(textCapture());
  assert.equal(first.ok, true);
  assert.equal(first.value.replayed, false);
  assert.equal(first.value.snapshot.status, 'ready');

  const eventCount = harness.events.length;
  const storeCount = harness.artifactStoreInputs.length;
  const replay = await harness.service.capture(textCapture());

  assert.equal(replay.ok, true);
  assert.equal(replay.value.replayed, true);
  assert.equal(replay.value.snapshot.id, first.value.snapshot.id);
  assert.equal(harness.artifactStoreInputs.length, storeCount);
  assert.deepEqual(harness.events.slice(eventCount), [
    'item:find-owned',
    'snapshot:find-request',
  ]);

  const conflict = await harness.service.capture(
    textCapture({ text: 'Different body' }),
  );
  assertFailure(conflict, 409, 'idempotency_conflict');
  assert.equal(harness.snapshots.size, 1);
  assert.equal(harness.artifactStoreInputs.length, storeCount);
});

test('capture and reconciliation require item ownership and do not disclose owner data', async () => {
  let materializeCalls = 0;
  const harness = createHarness({
    materializeUrl: async () => {
      materializeCalls += 1;
      assert.fail('an unauthorized URL must not be fetched');
    },
  });
  const deniedCapture = await harness.service.capture({
    actor: outsider,
    auditActor: auditContext('outsider-request'),
    itemId: 'item-1',
    requestKey: 'outsider-key',
    captureMethod: 'url',
    url: 'https://example.com/private-source',
  });
  assertFailure(deniedCapture, 404, 'not_found');
  assert.equal(materializeCalls, 0);
  assert.equal(harness.snapshots.size, 0);

  harness.behavior.storeError = new Error('storage result unknown');
  const ownerCapture = await harness.service.capture(textCapture());
  assertFailure(ownerCapture, 502, 'snapshot_storage_pending');
  const snapshotId = [...harness.snapshots.keys()][0];

  const deniedReconcile = await harness.service.reconcile({
    actor: outsider,
    auditActor: auditContext('outsider-reconcile'),
    itemId: 'item-1',
    snapshotId,
    requestKey: 'request-key-1',
  });
  assertFailure(deniedReconcile, 404, 'not_found');
  assert.equal(harness.reconcileInputs.length, 0);

  const deniedDetail = await harness.service.detail({
    actor: outsider,
    itemId: 'item-1',
    snapshotId,
  });
  assertFailure(deniedDetail, 404, 'not_found');
});

test('capture rechecks owner access before artifact storage', async () => {
  let ownerChecks = 0;
  const harness = createHarness({
    behavior: {
      owned: () => {
        ownerChecks += 1;
        return ownerChecks === 1;
      },
    },
  });

  const result = await harness.service.capture(textCapture());

  assertFailure(result, 404, 'not_found');
  assert.equal(ownerChecks, 2);
  assert.equal(harness.artifactStoreInputs.length, 0);
  const snapshot = [...harness.snapshots.values()][0];
  assert.equal(snapshot.status, 'failed');
  assert.equal(snapshot.failureCode, 'snapshot_capture_failed');
  assert.equal(snapshot.artifactId, null);
  assert.deepEqual(
    harness.audits.map((entry) => entry.action),
    [
      'knowledge_snapshot_capture_requested',
      'knowledge_snapshot_capture_failed',
    ],
  );
});

test('capture remains pending without deleting the artifact when owner access changes during storage', async () => {
  let ownerChecks = 0;
  const harness = createHarness({
    behavior: {
      owned: () => {
        ownerChecks += 1;
        return ownerChecks <= 2;
      },
    },
  });

  const result = await harness.service.capture(textCapture());

  assertFailure(result, 404, 'not_found');
  assert.equal(ownerChecks, 3);
  assert.equal(harness.artifactStoreInputs.length, 1);
  const snapshot = [...harness.snapshots.values()][0];
  assert.equal(snapshot.status, 'pending');
  assert.equal(snapshot.artifactId, null);
  assert.equal(snapshot.contentType, 'text/plain');
  assert.match(snapshot.sha256, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.sizeBytes, Buffer.byteLength('Snapshot body'));
  assert.deepEqual(
    harness.audits.map((entry) => entry.action),
    ['knowledge_snapshot_capture_requested'],
  );
});

test('URL capture persists intent before materialization, then stores only after metadata and finalizes last', async () => {
  const harness = createHarness();
  const result = await harness.service.capture({
    actor: owner,
    auditActor: auditContext(),
    itemId: 'item-1',
    requestKey: 'url-request-key',
    captureMethod: 'url',
    originalName: 'source.txt',
    url: 'https://example.com/source?utm_source=test#fragment',
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.snapshot.status, 'ready');
  assert.deepEqual(
    harness.events.filter((event) =>
      [
        'intent:create',
        'capture:materialize',
        'materialized:record',
        'artifact:store',
        'snapshot:finalize',
      ].includes(event),
    ),
    [
      'intent:create',
      'capture:materialize',
      'materialized:record',
      'artifact:store',
      'snapshot:finalize',
    ],
  );
  assert.equal(result.value.snapshot.sourceUrl, 'https://example.com/source');
});

test('capture failure marks the intent failed and writes only sanitized failure metadata', async () => {
  const providerSecret = 'provider-refresh-token-secret';
  const harness = createHarness({
    materializeUrl: async () => {
      const error = new KnowledgeSnapshotCaptureError(
        'snapshot_capture_timeout',
      );
      error.cause = new Error(providerSecret);
      throw error;
    },
  });
  const result = await harness.service.capture({
    actor: owner,
    auditActor: auditContext(),
    itemId: 'item-1',
    requestKey: 'timeout-request',
    captureMethod: 'url',
    url: 'https://example.com/slow',
  });

  assertFailure(result, 504, 'snapshot_capture_timeout');
  const snapshot = [...harness.snapshots.values()][0];
  assert.equal(snapshot.status, 'failed');
  assert.equal(snapshot.failureCode, 'snapshot_capture_timeout');
  assert.deepEqual(
    harness.audits.map((entry) => entry.action),
    [
      'knowledge_snapshot_capture_requested',
      'knowledge_snapshot_capture_failed',
    ],
  );
  assert.doesNotMatch(
    JSON.stringify({ result, audits: harness.audits }),
    /provider-refresh-token-secret/,
  );
  assert.equal(harness.artifactStoreInputs.length, 0);
});

test('failed and pending idempotent replays preserve non-success state contracts', async () => {
  const harness = createHarness({
    materializeUrl: async () => {
      throw new KnowledgeSnapshotCaptureError('snapshot_capture_timeout');
    },
  });
  const request = {
    actor: owner,
    auditActor: auditContext(),
    itemId: 'item-1',
    requestKey: 'replay-state-request',
    captureMethod: 'url',
    url: 'https://example.com/slow',
  };
  assertFailure(
    await harness.service.capture(request),
    504,
    'snapshot_capture_timeout',
  );
  const stored = [...harness.snapshots.values()][0];

  assertFailure(
    await harness.service.capture(request),
    504,
    'snapshot_capture_timeout',
  );

  Object.assign(stored, {
    status: 'pending',
    failureCode: null,
    failedAt: null,
    contentType: null,
    sha256: null,
    sizeBytes: null,
  });
  assertFailure(
    await harness.service.capture(request),
    409,
    'snapshot_state_conflict',
  );

  Object.assign(stored, {
    contentType: 'text/plain',
    sha256: 'a'.repeat(64),
    sizeBytes: 42,
  });
  assertFailure(
    await harness.service.capture(request),
    502,
    'snapshot_storage_pending',
  );
  assert.equal(harness.artifactStoreInputs.length, 0);
});

test('capture returns the concurrently finalized ready snapshot after a CAS loss', async () => {
  const harness = createHarness();
  harness.behavior.concurrentReadyOnFinalize = true;

  const result = await harness.service.capture(textCapture());

  assert.equal(result.ok, true);
  assert.equal(result.value.replayed, false);
  assert.equal(result.value.snapshot.status, 'ready');
  assert.equal(result.value.snapshot.artifactId, 'artifact-1');
  assert.equal(
    harness.audits.filter(
      (entry) => entry.action === 'knowledge_snapshot_capture_ready',
    ).length,
    0,
  );
});

test('unknown storage result stays pending and reconciliation never invokes store', async () => {
  const harness = createHarness();
  harness.behavior.storeError = new Error('ambiguous provider response');
  const capture = await harness.service.capture(textCapture());
  assertFailure(capture, 502, 'snapshot_storage_pending');

  const pending = [...harness.snapshots.values()][0];
  assert.equal(pending.status, 'pending');
  assert.match(pending.sha256, /^[a-f0-9]{64}$/);
  assert.equal(pending.sizeBytes, Buffer.byteLength('Snapshot body'));
  assert.equal(
    harness.audits.some(
      (entry) => entry.action === 'knowledge_snapshot_capture_failed',
    ),
    false,
  );
  const storeCount = harness.artifactStoreInputs.length;
  harness.behavior.storeError = null;
  harness.behavior.reconcileResult = {
    artifactId: 'reconciled-artifact-1',
    contentType: 'text/plain',
    createdAt: fixedNow.toISOString(),
    originalName: pending.originalName,
    provider: 'local',
    sha256: pending.sha256,
    sizeBytes: pending.sizeBytes,
  };

  const reconciled = await harness.service.reconcile({
    actor: owner,
    auditActor: auditContext('reconcile-request'),
    itemId: 'item-1',
    snapshotId: pending.id,
    requestKey: 'request-key-1',
  });

  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.value.status, 'ready');
  assert.equal(reconciled.value.artifactId, 'reconciled-artifact-1');
  assert.equal(harness.artifactStoreInputs.length, storeCount);
  assert.equal(harness.reconcileInputs.length, 1);
  assert.equal(harness.audits.at(-1).action, 'knowledge_snapshot_reconciled');
});

test('deterministic storage failure marks the snapshot failed and replays the sanitized failure', async () => {
  const harness = createHarness();
  harness.behavior.storeError = new KnowledgeArtifactStoreError('failed');
  const request = textCapture({ requestKey: 'deterministic-store-failure' });

  assertFailure(
    await harness.service.capture(request),
    502,
    'snapshot_storage_failed',
  );
  const failed = [...harness.snapshots.values()][0];
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failureCode, 'snapshot_storage_failed');
  assert.match(failed.sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    harness.audits.at(-1).action,
    'knowledge_snapshot_capture_failed',
  );

  assertFailure(
    await harness.service.capture(request),
    502,
    'snapshot_storage_failed',
  );
  assert.equal(harness.artifactStoreInputs.length, 1);
});

test('reconciliation rechecks owner access before provider I/O', async () => {
  const harness = createHarness();
  harness.behavior.storeError = new Error('ambiguous provider response');
  const capture = await harness.service.capture(textCapture());
  assertFailure(capture, 502, 'snapshot_storage_pending');
  const pending = [...harness.snapshots.values()][0];
  let ownerChecks = 0;
  harness.behavior.owned = () => {
    ownerChecks += 1;
    return ownerChecks === 1;
  };

  const result = await harness.service.reconcile({
    actor: owner,
    auditActor: auditContext('revoked-reconcile'),
    itemId: 'item-1',
    snapshotId: pending.id,
    requestKey: 'request-key-1',
  });

  assertFailure(result, 404, 'not_found');
  assert.equal(ownerChecks, 2);
  assert.equal(harness.reconcileInputs.length, 0);
});

test('reconciliation hides the snapshot when owner access changes during provider I/O', async () => {
  const harness = createHarness();
  harness.behavior.storeError = new Error('ambiguous provider response');
  const capture = await harness.service.capture(textCapture());
  assertFailure(capture, 502, 'snapshot_storage_pending');
  const pending = [...harness.snapshots.values()][0];
  harness.behavior.reconcileResult = {
    artifactId: 'reconciled-artifact-1',
    contentType: pending.contentType,
    createdAt: fixedNow.toISOString(),
    originalName: pending.originalName,
    provider: 'local',
    sha256: pending.sha256,
    sizeBytes: pending.sizeBytes,
  };
  let ownerChecks = 0;
  harness.behavior.owned = () => {
    ownerChecks += 1;
    return ownerChecks <= 2;
  };

  const result = await harness.service.reconcile({
    actor: owner,
    auditActor: auditContext('mid-reconcile-revocation'),
    itemId: 'item-1',
    snapshotId: pending.id,
    requestKey: 'request-key-1',
  });

  assertFailure(result, 404, 'not_found');
  assert.equal(ownerChecks, 3);
  assert.equal(harness.reconcileInputs.length, 1);
  assert.equal(
    harness.audits.some(
      (entry) => entry.action === 'knowledge_snapshot_reconciled',
    ),
    false,
  );
});

test('download rechecks current ACL before provider I/O', async () => {
  const harness = createHarness();
  const capture = await harness.service.capture(textCapture());
  assert.equal(capture.ok, true);
  let visibleChecks = 0;
  harness.behavior.visible = ({ actor: requestActor }) => {
    visibleChecks += 1;
    return requestActor.userId === owner.userId && visibleChecks === 1;
  };

  const result = await harness.service.openDownload({
    actor: owner,
    auditActor: auditContext('download-request'),
    itemId: 'item-1',
    snapshotId: capture.value.snapshot.id,
  });

  assertFailure(result, 404, 'not_found');
  assert.equal(visibleChecks, 2);
  assert.equal(harness.openInputs.length, 0);
  assert.equal(harness.openedStreams.length, 0);
  assert.equal(
    harness.audits.some(
      (entry) => entry.action === 'knowledge_snapshot_downloaded',
    ),
    false,
  );
});

test('download destroys staged content when ACL changes during provider I/O', async () => {
  const harness = createHarness();
  const capture = await harness.service.capture(textCapture());
  assert.equal(capture.ok, true);
  let visibleChecks = 0;
  harness.behavior.visible = ({ actor: requestActor }) => {
    visibleChecks += 1;
    return requestActor.userId === owner.userId && visibleChecks <= 2;
  };

  const result = await harness.service.openDownload({
    actor: owner,
    auditActor: auditContext('mid-open-revocation'),
    itemId: 'item-1',
    snapshotId: capture.value.snapshot.id,
  });

  assertFailure(result, 404, 'not_found');
  assert.equal(visibleChecks, 3);
  assert.equal(harness.openInputs.length, 1);
  assert.equal(harness.openedStreams[0].destroyed, true);
  assert.equal(
    harness.audits.some(
      (entry) => entry.action === 'knowledge_snapshot_downloaded',
    ),
    false,
  );
});

test('download distinguishes owner-scoped absence from provider failure after authorization', async (t) => {
  for (const [name, openError, statusCode, code] of [
    [
      'owner scoped absence',
      new KnowledgeArtifactOpenError('not_found'),
      404,
      'not_found',
    ],
    [
      'provider failure',
      new KnowledgeArtifactOpenError('storage_failure'),
      502,
      'snapshot_download_failed',
    ],
    [
      'unexpected adapter failure',
      new Error('provider credential secret'),
      502,
      'snapshot_download_failed',
    ],
  ]) {
    await t.test(name, async () => {
      const harness = createHarness();
      const capture = await harness.service.capture(textCapture());
      assert.equal(capture.ok, true);
      harness.behavior.openError = openError;

      const result = await harness.service.openDownload({
        actor: owner,
        auditActor: auditContext('download-failure'),
        itemId: 'item-1',
        snapshotId: capture.value.snapshot.id,
      });

      assertFailure(result, statusCode, code);
      assert.doesNotMatch(JSON.stringify(result), /credential secret/);
    });
  }
});

test('download treats opened artifact metadata drift as a sanitized storage failure', async () => {
  const harness = createHarness();
  const capture = await harness.service.capture(textCapture());
  assert.equal(capture.ok, true);
  const artifact = harness.artifacts.get(capture.value.snapshot.artifactId);
  artifact.sha256 = 'f'.repeat(64);

  const result = await harness.service.openDownload({
    actor: owner,
    auditActor: auditContext('download-metadata-drift'),
    itemId: 'item-1',
    snapshotId: capture.value.snapshot.id,
  });

  assertFailure(result, 502, 'snapshot_download_failed');
  assert.equal(harness.openedStreams[0].destroyed, true);
});

test('request keys and provider failure details do not leak through results, audits, or artifact metadata', async () => {
  const requestSecret = 'raw-idempotency-key-secret';
  const providerSecret = 'oauth-refresh-token-secret';
  const harness = createHarness();
  harness.behavior.storeError = new Error(
    `provider rejected credential ${providerSecret}`,
  );
  const result = await harness.service.capture(
    textCapture({ requestKey: requestSecret }),
  );

  assertFailure(result, 502, 'snapshot_storage_pending');
  const publicEvidence = JSON.stringify({ result, audits: harness.audits });
  assert.doesNotMatch(publicEvidence, /raw-idempotency-key-secret/);
  assert.doesNotMatch(publicEvidence, /oauth-refresh-token-secret/);
  assert.equal(harness.artifactStoreInputs.length, 1);
  assert.match(
    harness.artifactStoreInputs[0].idempotencyNamespace,
    /^[a-f0-9]{64}$/,
  );
  assert.doesNotMatch(
    JSON.stringify({
      ...harness.artifactStoreInputs[0],
      body: '<redacted-test-body>',
    }),
    /raw-idempotency-key-secret|oauth-refresh-token-secret/,
  );

  const credentialUrl = await harness.service.capture({
    actor: owner,
    auditActor: auditContext(),
    itemId: 'item-1',
    requestKey: 'credential-url-request',
    captureMethod: 'url',
    url: 'https://user:password-secret@example.com/private',
  });
  assertFailure(credentialUrl, 400, 'invalid_request');
  assert.doesNotMatch(JSON.stringify(credentialUrl), /password-secret/);
  const credentialSnapshot = [...harness.snapshots.values()].find(
    (snapshot) => snapshot.captureMethod === 'url',
  );
  assert.equal(credentialSnapshot, undefined);
});

test('capture rejects mixed union arms, missing arm data, invalid methods, and unknown properties before persistence', async () => {
  const invalidInputs = [
    textCapture({ url: 'https://example.com' }),
    {
      actor: owner,
      auditActor: auditContext(),
      itemId: 'item-1',
      requestKey: 'url-with-text',
      captureMethod: 'url',
      url: 'https://example.com',
      text: 'must not be accepted',
    },
    {
      actor: owner,
      auditActor: auditContext(),
      itemId: 'item-1',
      requestKey: 'upload-with-url',
      captureMethod: 'upload',
      upload: {
        body: Buffer.from('upload'),
        contentType: 'text/plain',
        originalName: 'upload.txt',
      },
      url: 'https://example.com',
    },
    textCapture({ unexpectedProperty: true }),
    textCapture({ captureMethod: 'archive' }),
    textCapture({ text: undefined }),
    {
      actor: owner,
      auditActor: auditContext(),
      itemId: 'item-1',
      requestKey: 'invalid-upload-body',
      captureMethod: 'upload',
      upload: {
        body: 'not-a-buffer',
        contentType: 'text/plain',
        originalName: 'upload.txt',
      },
    },
  ];

  for (const input of invalidInputs) {
    const harness = createHarness();
    const result = await harness.service.capture(input);
    assertFailure(result, 400, 'invalid_request');
    assert.equal(harness.snapshots.size, 0);
    assert.equal(harness.artifactStoreInputs.length, 0);
    assert.equal(harness.audits.length, 0);
  }
});
