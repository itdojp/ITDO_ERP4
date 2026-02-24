import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const [model, method] = path.split('.');
    const target = prisma[model];
    if (!target || typeof target[method] !== 'function') {
      throw new Error(`invalid stub target: ${path}`);
    }
    const original = target[method];
    target[method] = stub;
    restores.push(() => {
      target[method] = original;
    });
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const restore of restores.reverse()) restore();
    });
}

function withEnv(overrides, fn) {
  const previous = new Map();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

function adminHeaders() {
  return {
    'x-user-id': 'admin-user',
    'x-roles': 'admin,mgmt',
  };
}

function invoiceDraft() {
  return {
    id: 'inv-001',
    status: 'approved',
    projectId: 'proj-001',
    invoiceNo: 'INV-001',
  };
}

function estimateDraft() {
  return {
    id: 'est-001',
    status: 'approved',
    projectId: 'proj-001',
    estimateNo: 'EST-001',
  };
}

function purchaseOrderDraft() {
  return {
    id: 'po-001',
    status: 'approved',
    projectId: 'proj-001',
    poNo: 'PO-001',
  };
}

test('POST /invoices/:id/send: phase2_core preset denies when policy is missing', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'phase2_core',
      ACTION_POLICY_REQUIRED_ACTIONS: '',
      APPROVAL_EVIDENCE_REQUIRED_ACTIONS: '',
    },
    async () => {
      await withPrismaStubs(
        {
          'invoice.findUnique': async () => invoiceDraft(),
          'actionPolicy.findMany': async () => [],
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/invoices/inv-001/send',
              headers: adminHeaders(),
            });
            assert.equal(res.statusCode, 403, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.error?.code, 'ACTION_POLICY_DENIED');
          } finally {
            await server.close();
          }
        },
      );
    },
  );
});

test('POST /invoices/:id/send: preset off keeps legacy fallback behavior', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'off',
      ACTION_POLICY_REQUIRED_ACTIONS: '',
      APPROVAL_EVIDENCE_REQUIRED_ACTIONS: '',
    },
    async () => {
      await withPrismaStubs(
        {
          'invoice.findUnique': async () => invoiceDraft(),
          'actionPolicy.findMany': async () => [],
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/invoices/inv-001/send?templateId=missing-template',
              headers: adminHeaders(),
            });
            assert.equal(res.statusCode, 404, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.error?.code, 'template_not_found');
          } finally {
            await server.close();
          }
        },
      );
    },
  );
});

test('POST /invoices/:id/send: phase2_core requires approval+evidence after policy allow', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'phase2_core',
      ACTION_POLICY_REQUIRED_ACTIONS: '',
      APPROVAL_EVIDENCE_REQUIRED_ACTIONS: '',
    },
    async () => {
      await withPrismaStubs(
        {
          'invoice.findUnique': async () => invoiceDraft(),
          'actionPolicy.findMany': async () => [
            {
              id: 'policy-allow-send',
              flowType: 'invoice',
              actionKey: 'send',
              priority: 100,
              isEnabled: true,
              subjects: null,
              stateConstraints: null,
              requireReason: false,
              guards: null,
            },
          ],
          'approvalInstance.findFirst': async () => null,
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/invoices/inv-001/send',
              headers: adminHeaders(),
            });
            assert.equal(res.statusCode, 403, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.error?.code, 'APPROVAL_REQUIRED');
          } finally {
            await server.close();
          }
        },
      );
    },
  );
});

test('POST /estimates/:id/send: phase2_core preset denies when policy is missing', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'phase2_core',
      ACTION_POLICY_REQUIRED_ACTIONS: '',
      APPROVAL_EVIDENCE_REQUIRED_ACTIONS: '',
    },
    async () => {
      await withPrismaStubs(
        {
          'estimate.findUnique': async () => estimateDraft(),
          'actionPolicy.findMany': async () => [],
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/estimates/est-001/send',
              headers: adminHeaders(),
            });
            assert.equal(res.statusCode, 403, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.error?.code, 'ACTION_POLICY_DENIED');
          } finally {
            await server.close();
          }
        },
      );
    },
  );
});

test('POST /purchase-orders/:id/send: phase2_core requires approval+evidence after policy allow', async () => {
  await withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: 'phase2_core',
      ACTION_POLICY_REQUIRED_ACTIONS: '',
      APPROVAL_EVIDENCE_REQUIRED_ACTIONS: '',
    },
    async () => {
      await withPrismaStubs(
        {
          'purchaseOrder.findUnique': async () => purchaseOrderDraft(),
          'actionPolicy.findMany': async () => [
            {
              id: 'policy-allow-po-send',
              flowType: 'purchase_order',
              actionKey: 'send',
              priority: 100,
              isEnabled: true,
              subjects: null,
              stateConstraints: null,
              requireReason: false,
              guards: null,
            },
          ],
          'approvalInstance.findFirst': async () => null,
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/purchase-orders/po-001/send',
              headers: adminHeaders(),
            });
            assert.equal(res.statusCode, 403, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.error?.code, 'APPROVAL_REQUIRED');
          } finally {
            await server.close();
          }
        },
      );
    },
  );
});
