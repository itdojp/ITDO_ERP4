import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createEvidenceSnapshotForApproval,
  resolveEvidenceSnapshotTargetKind,
} from '../dist/services/evidenceSnapshot.js';

test('resolveEvidenceSnapshotTargetKind: supports singular/plural aliases', () => {
  assert.equal(resolveEvidenceSnapshotTargetKind('estimate'), 'estimate');
  assert.equal(resolveEvidenceSnapshotTargetKind('estimates'), 'estimate');
  assert.equal(resolveEvidenceSnapshotTargetKind('invoice'), 'invoice');
  assert.equal(resolveEvidenceSnapshotTargetKind('invoices'), 'invoice');
  assert.equal(
    resolveEvidenceSnapshotTargetKind('purchase_orders'),
    'purchase_order',
  );
  assert.equal(resolveEvidenceSnapshotTargetKind('vendor_invoice'), 'vendor_invoice');
  assert.equal(resolveEvidenceSnapshotTargetKind('unknown_kind'), null);
});

test('createEvidenceSnapshotForApproval: returns unsupportedTarget for unsupported table', async () => {
  const latest = null;
  const client = {
    evidenceSnapshot: {
      findFirst: async () => latest,
      create: async () => {
        throw new Error('unexpected_create');
      },
    },
    annotation: {
      findUnique: async () => {
        throw new Error('unexpected_annotation_lookup');
      },
    },
    chatMessage: {
      findMany: async () => [],
    },
  };

  const result = await createEvidenceSnapshotForApproval(client, {
    approvalInstanceId: 'ap-unsupported',
    targetTable: 'not_supported',
    targetId: 'x-1',
    capturedBy: 'u-1',
    forceRegenerate: false,
  });

  assert.equal(result.created, false);
  assert.equal(result.unsupportedTarget, true);
  assert.equal(result.snapshot, null);
});

test('createEvidenceSnapshotForApproval: reuses latest snapshot when forceRegenerate=false', async () => {
  const latest = {
    id: 'snap-latest',
    approvalInstanceId: 'ap-1',
    version: 2,
  };

  let createCalled = false;
  const client = {
    evidenceSnapshot: {
      findFirst: async () => latest,
      create: async () => {
        createCalled = true;
        return {};
      },
    },
    annotation: {
      findUnique: async () => {
        throw new Error('unexpected_annotation_lookup');
      },
    },
    chatMessage: {
      findMany: async () => [],
    },
  };

  const result = await createEvidenceSnapshotForApproval(client, {
    approvalInstanceId: 'ap-1',
    targetTable: 'estimates',
    targetId: 'est-1',
    capturedBy: 'u-1',
    forceRegenerate: false,
  });

  assert.equal(result.created, false);
  assert.equal(result.unsupportedTarget, false);
  assert.equal(result.snapshot, latest);
  assert.equal(createCalled, false);
});

test('createEvidenceSnapshotForApproval: normalizes annotation and captures chat evidence', async () => {
  const createdAt = new Date('2026-02-15T12:00:00.000Z');
  let createInput;

  const client = {
    evidenceSnapshot: {
      findFirst: async () => null,
      create: async ({ data }) => {
        createInput = data;
        return {
          id: 'snap-1',
          approvalInstanceId: data.approvalInstanceId,
          targetTable: data.targetTable,
          targetId: data.targetId,
          sourceAnnotationUpdatedAt: data.sourceAnnotationUpdatedAt,
          capturedAt: createdAt,
          capturedBy: data.capturedBy,
          version: data.version,
          items: data.items,
        };
      },
    },
    annotation: {
      findUnique: async () => ({
        notes: 'see qa@example.com and 09012345678',
        externalUrls: ['https://example.com/a', 'https://example.com/a', ''],
        internalRefs: [
          { kind: 'chat_message', id: 'm-1', label: 'Thread A' },
          { kind: 'chat_message', id: 'm-1', label: 'Thread A duplicate' },
          { kind: 'chat_message', id: 'm-2' },
          { kind: 'project', id: 'prj-1', label: 'Project 1' },
          { kind: '', id: 'invalid' },
        ],
        updatedAt: new Date('2026-02-15T11:30:00.000Z'),
      }),
    },
    chatMessage: {
      findMany: async ({ where }) => {
        assert.deepEqual(where, { id: { in: ['m-1', 'm-2'] }, deletedAt: null });
        return [
          {
            id: 'm-1',
            roomId: 'room-1',
            userId: 'user-1',
            createdAt: new Date('2026-02-15T11:20:00.000Z'),
            body: 'Evidence message body',
          },
        ];
      },
    },
  };

  const result = await createEvidenceSnapshotForApproval(client, {
    approvalInstanceId: 'ap-2',
    targetTable: 'estimates',
    targetId: 'est-2',
    capturedBy: 'actor-1',
    forceRegenerate: false,
  });

  assert.equal(result.created, true);
  assert.equal(result.unsupportedTarget, false);
  assert.equal(result.snapshot.id, 'snap-1');
  assert.equal(createInput.version, 1);
  assert.equal(createInput.capturedBy, 'actor-1');
  assert.equal(
    createInput.sourceAnnotationUpdatedAt.toISOString(),
    '2026-02-15T11:30:00.000Z',
  );

  const items = createInput.items;
  assert.equal(items.notes, 'see qa@example.com and 09012345678');
  assert.deepEqual(items.externalUrls, ['https://example.com/a']);
  assert.deepEqual(items.internalRefs, [
    { kind: 'chat_message', id: 'm-1', label: 'Thread A' },
    { kind: 'chat_message', id: 'm-2' },
    { kind: 'project', id: 'prj-1', label: 'Project 1' },
  ]);
  assert.deepEqual(items.chatMessages, [
    {
      id: 'm-1',
      roomId: 'room-1',
      userId: 'user-1',
      createdAt: '2026-02-15T11:20:00.000Z',
      excerpt: 'Evidence message body',
      bodyHash: createHash('sha256').update('Evidence message body').digest('hex'),
    },
  ]);
});

test('createEvidenceSnapshotForApproval: forceRegenerate creates next version', async () => {
  const latest = {
    id: 'snap-latest',
    approvalInstanceId: 'ap-3',
    version: 4,
  };
  let createVersion = 0;

  const client = {
    evidenceSnapshot: {
      findFirst: async () => latest,
      create: async ({ data }) => {
        createVersion = data.version;
        return {
          id: 'snap-5',
          approvalInstanceId: data.approvalInstanceId,
          version: data.version,
          targetTable: data.targetTable,
          targetId: data.targetId,
          sourceAnnotationUpdatedAt: data.sourceAnnotationUpdatedAt,
          capturedBy: data.capturedBy,
          items: data.items,
        };
      },
    },
    annotation: {
      findUnique: async () => ({
        notes: null,
        externalUrls: [],
        internalRefs: [],
        updatedAt: null,
      }),
    },
    chatMessage: {
      findMany: async () => [],
    },
  };

  const result = await createEvidenceSnapshotForApproval(client, {
    approvalInstanceId: 'ap-3',
    targetTable: 'estimates',
    targetId: 'est-3',
    capturedBy: 'actor-2',
    forceRegenerate: true,
  });

  assert.equal(result.created, true);
  assert.equal(createVersion, 5);
  assert.equal(result.snapshot.version, 5);
});
