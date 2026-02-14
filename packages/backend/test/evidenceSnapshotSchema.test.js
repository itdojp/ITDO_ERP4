import assert from 'node:assert/strict';
import test from 'node:test';

import { Value } from '@sinclair/typebox/value';

import {
  evidencePackExportQuerySchema,
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

test('evidencePackExportQuerySchema: accepts json format with version', () => {
  const ok = Value.Check(evidencePackExportQuerySchema.querystring, {
    format: 'json',
    version: 1,
    mask: 1,
  });
  assert.equal(ok, true);
});

test('evidencePackExportQuerySchema: accepts pdf format', () => {
  const ok = Value.Check(evidencePackExportQuerySchema.querystring, {
    format: 'pdf',
    version: 2,
    mask: 0,
  });
  assert.equal(ok, true);
});

test('evidencePackExportQuerySchema: rejects invalid format', () => {
  const ok = Value.Check(evidencePackExportQuerySchema.querystring, {
    format: 'csv',
  });
  assert.equal(ok, false);
});

test('evidencePackExportQuerySchema: rejects invalid mask', () => {
  const ok = Value.Check(evidencePackExportQuerySchema.querystring, {
    format: 'json',
    mask: 2,
  });
  assert.equal(ok, false);
});
