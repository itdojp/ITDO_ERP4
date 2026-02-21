import assert from 'node:assert/strict';
import test from 'node:test';

import Fastify from 'fastify';

import {
  buildExpenseCreateDraft,
  hasExpenseSubmitEvidence,
} from '../dist/routes/expenses.js';
import {
  expenseBudgetEscalationSchema,
  expenseCommentCreateSchema,
  expenseQaChecklistPatchSchema,
  expenseSubmitSchema,
  expenseSchema,
} from '../dist/routes/validators.js';

async function buildValidatorServer(path, schema) {
  const app = Fastify();
  app.post(path, { schema }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

test('expenseSchema: accepts lines and attachments payload', async () => {
  const app = await buildValidatorServer('/validate/expense', expenseSchema);
  const res = await app.inject({
    method: 'POST',
    url: '/validate/expense',
    payload: {
      projectId: 'project-1',
      userId: 'user-1',
      category: 'travel',
      amount: 1100,
      currency: 'JPY',
      incurredOn: '2026-02-19',
      lines: [
        {
          lineNo: 1,
          expenseDate: '2026-02-19',
          description: 'taxi',
          amount: 1000,
          taxRate: 10,
          taxAmount: 100,
          currency: 'JPY',
        },
      ],
      attachments: [
        {
          fileUrl: 'https://example.com/receipt.pdf',
          fileName: 'receipt.pdf',
          contentType: 'application/pdf',
          fileSizeBytes: 2048,
          fileHash: 'sha256:abc123',
        },
      ],
    },
  });

  assert.equal(res.statusCode, 200);
  await app.close();
});

test('expenseSchema: keeps backward-compatible lines payload', async () => {
  const app = await buildValidatorServer('/validate/expense', expenseSchema);
  const res = await app.inject({
    method: 'POST',
    url: '/validate/expense',
    payload: {
      projectId: 'project-1',
      userId: 'user-1',
      category: 'travel',
      amount: 1000,
      currency: 'JPY',
      incurredOn: '2026-02-19',
      lines: [
        {
          lineNo: 1,
          amount: 1000,
        },
      ],
    },
  });

  assert.equal(res.statusCode, 200);
  await app.close();
});

test('expenseCommentCreateSchema: accepts kind/body', async () => {
  const app = await buildValidatorServer(
    '/validate/comment',
    expenseCommentCreateSchema,
  );
  const res = await app.inject({
    method: 'POST',
    url: '/validate/comment',
    payload: {
      kind: 'review',
      body: 'receipt checked',
    },
  });

  assert.equal(res.statusCode, 200);
  await app.close();
});

test('expenseCommentCreateSchema: rejects empty body', async () => {
  const app = await buildValidatorServer(
    '/validate/comment',
    expenseCommentCreateSchema,
  );
  const res = await app.inject({
    method: 'POST',
    url: '/validate/comment',
    payload: {
      kind: 'review',
      body: '',
    },
  });

  assert.equal(res.statusCode, 400);
  await app.close();
});

test('expenseQaChecklistPatchSchema: accepts partial payload', async () => {
  const app = await buildValidatorServer(
    '/validate/expense-qa-checklist',
    expenseQaChecklistPatchSchema,
  );
  const res = await app.inject({
    method: 'POST',
    url: '/validate/expense-qa-checklist',
    payload: {
      receiptVerified: true,
      notes: 'e2e checklist',
    },
  });

  assert.equal(res.statusCode, 200);
  await app.close();
});

test('expenseQaChecklistPatchSchema: rejects empty payload', async () => {
  const app = await buildValidatorServer(
    '/validate/expense-qa-checklist',
    expenseQaChecklistPatchSchema,
  );
  const res = await app.inject({
    method: 'POST',
    url: '/validate/expense-qa-checklist',
    payload: {},
  });

  assert.equal(res.statusCode, 400);
  await app.close();
});

test('expenseSubmitSchema: accepts escalation fields payload', async () => {
  const app = await buildValidatorServer(
    '/validate/expense-submit',
    expenseSubmitSchema,
  );
  const res = await app.inject({
    method: 'POST',
    url: '/validate/expense-submit',
    payload: {
      reasonText: 'submit',
      budgetEscalationReason: '予算超過理由',
      budgetEscalationImpact: '影響',
      budgetEscalationAlternative: '代替案',
    },
  });

  assert.equal(res.statusCode, 200);
  await app.close();
});

test('expenseBudgetEscalationSchema: rejects empty payload', async () => {
  const app = await buildValidatorServer(
    '/validate/expense-budget-escalation',
    expenseBudgetEscalationSchema,
  );
  const res = await app.inject({
    method: 'POST',
    url: '/validate/expense-budget-escalation',
    payload: {},
  });

  assert.equal(res.statusCode, 400);
  await app.close();
});

test('buildExpenseCreateDraft: rejects duplicated lineNo', () => {
  const result = buildExpenseCreateDraft({
    body: {
      projectId: 'project-1',
      userId: 'user-1',
      category: 'travel',
      amount: 1000,
      currency: 'JPY',
      incurredOn: '2026-02-19',
      lines: [
        {
          lineNo: 1,
          description: 'taxi',
          amount: 500,
          currency: 'JPY',
        },
        {
          lineNo: 1,
          description: 'train',
          amount: 500,
          currency: 'JPY',
        },
      ],
    },
    actorUserId: 'user-1',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'INVALID_LINE');
  assert.equal(result.error.message, 'lines[1].lineNo is duplicated');
});

test('buildExpenseCreateDraft: rejects when lines total mismatches amount', () => {
  const result = buildExpenseCreateDraft({
    body: {
      projectId: 'project-1',
      userId: 'user-1',
      category: 'travel',
      amount: 1000,
      currency: 'JPY',
      incurredOn: '2026-02-19',
      lines: [
        {
          lineNo: 1,
          description: 'taxi',
          amount: 900,
          currency: 'JPY',
        },
      ],
    },
    actorUserId: 'user-1',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'INVALID_AMOUNT');
  assert.equal(result.error.message, 'sum(lines.amount) must match amount');
});

test('buildExpenseCreateDraft: rejects empty attachment fileUrl', () => {
  const result = buildExpenseCreateDraft({
    body: {
      projectId: 'project-1',
      userId: 'user-1',
      category: 'travel',
      amount: 1000,
      currency: 'JPY',
      incurredOn: '2026-02-19',
      attachments: [
        {
          fileUrl: '   ',
        },
      ],
    },
    actorUserId: 'user-1',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'INVALID_ATTACHMENT');
  assert.equal(result.error.message, 'attachments[0].fileUrl is required');
});

test('buildExpenseCreateDraft: validates amount even when lines are omitted', () => {
  const result = buildExpenseCreateDraft({
    body: {
      projectId: 'project-1',
      userId: 'user-1',
      category: 'travel',
      amount: -1,
      currency: 'JPY',
      incurredOn: '2026-02-19',
    },
    actorUserId: 'user-1',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'INVALID_AMOUNT');
  assert.equal(result.error.message, 'amount is invalid');
});

test('hasExpenseSubmitEvidence: true when receiptUrl exists', () => {
  const ok = hasExpenseSubmitEvidence({
    receiptUrl: 'https://example.com/legacy-receipt.pdf',
    attachmentCount: 0,
  });
  assert.equal(ok, true);
});

test('hasExpenseSubmitEvidence: true when attachments exist', () => {
  const ok = hasExpenseSubmitEvidence({
    receiptUrl: null,
    attachmentCount: 2,
  });
  assert.equal(ok, true);
});

test('hasExpenseSubmitEvidence: false when no receipt evidence exists', () => {
  const ok = hasExpenseSubmitEvidence({
    receiptUrl: '   ',
    attachmentCount: 0,
  });
  assert.equal(ok, false);
});
