import assert from 'node:assert/strict';
import test from 'node:test';

import Fastify from 'fastify';

import { buildExpenseCreateDraft } from '../dist/routes/expenses.js';
import {
  expenseCommentCreateSchema,
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

test('expenseSchema: rejects line without description', async () => {
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

  assert.equal(res.statusCode, 400);
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
  assert.equal(
    result.error.message,
    'attachments[0].fileUrl is required',
  );
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
