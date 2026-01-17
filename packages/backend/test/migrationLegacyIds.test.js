import assert from 'node:assert/strict';
import test from 'node:test';
import { makePoMigrationId } from '../dist/migration/legacyIds.js';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test('makePoMigrationId: deterministic and valid uuid', () => {
  const first = makePoMigrationId('customer', '123');
  const second = makePoMigrationId('customer', '123');
  assert.match(first, uuidPattern);
  assert.equal(first, second);
});

test('makePoMigrationId: kind is part of the name', () => {
  const a = makePoMigrationId('customer', '123');
  const b = makePoMigrationId('vendor', '123');
  assert.notEqual(a, b);
});

test('makePoMigrationId: legacyId affects output', () => {
  const a = makePoMigrationId('customer', '123');
  const b = makePoMigrationId('customer', '124');
  assert.notEqual(a, b);
});

