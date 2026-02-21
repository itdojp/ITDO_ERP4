import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasExpenseBudgetEscalationFields,
  missingExpenseBudgetEscalationFields,
} from '../dist/services/expenseBudget.js';

test('hasExpenseBudgetEscalationFields: true when reason/impact/alternative are all set', () => {
  const ok = hasExpenseBudgetEscalationFields({
    id: 'exp-1',
    projectId: 'proj-1',
    amount: 1000,
    currency: 'JPY',
    incurredOn: new Date('2026-02-01T00:00:00.000Z'),
    status: 'draft',
    budgetEscalationReason: 'overrun reason',
    budgetEscalationImpact: 'impact text',
    budgetEscalationAlternative: 'alternative text',
  });
  assert.equal(ok, true);
});

test('hasExpenseBudgetEscalationFields: false when any field is missing', () => {
  const ok = hasExpenseBudgetEscalationFields({
    id: 'exp-2',
    projectId: 'proj-1',
    amount: 1000,
    currency: 'JPY',
    incurredOn: new Date('2026-02-01T00:00:00.000Z'),
    status: 'draft',
    budgetEscalationReason: 'reason only',
    budgetEscalationImpact: '',
    budgetEscalationAlternative: null,
  });
  assert.equal(ok, false);
});

test('missingExpenseBudgetEscalationFields: returns missing field names', () => {
  const missing = missingExpenseBudgetEscalationFields({
    id: 'exp-3',
    projectId: 'proj-1',
    amount: 1000,
    currency: 'JPY',
    incurredOn: new Date('2026-02-01T00:00:00.000Z'),
    status: 'draft',
    budgetEscalationReason: 'reason only',
    budgetEscalationImpact: ' ',
    budgetEscalationAlternative: null,
  });
  assert.deepEqual(missing, [
    'budgetEscalationImpact',
    'budgetEscalationAlternative',
  ]);
});
