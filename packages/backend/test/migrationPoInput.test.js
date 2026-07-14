import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { makePoMigrationId } from '../dist/migration/legacyIds.js';
import {
  decodePoMigrationBytes,
  ensureNoDuplicates,
  normalizeLines,
  normalizeString,
  parseCsvBoolean,
  parseCsvItems,
  parseCsvJsonArray,
  parseDate,
  parseEnumValue,
  parseNumber,
  parsePoCsvRecords,
  parsePoJson,
} from '../dist/migration/poInput.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('po input pure modules do not depend on IO, Prisma, process, console, or random sources', () => {
  for (const sourcePath of [
    'packages/backend/src/migration/poInput.ts',
    'packages/backend/src/migration/legacyIds.ts',
  ]) {
    const source = readSource(sourcePath);
    assert.doesNotMatch(
      source,
      /from ['"]node:fs['"]|from ['"]fs['"]|require\(['"]fs['"]\)/,
    );
    assert.doesNotMatch(source, /@prisma\/client|\bPrismaClient\b|\bprisma\b/i);
    assert.doesNotMatch(source, /\bprocess\b/);
    assert.doesNotMatch(source, /\bconsole\b/);
    assert.doesNotMatch(source, /Date\.now\s*\(/);
    assert.doesNotMatch(source, /randomUUID\s*\(/);
    assert.doesNotMatch(source, /Math\.random\s*\(/);
  }
});

test('decodePoMigrationBytes preserves UTF-8 text and BOM without filesystem access', () => {
  const raw = '\uFEFFlegacyId,name\npo-1,ACME\n';
  const encoded = Buffer.from(raw, 'utf8');

  assert.equal(decodePoMigrationBytes(encoded), raw);
  assert.equal(decodePoMigrationBytes(raw), raw);
  assert.throws(
    () => decodePoMigrationBytes(encoded, 'cp932'),
    /unsupported PO migration input encoding: cp932/,
  );
  assert.throws(
    () => decodePoMigrationBytes(raw, 'cp932'),
    /unsupported PO migration input encoding: cp932/,
  );
});

test('parsePoJson delegates strict JSON parsing for fixture data', () => {
  assert.deepEqual(parsePoJson('{"legacyId":"po-1","lines":[1]}'), {
    legacyId: 'po-1',
    lines: [1],
  });
  assert.throws(() => parsePoJson('{legacyId:"po-1"}'), SyntaxError);
});

test('parsePoCsvRecords normalizes BOM, CRLF, quotes, multiline cells, and blank rows', () => {
  const errors = [];
  const raw =
    '\uFEFFlegacyId,name,active,lines\r\n' +
    '"po-1","  ACME ""X""\nline  ",yes,"[{""description"":""A"",""quantity"":2}]"\r\n' +
    ',,,\r\n';

  assert.deepEqual(
    parsePoCsvRecords(raw, 'purchaseOrders', 'purchaseOrders.csv', errors),
    [
      {
        legacyId: 'po-1',
        name: 'ACME "X"\nline',
        active: 'yes',
        lines: '[{"description":"A","quantity":2}]',
      },
    ],
  );
  assert.deepEqual(errors, []);
});

test('parsePoCsvRecords skips all-empty rows before header parsing', () => {
  const errors = [];

  assert.deepEqual(
    parsePoCsvRecords(
      ',,\nlegacyId,email\nu-1,user@example.com\n',
      'users',
      'users.csv',
      errors,
    ),
    [{ legacyId: 'u-1', email: 'user@example.com' }],
  );
  assert.deepEqual(errors, []);
});

test('parsePoCsvRecords returns empty records for blank and header-only CSV', () => {
  const errors = [];

  assert.deepEqual(parsePoCsvRecords('', 'users', 'users.csv', errors), []);
  assert.deepEqual(
    parsePoCsvRecords('legacyId,email\n', 'users', 'users.csv', errors),
    [],
  );
  assert.deepEqual(errors, []);
});

