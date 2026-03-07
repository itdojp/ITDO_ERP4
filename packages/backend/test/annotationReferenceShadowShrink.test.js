import assert from 'node:assert/strict';
import test from 'node:test';

import { shrinkAnnotationReferenceShadow } from '../dist/services/annotationReferences.js';

function createAnnotation({
  id,
  targetKind,
  targetId,
  notes = null,
  externalUrls = [],
  internalRefs = [],
  updatedAt = new Date('2026-03-02T00:00:00.000Z'),
  updatedBy = 'updater-1',
}) {
  return {
    id,
    targetKind,
    targetId,
    notes,
    externalUrls,
    internalRefs,
    updatedAt,
    updatedBy,
  };
}

function createExternalLink(targetKind, targetId, value) {
  return {
    targetKind,
    targetId,
    linkKind: 'external_url',
    refKind: '',
    value,
    label: null,
    updatedAt: new Date('2026-03-03T00:00:00.000Z'),
    updatedBy: 'ref-author',
  };
}

function createInternalLink(targetKind, targetId, refKind, value, label) {
  return {
    targetKind,
    targetId,
    linkKind: 'internal_ref',
    refKind,
    value,
    label: label ?? null,
    updatedAt: new Date('2026-03-03T00:00:00.000Z'),
    updatedBy: 'ref-author',
  };
}

function createPagedAnnotationFindMany(rows) {
  return async ({ where, take }) => {
    const cursorId =
      where?.id?.gt ??
      where?.AND?.find?.((entry) => entry?.id?.gt)?.id?.gt ??
      null;
    const startIndex = cursorId
      ? rows.findIndex((row) => row.id === cursorId) + 1
      : 0;
    if (startIndex <= 0 && cursorId) return [];
    return rows.slice(startIndex, startIndex + take);
  };
}

test('shrinkAnnotationReferenceShadow: dry-run counts only targets fully covered by reference links', async () => {
  const client = {
    annotation: {
      findMany: createPagedAnnotationFindMany([
        createAnnotation({
          id: 'ann-1',
          targetKind: 'invoice',
          targetId: 'inv-1',
          externalUrls: ['https://example.com/a'],
          internalRefs: [{ kind: 'room_chat', id: 'room-1', label: 'Room 1' }],
        }),
        createAnnotation({
          id: 'ann-2',
          targetKind: 'invoice',
          targetId: 'inv-2',
          externalUrls: ['https://example.com/b'],
          internalRefs: [],
        }),
        createAnnotation({
          id: 'ann-3',
          targetKind: 'invoice',
          targetId: 'inv-3',
          externalUrls: [],
          internalRefs: [],
        }),
      ]),
    },
    referenceLink: {
      findMany: async () => [
        createExternalLink('invoice', 'inv-1', 'https://example.com/a'),
        createInternalLink('invoice', 'inv-1', 'room_chat', 'room-1', 'Room 1'),
        createExternalLink('invoice', 'inv-2', 'https://example.com/other'),
      ],
    },
  };

  const summary = await shrinkAnnotationReferenceShadow(client, {
    dryRun: true,
    batchSize: 10,
  });

  assert.equal(summary.scannedTargets, 3);
  assert.equal(summary.candidateTargets, 1);
  assert.equal(summary.clearedTargets, 0);
  assert.equal(summary.skippedDivergedTargets, 1);
  assert.equal(summary.skippedEmptyTargets, 1);
  assert.equal(summary.skippedNoReferenceLinks, 0);
});

test('shrinkAnnotationReferenceShadow: omitted dryRun stays in dry-run mode without update', async () => {
  const client = {
    annotation: {
      findMany: createPagedAnnotationFindMany([
        createAnnotation({
          id: 'ann-1',
          targetKind: 'invoice',
          targetId: 'inv-1',
          externalUrls: ['https://example.com/a'],
        }),
      ]),
    },
    referenceLink: {
      findMany: async () => [
        createExternalLink('invoice', 'inv-1', 'https://example.com/a'),
      ],
    },
  };

  const summary = await shrinkAnnotationReferenceShadow(client, {
    batchSize: 10,
  });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.candidateTargets, 1);
  assert.equal(summary.clearedTargets, 0);
});

test('shrinkAnnotationReferenceShadow: apply clears shadow JSON when reference links are authoritative', async () => {
  const updates = [];
  const client = {
    annotation: {
      findMany: createPagedAnnotationFindMany([
        createAnnotation({
          id: 'ann-1',
          targetKind: 'invoice',
          targetId: 'inv-1',
          externalUrls: ['https://example.com/a'],
          internalRefs: [
            { kind: 'project_chat', id: 'room-1', label: 'Legacy room' },
          ],
          updatedBy: 'author-1',
        }),
      ]),
      update: async ({ where, data }) => {
        updates.push({ where, data });
        return { id: where.id };
      },
    },
    referenceLink: {
      findMany: async () => [
        createExternalLink('invoice', 'inv-1', 'https://example.com/a'),
        createInternalLink(
          'invoice',
          'inv-1',
          'room_chat',
          'room-1',
          'Legacy room',
        ),
      ],
    },
  };

  const summary = await shrinkAnnotationReferenceShadow(client, {
    dryRun: false,
    batchSize: 10,
  });

  assert.equal(summary.candidateTargets, 1);
  assert.equal(summary.clearedTargets, 1);
  assert.equal(summary.clearedLinks, 2);
  assert.deepEqual(updates, [
    {
      where: { id: 'ann-1' },
      data: {
        externalUrls: [],
        internalRefs: [],
        updatedBy: null,
      },
    },
  ]);
});

test('shrinkAnnotationReferenceShadow: limitTargets caps scanned rows', async () => {
  const updates = [];
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
      update: async ({ where, data }) => {
        updates.push({ where, data });
        return { id: where.id };
      },
    },
    referenceLink: {
      findMany: async () => [],
    },
  };

  const summary = await shrinkAnnotationReferenceShadow(client, {
    dryRun: false,
    batchSize: 5,
    limitTargets: 1,
  });

  assert.equal(summary.scannedTargets, 1);
  assert.equal(summary.skippedNoReferenceLinks, 1);
  assert.equal(summary.clearedTargets, 0);
  assert.equal(updates.length, 0);
});
