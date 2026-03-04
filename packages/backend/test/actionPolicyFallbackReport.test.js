import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateRows,
  parseOptionsFromArgv,
} from '../../../scripts/report-action-policy-fallback-allowed.mjs';

test('parseOptionsFromArgv: defaults to last 24h text format', () => {
  const now = new Date('2026-03-01T12:00:00.000Z');
  const options = parseOptionsFromArgv([], now);
  assert.equal(options.format, 'text');
  assert.equal(options.take, 1000);
  assert.equal(options.to.toISOString(), '2026-03-01T12:00:00.000Z');
  assert.equal(options.from.toISOString(), '2026-02-28T12:00:00.000Z');
});

test('parseOptionsFromArgv: validates format and time range', () => {
  assert.throws(
    () => parseOptionsFromArgv(['--format=csv']),
    /format must be text or json/,
  );
  assert.throws(
    () =>
      parseOptionsFromArgv([
        '--from=2026-03-01T10:00:00.000Z',
        '--to=2026-03-01T10:00:00.000Z',
      ]),
    /from must be earlier than to/,
  );
});

test('aggregateRows: groups by flowType/actionKey/targetTable and tracks bounds', () => {
  const rows = [
    {
      id: 'a1',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      targetTable: 'invoices',
      targetId: 'inv-1',
      metadata: { flowType: 'invoice', actionKey: 'send', targetTable: 'invoices' },
    },
    {
      id: 'a2',
      createdAt: new Date('2026-03-01T01:00:00.000Z'),
      targetTable: 'invoices',
      targetId: 'inv-2',
      metadata: { flowType: 'invoice', actionKey: 'send' },
    },
    {
      id: 'a3',
      createdAt: new Date('2026-03-01T02:00:00.000Z'),
      targetTable: 'leave_requests',
      targetId: 'leave-1',
      metadata: { flowType: 'leave', actionKey: 'submit', targetTable: 'leave_requests' },
    },
  ];

  const result = aggregateRows(rows);
  assert.deepEqual(result.totals, { events: 3, uniqueKeys: 2 });

  const invoice = result.keys.find(
    (row) =>
      row.flowType === 'invoice' &&
      row.actionKey === 'send' &&
      row.targetTable === 'invoices',
  );
  assert.ok(invoice);
  assert.equal(invoice.count, 2);
  assert.equal(invoice.firstSeen, '2026-03-01T00:00:00.000Z');
  assert.equal(invoice.lastSeen, '2026-03-01T01:00:00.000Z');
  assert.equal(invoice.sampleTargetId, 'inv-1');
});