test('parseCsvItems preserves scope, legacyId, required-field errors, and post-processing', () => {
  const errors = [];
  const records = [
    { legacyId: 'u-1', email: 'user@example.com', active: 'yes' },
    { legacyId: 'u-2', email: null, active: 'no' },
  ];

  const items = parseCsvItems(
    'users',
    records,
    ['legacyId', 'email'],
    errors,
    (item, record) => {
      item.active = parseCsvBoolean(record.active);
    },
  );

  assert.deepEqual(items, [
    { legacyId: 'u-1', email: 'user@example.com', active: true },
  ]);
  assert.deepEqual(errors, [
    {
      scope: 'users',
      legacyId: 'u-2',
      message: 'missing required field: email',
    },
  ]);
});

test('parseCsvJsonArray accepts JSON arrays and records non-array or malformed fields', () => {
  const errors = [];

  assert.deepEqual(
    parseCsvJsonArray('documents', 'd-1', '[{"id":1}]', errors),
    [{ id: 1 }],
  );
  assert.equal(parseCsvJsonArray('documents', 'd-2', '{"id":1}', errors), null);
  assert.equal(parseCsvJsonArray('documents', 'd-3', '[', errors), null);
  assert.equal(parseCsvJsonArray('documents', 'd-4', null, errors), null);

  assert.equal(errors.length, 2);
  assert.deepEqual(errors[0], {
    scope: 'documents',
    legacyId: 'd-2',
    message: 'CSV lines must be a JSON array',
  });
  assert.equal(errors[1].scope, 'documents');
  assert.equal(errors[1].legacyId, 'd-3');
  assert.match(errors[1].message, /^failed to parse CSV JSON field:/);
});

test('scalar parsers preserve migrate-po normalization semantics', () => {
  assert.ok(parseDate('2026-07-14') instanceof Date);
  assert.equal(parseDate('not-a-date'), null);
  assert.equal(parseDate('   '), null);
  assert.equal(parseDate(123), null);

  assert.equal(parseNumber(' -12.5 '), -12.5);
  assert.equal(parseNumber('0'), 0);
  assert.equal(parseNumber(''), 0);
  assert.equal(parseNumber('not-a-number'), null);
  assert.equal(parseNumber(null), null);

  assert.equal(
    parseEnumValue('active', ['draft', 'active'], 'draft'),
    'active',
  );
  assert.equal(
    parseEnumValue('missing', ['draft', 'active'], 'draft'),
    'draft',
  );
  assert.equal(parseEnumValue(null, ['draft', 'active'], 'draft'), 'draft');

  assert.equal(normalizeString('  value  '), 'value');
  assert.equal(normalizeString('   '), null);
  assert.equal(normalizeString(1), null);

  assert.deepEqual(normalizeLines([null, { id: 1 }, undefined, { id: 2 }]), [
    { id: 1 },
    { id: 2 },
  ]);
  assert.deepEqual(normalizeLines(null), []);
});

test('ensureNoDuplicates reports duplicate legacyId and code without side effects', () => {
  const errors = [];

  ensureNoDuplicates(
    [
      { legacyId: 'c-1', code: 'ACME' },
      { legacyId: 'c-1', code: 'BETA' },
      { legacyId: 'c-2', code: 'ACME' },
    ],
    'customers',
    errors,
  );

  assert.deepEqual(errors, [
    {
      scope: 'customers',
      legacyId: 'c-1',
      message: 'duplicate legacyId',
    },
    {
      scope: 'customers',
      legacyId: 'c-2',
      message: 'duplicate code: ACME',
    },
  ]);
});

test('makePoMigrationId keeps deterministic UUIDv5 output for legacy IDs', () => {
  assert.equal(
    makePoMigrationId('customer', '123'),
    '292aceb7-d60f-5bfb-8a0c-4f57be274189',
  );
  assert.equal(
    makePoMigrationId('vendor', '123'),
    'b30c9c7d-5d7f-5ac2-b26a-9dc2cade5c59',
  );
  assert.equal(
    makePoMigrationId('customer', '123'),
    makePoMigrationId('customer', '123'),
  );
  assert.notEqual(
    makePoMigrationId('customer', '123'),
    makePoMigrationId('customer', '124'),
  );
});
