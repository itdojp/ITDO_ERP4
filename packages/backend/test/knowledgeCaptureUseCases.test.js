import assert from 'node:assert/strict';
import test from 'node:test';

import { KnowledgeArtifactStoreError } from '../dist/application/knowledge/knowledgeArtifactPort.js';
import { createKnowledgeCaptureTokenCodec } from '../dist/application/knowledge/knowledgeCaptureToken.js';
import { createKnowledgeCaptureService } from '../dist/application/knowledge/knowledgeCaptureUseCases.js';

const actor = {
  userId: 'owner-1',
  organizationId: 'org-1',
  groupAccountIds: ['group-1'],
};
const now = new Date('2026-08-14T00:00:00.000Z');
const env = {
  NODE_ENV: 'test',
  KNOWLEDGE_CURSOR_SIGNING_SECRET: 'knowledge-capture-test-signing-secret-0001',
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
    reconcileArtifact: null,
    ...options,
  };
  let idIndex = 0;
  const ids = [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ];
  const repository = {
    countActiveGroups: async (idsToCheck) =>
      idsToCheck.filter((id) => behavior.activeGroups.includes(id)).length,
    findByRequestKey: async ({ ownerUserId, requestKeyHash }) =>
      [...captures.values()].find(
        (capture) =>
          capture.ownerUserId === ownerUserId &&
          capture.requestKeyHash === requestKeyHash,
      ) ?? null,
    findRecentByPayload: async ({ ownerUserId, payloadHash }) =>
      [...captures.values()].find(
        (capture) =>
          capture.ownerUserId === ownerUserId &&
          capture.payloadHash === payloadHash,
      ) ?? null,
    findOwnedById: async ({ actor: candidate, captureId }) => {
      const capture = captures.get(captureId);
      return capture?.ownerUserId === candidate.userId
        ? structuredClone(capture)
        : null;
    },
    findOwnedArtifactState: async ({ actor: candidate, captureId }) => {
      const capture = captures.get(captureId);
      if (!capture || capture.ownerUserId !== candidate.userId) return null;
      return {
        capture: structuredClone(capture),
        contentType: capture.contentType ?? null,
        originalName: 'knowledge-capture.txt',
        sha256: capture.sha256 ?? null,
        sizeBytes: capture.sizeBytes ?? null,
      };
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
      };
      captures.set(capture.id, capture);
      return structuredClone(capture);
    },
    recordMaterialized: async ({ captureId, ...materialized }) => {
      const capture = captures.get(captureId);
      if (!capture || capture.status !== 'pending') return null;
      Object.assign(capture, materialized);
      return structuredClone(capture);
    },
    markReady: async ({ captureId, committedAt }) => {
      const capture = captures.get(captureId);
      if (!capture || capture.status !== 'pending') return null;
      Object.assign(capture, {
        status: 'ready',
        committedAt,
        version: capture.version + 1,
      });
      return structuredClone(capture);
    },
    markFailed: async ({ captureId, failedAt, failureCode }) => {
      const capture = captures.get(captureId);
      if (!capture || capture.status !== 'pending') return null;
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
    run: async (work) =>
      work({
        captures: repository,
        audit: { write: async (entry) => audits.push(structuredClone(entry)) },
      }),
  };
  const artifacts = {
    store: async (input) => {
      stored.push(structuredClone(input));
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
      };
    },
    reconcile: async (input) => {
      reconciled.push(structuredClone(input));
      return behavior.reconcileArtifact;
    },
    open: async () => {
      throw new Error('unused');
    },
  };
  const tokenCodec = createKnowledgeCaptureTokenCodec({
    env,
    now: () => now,
    randomId: () => '11111111-2222-4333-8444-123456789012',
  });
  const service = createKnowledgeCaptureService({
    artifacts,
    reader: repository,
    unitOfWork,
    tokenCodec,
    now: () => now,
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
  return { preview, commit };
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

test('organization requires explicit confirmation and active current groups', async () => {
  const harness = createHarness();
  const organization = request({
    scope: 'organization',
    organizationGroupAccountIds: ['group-1'],
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

test('organization replay rechecks active groups before returning an existing capture', async () => {
  const harness = createHarness();
  const organization = request({
    scope: 'organization',
    organizationGroupAccountIds: ['group-1'],
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
  harness.behavior.activeGroups = [];

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
  const { commit } = await previewAndCommit(harness);
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
    captureId: capture.id,
  });
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.value.status, 'ready');
  assert.equal(harness.stored.length, 1);
  assert.equal(harness.reconciled.length, 1);
  assert.equal(harness.captures.size, 1);
});

test('deterministic storage failure preserves one failed aggregate', async () => {
  const harness = createHarness({ storeOutcome: 'failed' });
  const { commit } = await previewAndCommit(harness);
  assert.equal(commit.ok, true);
  assert.equal(commit.value.status, 'failed');
  assert.equal(commit.value.failureCode, 'snapshot_storage_failed');
  assert.equal(harness.captures.size, 1);
});
