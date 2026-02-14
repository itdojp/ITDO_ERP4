import assert from 'node:assert/strict';
import test from 'node:test';

import { Value } from '@sinclair/typebox/value';

import {
  evidenceSnapshotCreateSchema,
  evidenceSnapshotHistoryQuerySchema,
} from '../dist/routes/validators.js';

test('evidenceSnapshotCreateSchema: accepts forceRegenerate with reasonText', () => {
  const ok = Value.Check(evidenceSnapshotCreateSchema.body, {
    forceRegenerate: true,
    reasonText: 'regenerate evidence snapshot',
  });
  assert.equal(ok, true);
});

test('evidenceSnapshotCreateSchema: rejects too long reasonText', () => {
  const ok = Value.Check(evidenceSnapshotCreateSchema.body, {
    forceRegenerate: true,
    reasonText: 'a'.repeat(2001),
  });
  assert.equal(ok, false);
});

test('evidenceSnapshotHistoryQuerySchema: accepts valid limit', () => {
  const ok = Value.Check(evidenceSnapshotHistoryQuerySchema.querystring, {
    limit: 50,
  });
  assert.equal(ok, true);
});

test('evidenceSnapshotHistoryQuerySchema: rejects out-of-range limit', () => {
  const low = Value.Check(evidenceSnapshotHistoryQuerySchema.querystring, {
    limit: 0,
  });
  const high = Value.Check(evidenceSnapshotHistoryQuerySchema.querystring, {
    limit: 101,
  });
  assert.equal(low, false);
  assert.equal(high, false);
});
