import assert from 'node:assert/strict';
import test from 'node:test';

import { formatCsvValue, toCsv } from '../dist/utils/csv.js';

test('formatCsvValue neutralizes spreadsheet formula prefixes', () => {
  assert.equal(formatCsvValue('=SUM(A1:A2)'), "'=SUM(A1:A2)");
  assert.equal(formatCsvValue('+cmd'), "'+cmd");
  assert.equal(formatCsvValue('-cmd'), "'-cmd");
  assert.equal(formatCsvValue('@cmd'), "'@cmd");
  assert.equal(formatCsvValue(' normal'), ' normal');
});

test('toCsv neutralizes formula-like data cells while preserving quoting', () => {
  const csv = toCsv(
    ['name', 'value'],
    [
      ['account', '=1+1'],
      ['memo', 'x,y'],
    ],
  );
  assert.match(csv, /account,'=1\+1/);
  assert.match(csv, /memo,\"x,y\"/);
});
