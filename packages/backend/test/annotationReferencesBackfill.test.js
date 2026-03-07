import assert from 'node:assert/strict';
import test from 'node:test';

import { backfillReferenceLinksFromAnnotations } from '../dist/services/annotationReferences.js';

function createAnnotation({
  id,
  targetKind,
  targetId,
  externalUrls = [],
  internalRefs = [],
  createdAt = new Date('2026-03-01T00:00:00.000Z'),
  createdBy = 'creator-1',
  updatedAt = new Date('2026-03-02T00:00:00.000Z'),
  updatedBy = 'updater-1',
}) {
  return {
    id,
    targetKind,
    targetId,
    externalUrls,
    internalRefs,
    createdAt,
    createdBy,
    updatedAt,
    updatedBy,
  };
}

function extractCursorGt(where) {
  if (!where || typeof where !== 'object') return undefined;
  if (Array.isArray(where.AND)) {
    for (const item of where.AND) {
      const cursor = extractCursorGt(item);
      if (cursor) return cursor;
    }
  }
  return where?.id?.gt;
}

test('backfillReferenceLinksFromAnnotations: dry-run counts normalized candidates without writing', async () => {
  const findManyCalls = [];
  let createManyCalled = false;
  const client = {
    annotation: {
      findMany: async ({ where }) => {
        findManyCalls.push(where);
        if (findManyCalls.length === 1) {
          return [
            createAnnotation({
              id: 'ann-1',
              targetKind: 'invoice',
              targetId: 'inv-1',
              externalUrls: [
                'https://example.com/a',
                'https://example.com/a',
                '   ',
              ],
              internalRefs: [
                { kind: 'project_chat', id: 'room-1', label: 'Legacy room' },
                { kind: 'room_chat', id: 'room-1', label: 'New room label' },
                { kind: 'chat_message', id: 'msg-1' },
              ],
            }),
            createAnnotation({
              id: 'ann-2',
              targetKind: 'invoice',
              targetId: 'inv-2',
              externalUrls: [],
              internalRefs: [],
            }),
          ];
        }
        return [];
      },
    },
    referenceLink: {
      findMany: async () => [],
      createMany: async () => {
        createManyCalled = true;
        return { count: 0 };
      },
    },
  };

  const summary = await backfillReferenceLinksFromAnnotations(client, {
    dryRun: true,
    batchSize: 10,
  });

  assert.equal(findManyCalls.length, 2);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.scannedTargets, 2);
  assert.equal(summary.candidateTargets, 1);
  assert.equal(summary.candidateLinks, 3);
  assert.equal(summary.createdTargets, 0);
  assert.equal(summary.createdLinks, 0);
  assert.equal(summary.skippedEmptyTargets, 1);
  assert.equal(summary.skippedExistingTargets, 0);
  assert.equal(summary.processedBatches, 1);
  assert.equal(createManyCalled, false);
});

test('backfillReferenceLinksFromAnnotations: omitted dryRun stays in dry-run mode without createMany', async () => {
  const client = {
    annotation: {
      findMany: async () => [
        createAnnotation({
          id: 'ann-1',
          targetKind: 'invoice',
          targetId: 'inv-1',
          externalUrls: ['https://example.com/a'],
        }),
      ],
    },
    referenceLink: {
      findMany: async () => [],
    },
  };

  const summary = await backfillReferenceLinksFromAnnotations(client, {
    batchSize: 5,
    limitTargets: 1,
  });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.candidateTargets, 1);
  assert.equal(summary.createdTargets, 0);
  assert.equal(summary.createdLinks, 0);
});

