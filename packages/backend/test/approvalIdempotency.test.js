import assert from 'node:assert/strict';
import test from 'node:test';

import { createApprovalFor } from '../dist/services/approval.js';

test('createApprovalFor: returns existing open approval instance', async () => {
  const existing = { id: 'a1', status: 'pending_qa', steps: [] };
  const calls = { create: 0 };
  const fakeClient = {
    approvalRule: { findMany: async () => [] },
    project: { findUnique: async () => null },
    approvalInstance: {
      findFirst: async () => existing,
      create: async () => {
        calls.create += 1;
        return { id: 'unexpected' };
      },
    },
  };

  const approval = await createApprovalFor(
    'invoice',
    'invoices',
    'inv1',
    { totalAmount: 1000 },
    { client: fakeClient },
  );
  assert.equal(approval.id, existing.id);
  assert.equal(calls.create, 0);
});

test('createApprovalFor: falls back to existing when create hits unique violation', async () => {
  const existing = { id: 'a2', status: 'pending_exec', steps: [] };
  const calls = { create: 0, findFirst: 0 };
  const fakeClient = {
    approvalRule: { findMany: async () => [] },
    project: { findUnique: async () => null },
    approvalInstance: {
      findFirst: async () => {
        calls.findFirst += 1;
        return calls.findFirst === 1 ? null : existing;
      },
      create: async () => {
        calls.create += 1;
        throw { code: 'P2002' };
      },
    },
  };

  const approval = await createApprovalFor(
    'invoice',
    'invoices',
    'inv2',
    { totalAmount: 1000 },
    { client: fakeClient },
  );
  assert.equal(approval.id, existing.id);
  assert.equal(calls.create, 1);
  assert.equal(calls.findFirst, 2);
});

