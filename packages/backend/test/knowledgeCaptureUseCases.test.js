import assert from 'node:assert/strict';
import test from 'node:test';

import { KnowledgeArtifactStoreError } from '../dist/application/knowledge/knowledgeArtifactPort.js';
import { KnowledgeCaptureTransactionConflictError } from '../dist/application/knowledge/knowledgeCapturePorts.js';
import { createKnowledgeCaptureTokenCodec } from '../dist/application/knowledge/knowledgeCaptureToken.js';
import { createKnowledgeCaptureService } from '../dist/application/knowledge/knowledgeCaptureUseCases.js';

const actor = {
  userId: 'owner-1',
  organizationId: 'org-1',
  groupAccountIds: ['group-1', 'group-2'],
};
const now = new Date('2026-08-14T00:00:00.000Z');
const env = {
  NODE_ENV: 'test',
  KNOWLEDGE_CURSOR_SIGNING_SECRET: 'knowledge-capture-test-signing-secret-0001',
  KNOWLEDGE_CAPTURE_IDEMPOTENCY_SECRET:
    'knowledge-capture-test-idempotency-secret-0001',
};

function request(overrides = {}) {
  return {
    draft: {
      schemaVersion: 1,
      channel: 'browser_extension',
      title: 'Selected title',
      url: 'https://example.invalid/article',
      selectedText: 'Selected body',
      description: 'private-description-canary',
      author: null,
      publishedAt: null,
      capturedAt: now.toISOString(),
    },
    selectedFields: ['title', 'selectedText'],
    scope: 'personal',
    organizationGroupAccountIds: [],
    sourceType: 'web',
    requestKey: 'opaque-client-key',
    ...overrides,
  };
}

