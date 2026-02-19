import assert from 'node:assert/strict';
import test from 'node:test';

import Fastify from 'fastify';

import {
  expenseCommentCreateSchema,
  expenseSchema,
} from '../dist/routes/validators.js';

async function buildValidatorServer(path, schema) {
  const app = Fastify();
  app.post(path, { schema }, async (req) => req.body);
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