test('backfillReferenceLinksFromAnnotations: creates rows only for targets without existing links and preserves metadata', async () => {
  const createManyCalls = [];
  const client = {
    annotation: {
      findMany: async ({ where }) => {
        const cursor = extractCursorGt(where);
        if (!cursor) {
          return [
            createAnnotation({
              id: 'ann-1',
              targetKind: 'invoice',
              targetId: 'inv-1',
              externalUrls: ['https://example.com/a'],
              internalRefs: [
                { kind: 'project_chat', id: 'room-1', label: 'Legacy room' },
              ],
              createdAt: new Date('2026-03-01T10:00:00.000Z'),
              createdBy: 'creator-a',
              updatedAt: new Date('2026-03-02T10:00:00.000Z'),
              updatedBy: 'updater-a',
            }),
            createAnnotation({
              id: 'ann-2',
              targetKind: 'invoice',
              targetId: 'inv-2',
              externalUrls: ['https://example.com/b'],
              internalRefs: [],
              createdAt: new Date('2026-03-01T11:00:00.000Z'),
              createdBy: 'creator-b',
              updatedAt: new Date('2026-03-02T11:00:00.000Z'),
              updatedBy: 'updater-b',
            }),
          ];
        }
        return [];
      },
    },
    referenceLink: {
      findMany: async () => [
        {
          targetKind: 'invoice',
          targetId: 'inv-2',
        },
      ],
      createMany: async ({ data, skipDuplicates }) => {
        createManyCalls.push({ data, skipDuplicates });
        return { count: data.length };
      },
    },
  };

  const summary = await backfillReferenceLinksFromAnnotations(client, {
    dryRun: false,
    batchSize: 10,
  });

  assert.equal(summary.candidateTargets, 1);
  assert.equal(summary.candidateLinks, 2);
  assert.equal(summary.createdTargets, 1);
  assert.equal(summary.createdLinks, 2);
  assert.equal(summary.skippedExistingTargets, 1);
  assert.equal(createManyCalls.length, 1);
  assert.equal(createManyCalls[0]?.skipDuplicates, true);
  assert.deepEqual(createManyCalls[0]?.data, [
    {
      targetKind: 'invoice',
      targetId: 'inv-1',
      linkKind: 'external_url',
      refKind: '',
      value: 'https://example.com/a',
      label: null,
      sortOrder: 0,
      createdAt: new Date('2026-03-01T10:00:00.000Z'),
      createdBy: 'creator-a',
      updatedAt: new Date('2026-03-02T10:00:00.000Z'),
      updatedBy: 'updater-a',
    },
    {
      targetKind: 'invoice',
      targetId: 'inv-1',
      linkKind: 'internal_ref',
      refKind: 'room_chat',
      value: 'room-1',
      label: 'Legacy room',
      sortOrder: 0,
      createdAt: new Date('2026-03-01T10:00:00.000Z'),
      createdBy: 'creator-a',
      updatedAt: new Date('2026-03-02T10:00:00.000Z'),
      updatedBy: 'updater-a',
    },
  ]);
});

test('backfillReferenceLinksFromAnnotations: respects limitTargets across batches', async () => {
  const createManyCalls = [];
  const client = {
    annotation: {
      findMany: async ({ where, take }) => {
        const cursor = extractCursorGt(where);
        if (!cursor) {
          assert.equal(take, 1);
          return [
            createAnnotation({
              id: 'ann-1',
              targetKind: 'invoice',
              targetId: 'inv-1',
              externalUrls: ['https://example.com/a'],
            }),
          ];
        }
        throw new Error('unexpected_second_batch');
      },
    },
    referenceLink: {
      findMany: async () => [],
      createMany: async ({ data }) => {
        createManyCalls.push(data);
        return { count: data.length };
      },
    },
  };

  const summary = await backfillReferenceLinksFromAnnotations(client, {
    dryRun: false,
    batchSize: 5,
    limitTargets: 1,
  });

  assert.equal(summary.limitTargets, 1);
  assert.equal(summary.scannedTargets, 1);
  assert.equal(summary.candidateTargets, 1);
  assert.equal(summary.createdTargets, 1);
  assert.equal(createManyCalls.length, 1);
  assert.equal(createManyCalls[0]?.length, 1);
});

test('backfillReferenceLinksFromAnnotations: limitTargets caps scanned rows even when early rows are skipped', async () => {
  const createManyCalls = [];
  const client = {
    annotation: {
      findMany: async ({ take }) => {
        assert.equal(take, 1);
        return [
          createAnnotation({
            id: 'ann-1',
            targetKind: 'invoice',
            targetId: 'inv-1',
            externalUrls: ['https://example.com/a'],
          }),
        ];
      },
    },
    referenceLink: {
      findMany: async () => [
        {
          targetKind: 'invoice',
          targetId: 'inv-1',
        },
      ],
      createMany: async ({ data }) => {
        createManyCalls.push(data);
        return { count: data.length };
      },
    },
  };

  const summary = await backfillReferenceLinksFromAnnotations(client, {
    dryRun: false,
    batchSize: 5,
    limitTargets: 1,
  });

  assert.equal(summary.scannedTargets, 1);
  assert.equal(summary.candidateTargets, 0);
  assert.equal(summary.skippedExistingTargets, 1);
  assert.equal(summary.createdTargets, 0);
  assert.equal(createManyCalls.length, 0);
});
