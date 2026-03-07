import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadResolvedAnnotationReferenceState,
  replaceReferenceLinks,
} from '../dist/services/annotationReferences.js';

test('replaceReferenceLinks: throws when deleteMany is unavailable', async () => {
  await assert.rejects(
    replaceReferenceLinks(
      { referenceLink: {} },
      'invoice',
      'inv-1',
      ['https://example.com/a'],
      [],
      'actor-1',
    ),
    /referenceLink_deleteMany_not_available/,
  );
});

test('replaceReferenceLinks: throws when writer APIs are unavailable', async () => {
  await assert.rejects(
    replaceReferenceLinks(
      {
        referenceLink: {
          deleteMany: async () => ({ count: 1 }),
        },
      },
      'invoice',
      'inv-1',
      ['https://example.com/a'],
      [],
      'actor-1',
    ),
    /referenceLink_writer_not_available/,
  );
});

test('loadResolvedAnnotationReferenceState: throws when reference link reader is unavailable', async () => {
  await assert.rejects(
    loadResolvedAnnotationReferenceState(
      {
        annotation: {
          findUnique: async () => ({
            notes: 'note',
            externalUrls: ['https://legacy.example.com/a'],
            internalRefs: [],
            updatedAt: new Date('2026-03-06T00:00:00.000Z'),
            updatedBy: 'author-1',
          }),
        },
        referenceLink: {},
      },
      'invoice',
      'inv-1',
    ),
    /annotation_reference_links_unavailable/,
  );
});

test('loadResolvedAnnotationReferenceState: throws deterministic error when table is missing', async () => {
  await assert.rejects(
    loadResolvedAnnotationReferenceState(
      {
        annotation: {
          findUnique: async () => ({
            notes: 'note',
            externalUrls: [],
            internalRefs: [],
            updatedAt: new Date('2026-03-06T00:00:00.000Z'),
            updatedBy: 'author-1',
          }),
        },
        referenceLink: {
          findMany: async () => {
            const error = new Error('relation "ReferenceLink" does not exist');
            error.code = 'P2021';
            throw error;
          },
        },
      },
      'invoice',
      'inv-1',
    ),
    /annotation_reference_links_unavailable/,
  );
});
