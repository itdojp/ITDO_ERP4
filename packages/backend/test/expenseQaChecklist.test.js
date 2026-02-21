import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isExpenseQaChecklistComplete,
  normalizeExpenseQaChecklist,
} from '../dist/services/expenseQaChecklist.js';

test('isExpenseQaChecklistComplete: returns false when checklist is missing', () => {
  assert.equal(isExpenseQaChecklistComplete(null), false);
  assert.equal(isExpenseQaChecklistComplete(undefined), false);
});

test('normalizeExpenseQaChecklist: fills missing fields with false', () => {
  const normalized = normalizeExpenseQaChecklist({
    amountVerified: true,
    journalPrepared: true,
  });
  assert.deepEqual(normalized, {
    amountVerified: true,
    receiptVerified: false,
    journalPrepared: true,
    projectLinked: false,
    budgetChecked: false,
  });
});

test('isExpenseQaChecklistComplete: returns true only when all checks are true', () => {
  assert.equal(
    isExpenseQaChecklistComplete({
      amountVerified: true,
      receiptVerified: true,
      journalPrepared: true,
      projectLinked: true,
      budgetChecked: true,
    }),
    true,
  );
  assert.equal(
    isExpenseQaChecklistComplete({
      amountVerified: true,
      receiptVerified: true,
      journalPrepared: false,
      projectLinked: true,
      budgetChecked: true,
    }),
    false,
  );
});