function createHarness(options = {}) {
  const captures = new Map();
  const audits = [];
  const stored = [];
  const reconciled = [];
  const behavior = {
    storeOutcome: 'success',
    activeGroups: ['group-1'],
    memberGroups: ['group-1'],
    currentAccess: true,
    revokeAccessDuringStore: false,
    revokeGroupDuringStore: null,
    revokeAccessDuringReconcile: false,
    revokeGroupAfterArtifactStateRead: null,
    reconcileArtifact: null,
    artifactOverride: null,
    currentTime: now,
    conflictOnRuns: [],
    runCount: 0,
    ...options,
  };
  let idIndex = 0;
  let previewIdIndex = 0;
  const ids = [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ];
  const previewIds = [
    '11111111-2222-4333-8444-123456789012',
    '22222222-3333-4444-8555-234567890123',
    '33333333-4444-4555-8666-345678901234',
  ];
  const repository = {
    lockActiveGroupsForActor: async ({
      actorUserId,
      organizationId,
      groupAccountIds,
    }) =>
      actorUserId === actor.userId && organizationId === actor.organizationId
        ? groupAccountIds.filter(
            (id) =>
              behavior.activeGroups.includes(id) &&
              behavior.memberGroups.includes(id),
          ).length
        : 0,
    findByRequestKey: async ({ ownerUserId, requestKeyHash }) =>
      [...captures.values()].find(
        (capture) =>
          capture.ownerUserId === ownerUserId &&
          capture.requestKeyHash === requestKeyHash,
      ) ?? null,
    findRecentByPayload: async ({ actor: candidate, payloadHash }) =>
      behavior.currentAccess
        ? ([...captures.values()].find(
            (capture) =>
              capture.ownerUserId === candidate.userId &&
              capture.payloadHash === payloadHash,
          ) ?? null)
        : null,
    hasCurrentAccess: async ({ actor: candidate, captureId }) => {
      const capture = captures.get(captureId);
      return Boolean(
        behavior.currentAccess &&
        capture &&
        capture.ownerUserId === candidate.userId,
      );
    },
    hasCurrentBindingAccess: async ({
      actor: candidate,
      captureId,
      requiredGroupAccountIds,
    }) => {
      const capture = captures.get(captureId);
      return Boolean(
        behavior.currentAccess &&
        capture &&
        capture.ownerUserId === candidate.userId &&
        requiredGroupAccountIds.every(
          (groupId) =>
            behavior.activeGroups.includes(groupId) &&
            behavior.memberGroups.includes(groupId),
        ),
      );
    },
    findOwnedById: async ({ actor: candidate, captureId }) => {
      const capture = captures.get(captureId);
      return capture?.ownerUserId === candidate.userId
        ? structuredClone(capture)
        : null;
    },
    findOwnedArtifactState: async ({ actor: candidate, captureId }) => {
      const capture = captures.get(captureId);
      if (
        !behavior.currentAccess ||
        !capture ||
        capture.ownerUserId !== candidate.userId
      )
        return null;
      const state = {
        capture: structuredClone(capture),
        contentType: capture.contentType ?? null,
        originalName: 'knowledge-capture.txt',
        sha256: capture.sha256 ?? null,
        sizeBytes: capture.sizeBytes ?? null,
      };
      if (behavior.revokeGroupAfterArtifactStateRead) {
        behavior.memberGroups = behavior.memberGroups.filter(
          (groupId) => groupId !== behavior.revokeGroupAfterArtifactStateRead,
        );
      }
      return state;
    },
    createAggregate: async (input) => {
      const capture = {
        id: input.id,
        ownerUserId: input.ownerUserId,
        requestKeyHash: input.requestKeyHash,
        payloadHash: input.payloadHash,
        channel: input.channel,
        scope: input.scope,
        organizationId: input.organizationId,
        knowledgeItemId: input.itemId,
        snapshotId: input.snapshotId,
        snapshotVersion: 1,
        status: 'pending',
        failureCode: null,
        selectedFieldCount: input.selectedFieldCount,
        payloadByteCount: input.payloadByteCount,
        version: 1,
        createdAt: now,
        committedAt: null,
        failedAt: null,
        updatedAt: now,
        contentType: input.contentType,
        extractedText: input.extractedText,
        sha256: input.sha256,
        sizeBytes: input.sizeBytes,
      };
      captures.set(capture.id, capture);
      return structuredClone(capture);
    },
    markReady: async ({
      actor: candidate,
      captureId,
      requiredGroupAccountIds,
      committedAt,
    }) => {
      const capture = captures.get(captureId);
      if (
        !behavior.currentAccess ||
        !capture ||
        capture.ownerUserId !== candidate.userId ||
        capture.status !== 'pending' ||
        requiredGroupAccountIds.some(
          (groupId) =>
            !behavior.activeGroups.includes(groupId) ||
            !behavior.memberGroups.includes(groupId),
        )
      )
        return null;
      Object.assign(capture, {
        status: 'ready',
        committedAt,
        version: capture.version + 1,
      });
      return structuredClone(capture);
    },
    markFailed: async ({
      actor: candidate,
      captureId,
      requiredGroupAccountIds,
      failedAt,
      failureCode,
    }) => {
      const capture = captures.get(captureId);
      if (
        !behavior.currentAccess ||
        !capture ||
        capture.ownerUserId !== candidate.userId ||
        capture.status !== 'pending' ||
        requiredGroupAccountIds.some(
          (groupId) =>
            !behavior.activeGroups.includes(groupId) ||
            !behavior.memberGroups.includes(groupId),
        )
      )
        return null;
      Object.assign(capture, {
        status: 'failed',
        failedAt,
        failureCode,
        version: capture.version + 1,
      });
      return structuredClone(capture);
    },
  };
  const unitOfWork = {
    run: async (work) => {
      behavior.runCount += 1;
      if (behavior.conflictOnRuns.includes(behavior.runCount)) {
        throw new KnowledgeCaptureTransactionConflictError();
      }
      return work({
        captures: repository,
        audit: { write: async (entry) => audits.push(structuredClone(entry)) },
      });
    },
  };
  const artifacts = {
    store: async (input) => {
      assert.match(input.idempotencyNamespace, /^[a-f0-9]{64}$/);
      stored.push(structuredClone(input));
      if (behavior.revokeAccessDuringStore) behavior.currentAccess = false;
      if (behavior.revokeGroupDuringStore) {
        behavior.memberGroups = behavior.memberGroups.filter(
          (groupId) => groupId !== behavior.revokeGroupDuringStore,
        );
      }
      if (behavior.storeOutcome !== 'success') {
        throw new KnowledgeArtifactStoreError(behavior.storeOutcome);
      }
      return {
        artifactId: 'artifact-1',
        contentType: input.contentType,
        createdAt: now.toISOString(),
        originalName: input.originalName,
        provider: 'local',
        sha256: input.sha256,
        sizeBytes: input.sizeBytes,
        ...(behavior.artifactOverride ?? {}),
      };
    },
    reconcile: async (input) => {
      assert.match(input.idempotencyNamespace, /^[a-f0-9]{64}$/);
      reconciled.push(structuredClone(input));
      if (behavior.revokeAccessDuringReconcile) {
        behavior.currentAccess = false;
      }
      return behavior.reconcileArtifact;
    },
    open: async () => {
      throw new Error('unused');
    },
  };
  const tokenCodec = createKnowledgeCaptureTokenCodec({
    env,
    now: () => behavior.currentTime,
    randomId: () => previewIds[previewIdIndex++],
  });
  const service = createKnowledgeCaptureService({
    artifacts,
    reader: repository,
    unitOfWork,
    tokenCodec,
    now: () => behavior.currentTime,
    randomId: () => ids[idIndex++],
  });
  return { service, captures, audits, stored, reconciled, behavior };
}

