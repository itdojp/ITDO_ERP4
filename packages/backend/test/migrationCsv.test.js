import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCsvBoolean, parseCsvRaw } from '../dist/migration/csv.js';

test('parseCsvRaw: basic csv', () => {
  assert.deepEqual(parseCsvRaw('a,b\nc,d\n'), [
    ['a', 'b'],
    ['c', 'd'],
  ]);
});

test('parseCsvRaw: quoted fields and escaped quotes', () => {
  assert.deepEqual(parseCsvRaw('"a,1","b""2"\n"x","y"\n'), [
    ['a,1', 'b"2'],
    ['x', 'y'],
  ]);
});

test('parseCsvRaw: supports CRLF and skips empty rows', () => {
  assert.deepEqual(parseCsvRaw('a,b\r\n\r\nc,d\r\n'), [
    ['a', 'b'],
    ['c', 'd'],
  ]);
});

test('parseCsvRaw: strips UTF-8 BOM', () => {
  const bom = '\uFEFF';
  assert.deepEqual(parseCsvRaw(`${bom}a,b\nc,d\n`), [
    ['a', 'b'],
    ['c', 'd'],
  ]);
});

test('parseCsvBoolean: parses common values', () => {
  assert.equal(parseCsvBoolean(null), undefined);
  assert.equal(parseCsvBoolean(''), undefined);
  assert.equal(parseCsvBoolean('1'), true);
  assert.equal(parseCsvBoolean('true'), true);
  assert.equal(parseCsvBoolean('yes'), true);
  assert.equal(parseCsvBoolean('0'), false);
  assert.equal(parseCsvBoolean('false'), false);
  assert.equal(parseCsvBoolean('no'), false);
  assert.equal(parseCsvBoolean('unknown'), undefined);
});

