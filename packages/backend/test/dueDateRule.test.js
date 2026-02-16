import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeDueDate,
  parseDueDateRule,
} from '../dist/services/dueDateRule.js';

test('parseDueDateRule: null/undefined returns null', () => {
  assert.equal(parseDueDateRule(null), null);
  assert.equal(parseDueDateRule(undefined), null);
});

test('parseDueDateRule: invalid payload throws', () => {
  assert.throws(() => parseDueDateRule('x'), /invalid_due_date_rule/);
  assert.throws(() => parseDueDateRule({}), /invalid_due_date_rule/);
  assert.throws(
    () => parseDueDateRule({ type: 'periodEndPlusOffset', offsetDays: 1.2 }),
    /invalid_due_date_rule/,
  );
  assert.throws(
    () => parseDueDateRule({ type: 'periodEndPlusOffset', offsetDays: 366 }),
    /invalid_due_date_rule/,
  );
});

test('parseDueDateRule: accepts numeric string and boundaries', () => {
  assert.deepEqual(
    parseDueDateRule({ type: 'periodEndPlusOffset', offsetDays: 0 }),
    {
      type: 'periodEndPlusOffset',
      offsetDays: 0,
    },
  );
  assert.deepEqual(
    parseDueDateRule({ type: 'periodEndPlusOffset', offsetDays: '0' }),
    {
      type: 'periodEndPlusOffset',
      offsetDays: 0,
    },
  );
  assert.deepEqual(
    parseDueDateRule({ type: 'periodEndPlusOffset', offsetDays: '365' }),
    {
      type: 'periodEndPlusOffset',
      offsetDays: 365,
    },
  );
});

test('computeDueDate: end of month + offset', () => {
  const runAt = new Date(2026, 0, 15, 12, 0, 0);
  const rule = { type: 'periodEndPlusOffset', offsetDays: 0 };
  const result = computeDueDate(runAt, rule);
  assert.ok(result);
  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 0);
  assert.equal(result.getDate(), 31);
  assert.equal(result.getHours(), 23);
  assert.equal(result.getMinutes(), 59);
});

test('computeDueDate: offset moves to next month', () => {
  const runAt = new Date(2026, 0, 15, 12, 0, 0);
  const rule = { type: 'periodEndPlusOffset', offsetDays: 1 };
  const result = computeDueDate(runAt, rule);
  assert.ok(result);
  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 1);
  assert.equal(result.getDate(), 1);
});

test('computeDueDate: max offset can cross year boundary', () => {
  const runAt = new Date(2026, 11, 5, 10, 0, 0);
  const rule = { type: 'periodEndPlusOffset', offsetDays: 365 };
  const result = computeDueDate(runAt, rule);
  assert.ok(result);
  assert.equal(result.getFullYear(), 2027);
  assert.equal(result.getMonth(), 11);
  assert.equal(result.getDate(), 31);
  assert.equal(result.getHours(), 23);
  assert.equal(result.getMinutes(), 59);
});

test('computeDueDate: leap year February end is handled correctly', () => {
  const runAt = new Date(2024, 1, 10, 8, 0, 0);
  const rule = { type: 'periodEndPlusOffset', offsetDays: 0 };
  const result = computeDueDate(runAt, rule);
  assert.ok(result);
  assert.equal(result.getFullYear(), 2024);
  assert.equal(result.getMonth(), 1);
  assert.equal(result.getDate(), 29);
  assert.equal(result.getHours(), 23);
  assert.equal(result.getMinutes(), 59);
});