async function previewAndCommit(harness, overrides = {}) {
  const base = request(overrides);
  const preview = await harness.service.preview({
    actor,
    auditActor: { requestId: 'preview-request', source: 'api' },
    request: base,
  });
  assert.equal(preview.ok, true);
  const commit = await harness.service.commit({
    actor,
    auditActor: { requestId: 'commit-request', source: 'api' },
    request: {
      ...base,
      confirmed: true,
      organizationConfirmed: false,
      previewToken: preview.value.previewToken,
      requestKey: 'opaque-client-key',
    },
  });
  return { base, preview, commit };
}

test('preview is content-selective and commit atomically converges to one ready capture', async () => {
  const harness = createHarness();
  const { preview, commit } = await previewAndCommit(harness);
  assert.equal(commit.ok, true);
  assert.equal(commit.value.status, 'ready');
  assert.equal(
    preview.value.normalizedDraft.description,
    'private-description-canary',
  );
  assert.deepEqual(preview.value.selectedFields, ['title', 'selectedText']);
  assert.equal(harness.stored.length, 1);
  assert.equal(
    harness.stored[0].body
      .toString('utf8')
      .includes('private-description-canary'),
    false,
  );
  assert.equal(
    JSON.stringify(harness.audits).includes('private-description-canary'),
    false,
  );
  assert.deepEqual(
    harness.audits.map((entry) => entry.action),
    [
      'knowledge_capture_previewed',
      'knowledge_capture_pending',
      'knowledge_capture_committed',
    ],
  );

  const replay = await harness.service.commit({
    actor,
    auditActor: { source: 'api' },
    request: {
      ...request(),
      confirmed: true,
      organizationConfirmed: false,
      previewToken: preview.value.previewToken,
      requestKey: 'opaque-client-key',
    },
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.value.reused, true);
  assert.equal(harness.captures.size, 1);
  assert.equal(harness.stored.length, 1);
});

test('same key with changed payload conflicts before artifact storage', async () => {
  const harness = createHarness();
  await previewAndCommit(harness);
  const changed = request({ selectedFields: ['title'] });
  const preview = await harness.service.preview({
    actor,
    auditActor: {},
    request: changed,
  });
  assert.equal(preview.ok, true);
  const result = await harness.service.commit({
    actor,
    auditActor: {},
    request: {
      ...changed,
      confirmed: true,
      organizationConfirmed: false,
      previewToken: preview.value.previewToken,
      requestKey: 'opaque-client-key',
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'idempotency_conflict');
  assert.equal(harness.stored.length, 1);
});

test('commit and reconcile reject a preview issued to a different canonical actor before side effects', async () => {
  const switchedActor = {
    ...actor,
    userId: 'owner-2',
  };
  const commitHarness = createHarness();
  const commitRequest = request();
  const preview = await commitHarness.service.preview({
    actor,
    auditActor: {},
    request: commitRequest,
  });
  assert.equal(preview.ok, true);

  const switchedCommit = await commitHarness.service.commit({
    actor: switchedActor,
    auditActor: {},
    request: {
      ...commitRequest,
      confirmed: true,
      organizationConfirmed: false,
      previewToken: preview.value.previewToken,
      requestKey: 'opaque-client-key',
    },
  });
  assert.equal(switchedCommit.ok, false);
  assert.equal(switchedCommit.code, 'preview_token_invalid');
  assert.equal(commitHarness.captures.size, 0);
  assert.equal(commitHarness.stored.length, 0);

  const reconcileHarness = createHarness({ storeOutcome: 'unknown' });
  const pending = await previewAndCommit(reconcileHarness);
  assert.equal(pending.commit.ok, true);
  assert.equal(pending.commit.value.status, 'pending');
  const switchedReconcile = await reconcileHarness.service.reconcile({
    actor: switchedActor,
    auditActor: {},
    captureId: pending.preview.value.captureId,
    request: {
      ...pending.base,
      previewToken: pending.preview.value.previewToken,
      requestKey: 'opaque-client-key',
    },
  });
  assert.equal(switchedReconcile.ok, false);
  assert.equal(switchedReconcile.code, 'preview_token_invalid');
  assert.equal(reconcileHarness.reconciled.length, 0);
  assert.equal(reconcileHarness.stored.length, 1);
});

test('preview does not expose a duplicate whose current item access was revoked', async () => {
  const harness = createHarness();
  const { commit } = await previewAndCommit(harness);
  assert.equal(commit.ok, true);
  harness.behavior.currentAccess = false;

  const secondPreview = await harness.service.preview({
    actor,
    auditActor: { requestId: 'hidden-duplicate-preview', source: 'api' },
    request: request({ requestKey: 'new-opaque-client-key' }),
  });
  assert.equal(secondPreview.ok, true);
  assert.deepEqual(secondPreview.value.duplicateCandidate, {
    detected: false,
    status: null,
  });
});

test('organization requires explicit confirmation and active current groups', async () => {
  const harness = createHarness();
  const organization = request({
    scope: 'organization',
    organizationGroupAccountIds: ['group-1'],
    requestKey: 'key-1',
  });
  const preview = await harness.service.preview({
    actor,
    auditActor: {},
    request: organization,
  });
  assert.equal(preview.ok, true);
  const missingConfirmation = await harness.service.commit({
    actor,
    auditActor: {},
    request: {
      ...organization,
      confirmed: true,
      organizationConfirmed: false,
      previewToken: preview.value.previewToken,
      requestKey: 'key-1',
    },
  });
  assert.equal(missingConfirmation.ok, false);
  harness.behavior.activeGroups = [];
  const revoked = await harness.service.commit({
    actor,
    auditActor: {},
    request: {
      ...organization,
      confirmed: true,
      organizationConfirmed: true,
      previewToken: preview.value.previewToken,
      requestKey: 'key-1',
    },
  });
  assert.equal(revoked.ok, false);
  assert.equal(revoked.statusCode, 404);
});

test('organization replay rechecks current membership before returning an existing capture', async () => {
  const harness = createHarness();
  const organization = request({
    scope: 'organization',
    organizationGroupAccountIds: ['group-1'],
    requestKey: 'organization-replay-key',
  });
  const preview = await harness.service.preview({
    actor,
    auditActor: {},
    request: organization,
  });
  assert.equal(preview.ok, true);
  const created = await harness.service.commit({
    actor,
    auditActor: {},
    request: {
      ...organization,
      confirmed: true,
      organizationConfirmed: true,
      previewToken: preview.value.previewToken,
      requestKey: 'organization-replay-key',
    },
  });
  assert.equal(created.ok, true);
  harness.behavior.memberGroups = [];

  const replayAfterRevocation = await harness.service.commit({
    actor,
    auditActor: {},
    request: {
      ...organization,
      confirmed: true,
      organizationConfirmed: true,
      previewToken: preview.value.previewToken,
      requestKey: 'organization-replay-key',
    },
  });
  assert.equal(replayAfterRevocation.ok, false);
  assert.equal(replayAfterRevocation.statusCode, 404);
  assert.equal(harness.captures.size, 1);
  assert.equal(harness.stored.length, 1);
});

test('unknown artifact outcome remains pending and reconcile never stores again', async () => {
  const harness = createHarness({ storeOutcome: 'unknown' });
  const { base, preview, commit } = await previewAndCommit(harness);
  assert.equal(commit.ok, true);
  assert.equal(commit.value.status, 'pending');
  const capture = [...harness.captures.values()][0];
  harness.behavior.reconcileArtifact = {
    artifactId: 'artifact-recovered',
    contentType: capture.contentType,
    createdAt: now.toISOString(),
    originalName: 'knowledge-capture.txt',
    provider: 'local',
    sha256: capture.sha256,
    sizeBytes: capture.sizeBytes,
  };
  const reconciled = await harness.service.reconcile({
    actor,
    auditActor: { source: 'api' },
    captureId: preview.value.captureId,
    request: {
      ...base,
      previewToken: preview.value.previewToken,
      requestKey: 'opaque-client-key',
    },
  });
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.value.status, 'ready');
  assert.equal(harness.stored.length, 1);
  assert.equal(harness.reconciled.length, 1);
  assert.equal(harness.captures.size, 1);
});

test('lost replay response reconciles a prior ledger capture through the signed preview intent', async () => {
  const harness = createHarness();
  const first = await previewAndCommit(harness);
  assert.equal(first.commit.ok, true);
  const secondPreview = await harness.service.preview({
    actor,
    auditActor: {},
    request: first.base,
  });
  assert.equal(secondPreview.ok, true);
  assert.notEqual(secondPreview.value.captureId, first.commit.value.captureId);
  const replay = await harness.service.commit({
    actor,
    auditActor: {},
    request: {
      ...first.base,
      confirmed: true,
      organizationConfirmed: false,
      previewToken: secondPreview.value.previewToken,
      requestKey: 'opaque-client-key',
    },
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.value.captureId, first.commit.value.captureId);
  assert.equal(replay.value.requestCaptureId, secondPreview.value.captureId);

  const reconciled = await harness.service.reconcile({
    actor,
    auditActor: {},
    captureId: secondPreview.value.captureId,
    request: {
      ...first.base,
      previewToken: secondPreview.value.previewToken,
      requestKey: 'opaque-client-key',
    },
  });
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.value.captureId, first.commit.value.captureId);
  assert.equal(
    reconciled.value.requestCaptureId,
    secondPreview.value.captureId,
  );
  assert.equal(harness.stored.length, 1);
});

test('capture fails closed when current item access is lost before or during artifact I/O', async () => {
  const beforeStore = createHarness({ currentAccess: false });
  const before = await previewAndCommit(beforeStore);
  assert.equal(before.commit.ok, false);
  assert.equal(before.commit.statusCode, 404);
  assert.equal(beforeStore.stored.length, 0);

  const duringStore = createHarness({ revokeAccessDuringStore: true });
  const during = await previewAndCommit(duringStore);
  assert.equal(during.commit.ok, false);
  assert.equal(during.commit.statusCode, 404);
  assert.equal(duringStore.stored.length, 1);
});

test('capture rejects unsafe opaque request keys before ledger hashing', async () => {
  for (const requestKey of [
    '\ud800',
    '\ufffd',
    '\u0000',
    '\u061c',
    '\u009b',
    'key with space',
    'ＫＥＹ',
    'clé',
  ]) {
    const harness = createHarness();
    const value = request();
    const preview = await harness.service.preview({
      actor,
      auditActor: {},
      request: value,
    });
    assert.equal(preview.ok, true);
    const result = await harness.service.commit({
      actor,
      auditActor: {},
      request: {
        ...value,
        confirmed: true,
        organizationConfirmed: false,
        previewToken: preview.value.previewToken,
        requestKey,
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_request');
    assert.equal(harness.captures.size, 0);
  }
});

test('deterministic storage failure preserves one failed aggregate', async () => {
  const harness = createHarness({ storeOutcome: 'failed' });
  const { commit } = await previewAndCommit(harness);
  assert.equal(commit.ok, true);
  assert.equal(commit.value.status, 'failed');
  assert.equal(commit.value.failureCode, 'snapshot_storage_failed');
  assert.equal(harness.captures.size, 1);
});

test('organization finalization requires every group bound by the signed preview', async () => {
  const harness = createHarness({
    activeGroups: ['group-1', 'group-2'],
    memberGroups: ['group-1', 'group-2'],
    revokeGroupDuringStore: 'group-2',
  });
  const organization = request({
    scope: 'organization',
    organizationGroupAccountIds: ['group-1', 'group-2'],
    requestKey: 'multi-group-key',
  });
  const preview = await harness.service.preview({
    actor,
    auditActor: {},
    request: organization,
  });
  assert.equal(preview.ok, true);
  const result = await harness.service.commit({
    actor,
    auditActor: {},
    request: {
      ...organization,
      confirmed: true,
      organizationConfirmed: true,
      previewToken: preview.value.previewToken,
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 404);
  assert.equal(harness.stored.length, 1);
  assert.equal([...harness.captures.values()][0].status, 'pending');
});

test('all provider I/O pending paths recheck current access before returning identifiers', async () => {
  for (const options of [
    { storeOutcome: 'unknown', revokeAccessDuringStore: true },
    {
      revokeAccessDuringStore: true,
      artifactOverride: { sha256: '0'.repeat(64) },
    },
  ]) {
    const harness = createHarness(options);
    const { commit } = await previewAndCommit(harness);
    assert.equal(commit.ok, false);
    assert.equal(commit.statusCode, 404);
  }

  const harness = createHarness({ storeOutcome: 'unknown' });
  const pending = await previewAndCommit(harness);
  assert.equal(pending.commit.ok, true);
  assert.equal(pending.commit.value.status, 'pending');
  harness.behavior.revokeAccessDuringReconcile = true;
  const reconciled = await harness.service.reconcile({
    actor,
    auditActor: {},
    captureId: pending.preview.value.captureId,
    request: {
      ...pending.base,
      previewToken: pending.preview.value.previewToken,
      requestKey: pending.base.requestKey,
    },
  });
  assert.equal(reconciled.ok, false);
  assert.equal(reconciled.statusCode, 404);
});

test('expired but authentic preview can reconcile an existing pending ledger without store replay', async () => {
  const harness = createHarness({ storeOutcome: 'unknown' });
  const pending = await previewAndCommit(harness);
  assert.equal(pending.commit.value.status, 'pending');
  harness.behavior.currentTime = new Date('2026-08-14T00:20:00.000Z');
  harness.behavior.reconcileArtifact = {
    artifactId: 'artifact-1',
    contentType: 'text/plain',
    createdAt: now.toISOString(),
    originalName: 'knowledge-capture.txt',
    sha256: harness.stored[0].sha256,
    sizeBytes: harness.stored[0].sizeBytes,
    provider: 'local',
  };
  const reconciled = await harness.service.reconcile({
    actor,
    auditActor: {},
    captureId: pending.preview.value.captureId,
    request: {
      ...pending.base,
      previewToken: pending.preview.value.previewToken,
      requestKey: pending.base.requestKey,
    },
  });
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.value.status, 'ready');
  assert.equal(harness.stored.length, 1);
  assert.equal(harness.reconciled.length, 1);
});

test('reconcile rechecks every signed organization group after reading terminal state', async () => {
  const harness = createHarness({
    activeGroups: ['group-1', 'group-2'],
    memberGroups: ['group-1', 'group-2'],
  });
  const organization = request({
    scope: 'organization',
    organizationGroupAccountIds: ['group-1', 'group-2'],
    requestKey: 'terminal-reconcile-key',
  });
  const preview = await harness.service.preview({
    actor,
    auditActor: {},
    request: organization,
  });
  assert.equal(preview.ok, true);
  const committed = await harness.service.commit({
    actor,
    auditActor: {},
    request: {
      ...organization,
      confirmed: true,
      organizationConfirmed: true,
      previewToken: preview.value.previewToken,
    },
  });
  assert.equal(committed.ok, true);
  assert.equal(committed.value.status, 'ready');
  harness.behavior.revokeGroupAfterArtifactStateRead = 'group-2';

  const reconciled = await harness.service.reconcile({
    actor,
    auditActor: {},
    captureId: preview.value.captureId,
    request: {
      ...organization,
      previewToken: preview.value.previewToken,
    },
  });
  assert.equal(reconciled.ok, false);
  assert.equal(reconciled.statusCode, 404);
});

test('transaction retry exhaustion is normalized before dispatch and after deterministic failure', async () => {
  const preDispatch = createHarness({ conflictOnRuns: [2] });
  const before = await previewAndCommit(preDispatch);
  assert.equal(before.commit.ok, false);
  assert.equal(before.commit.statusCode, 409);
  assert.equal(before.commit.code, 'capture_transaction_conflict_pre_dispatch');
  assert.equal(preDispatch.stored.length, 0);

  const finalization = createHarness({
    storeOutcome: 'failed',
    conflictOnRuns: [4],
  });
  const after = await previewAndCommit(finalization);
  assert.equal(after.commit.ok, true);
  assert.equal(after.commit.value.status, 'pending');
  assert.equal(finalization.stored.length, 1);
  assert.equal([...finalization.captures.values()][0].status, 'pending');
});
