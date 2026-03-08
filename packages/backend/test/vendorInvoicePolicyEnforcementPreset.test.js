import assert from 'node:assert/strict';
import test from 'node:test';

import { buildServer } from '../dist/server.js';
import { prisma } from '../dist/services/db.js';

const MIN_DATABASE_URL = 'postgresql://user:pass@localhost:5432/postgres';

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const segments = path.split('.');
    const method = segments.pop();
    if (!method) throw new Error(`invalid stub target: ${path}`);
    let target = prisma;
    for (const segment of segments) {
      const next = target?.[segment];
      if (!next) throw new Error(`invalid stub target: ${path}`);
      target = next;
    }
    if (typeof target[method] !== 'function') {
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

function vendorInvoiceDraft(overrides = {}) {
  return {
    id: 'vi-001',
    status: 'draft',
    projectId: 'project-001',
    vendorId: 'vendor-001',
    purchaseOrderId: 'po-001',
    currency: 'JPY',
    totalAmount: 12000,
    deletedAt: null,
    ...overrides,
  };
}

function withVendorInvoicePolicyEnv(preset, fn) {
  return withEnv(
    {
      DATABASE_URL: process.env.DATABASE_URL || MIN_DATABASE_URL,
      AUTH_MODE: 'header',
      ACTION_POLICY_ENFORCEMENT_PRESET: preset,
      ACTION_POLICY_REQUIRED_ACTIONS: '',
      APPROVAL_EVIDENCE_REQUIRED_ACTIONS: '',
    },
    fn,
  );
}

for (const preset of ['phase2_core', 'phase3_strict']) {
  test(`PUT /vendor-invoices/:id/allocations: ${preset} required action denies when policy is missing`, async () => {
    await withVendorInvoicePolicyEnv(preset, async () => {
      await withPrismaStubs(
        {
          'vendorInvoice.findUnique': async () => vendorInvoiceDraft(),
          'actionPolicy.findMany': async () => [],
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'PUT',
              url: '/vendor-invoices/vi-001/allocations',
              headers: adminHeaders(),
              payload: { allocations: [] },
            });
            assert.equal(res.statusCode, 403, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.error?.code, 'ACTION_POLICY_DENIED');
          } finally {
            await server.close();
          }
        },
      );
    });
  });

  test(`PUT /vendor-invoices/:id/allocations: ${preset} policy allow reaches downstream validation`, async () => {
    await withVendorInvoicePolicyEnv(preset, async () => {
      await withPrismaStubs(
        {
          'vendorInvoice.findUnique': async () => vendorInvoiceDraft(),
          'actionPolicy.findMany': async () => [
            {
              id: 'policy-vi-allocations-allow',
              flowType: 'vendor_invoice',
              actionKey: 'update_allocations',
              priority: 100,
              isEnabled: true,
              subjects: null,
              stateConstraints: null,
              requireReason: false,
              guards: null,
            },
          ],
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'PUT',
              url: '/vendor-invoices/vi-001/allocations',
              headers: adminHeaders(),
              payload: { allocations: [{}] },
            });
            assert.equal(res.statusCode, 400, res.body);
            const payload = JSON.parse(res.body);
            assert.notEqual(payload?.error?.code, 'ACTION_POLICY_DENIED');
            assert.equal(payload?.error?.code, 'VALIDATION_ERROR');
          } finally {
            await server.close();
          }
        },
      );
    });
  });

  test(`PUT /vendor-invoices/:id/lines: ${preset} required action denies when policy is missing`, async () => {
    await withVendorInvoicePolicyEnv(preset, async () => {
      await withPrismaStubs(
        {
          'vendorInvoice.findUnique': async () => vendorInvoiceDraft(),
          'actionPolicy.findMany': async () => [],
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'PUT',
              url: '/vendor-invoices/vi-001/lines',
              headers: adminHeaders(),
              payload: { lines: [] },
            });
            assert.equal(res.statusCode, 403, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.error?.code, 'ACTION_POLICY_DENIED');
          } finally {
            await server.close();
          }
        },
      );
    });
  });

  test(`PUT /vendor-invoices/:id/lines: ${preset} policy allow reaches downstream validation`, async () => {
    await withVendorInvoicePolicyEnv(preset, async () => {
      await withPrismaStubs(
        {
          'vendorInvoice.findUnique': async () => vendorInvoiceDraft(),
          'actionPolicy.findMany': async () => [
            {
              id: 'policy-vi-lines-allow',
              flowType: 'vendor_invoice',
              actionKey: 'update_lines',
              priority: 100,
              isEnabled: true,
              subjects: null,
              stateConstraints: null,
              requireReason: false,
              guards: null,
            },
          ],
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'PUT',
              url: '/vendor-invoices/vi-001/lines',
              headers: adminHeaders(),
              payload: { lines: [{}] },
            });
            assert.equal(res.statusCode, 400, res.body);
            const payload = JSON.parse(res.body);
            assert.notEqual(payload?.error?.code, 'ACTION_POLICY_DENIED');
            assert.equal(payload?.error?.code, 'VALIDATION_ERROR');
          } finally {
            await server.close();
          }
        },
      );
    });
  });

  test(`POST /vendor-invoices/:id/submit: ${preset} required action denies when policy is missing`, async () => {
    await withVendorInvoicePolicyEnv(preset, async () => {
      let transactionCalled = 0;
      await withPrismaStubs(
        {
          'vendorInvoice.findUnique': async () => vendorInvoiceDraft(),
          'actionPolicy.findMany': async () => [],
          $transaction: async () => {
            transactionCalled += 1;
            throw new Error('unexpected transaction in deny path');
          },
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/vendor-invoices/vi-001/submit',
              headers: adminHeaders(),
              payload: {},
            });
            assert.equal(res.statusCode, 403, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.error?.code, 'ACTION_POLICY_DENIED');
            assert.equal(transactionCalled, 0);
          } finally {
            await server.close();
          }
        },
      );
    });
  });

  test(`POST /vendor-invoices/:id/submit: ${preset} policy allow reaches downstream submit path`, async () => {
    await withVendorInvoicePolicyEnv(preset, async () => {
      let transactionCalled = 0;
      let updateCalled = 0;
      const tx = {
        vendorInvoice: {
          update: async ({ where, data }) => {
            updateCalled += 1;
            return {
              id: where.id,
              status: data.status,
              projectId: 'project-001',
            };
          },
        },
        project: {
          findUnique: async () => null,
        },
        approvalRule: {
          findMany: async () => [
            {
              id: 'rule-vendor-invoice-submit',
              flowType: 'vendor_invoice',
              ruleKey: 'vendor-invoice-default',
              version: 1,
              isActive: true,
              conditions: {},
              steps: [{ approverUserId: 'admin-user', stepOrder: 1 }],
            },
          ],
        },
        approvalInstance: {
          findFirst: async () => null,
          create: async ({ data }) => ({
            id: 'approval-001',
            flowType: data.flowType,
            targetTable: data.targetTable,
            targetId: data.targetId,
            projectId: data.projectId,
            status: data.status,
            currentStep: data.currentStep,
            ruleId: data.ruleId,
            createdBy: data.createdBy,
            stagePolicy: data.stagePolicy ?? null,
            steps: (data.steps?.create ?? []).map((step, index) => ({
              id: `step-${index + 1}`,
              ...step,
            })),
          }),
        },
        evidenceSnapshot: {
          findFirst: async () => null,
          create: async ({ data }) => ({
            id: 'snapshot-001',
            approvalInstanceId: data.approvalInstanceId,
            targetTable: data.targetTable,
            targetId: data.targetId,
            version: data.version,
          }),
        },
        annotation: {
          findUnique: async () => null,
        },
        referenceLink: {
          findMany: async () => [],
        },
        chatMessage: {
          findMany: async () => [],
        },
      };

      await withPrismaStubs(
        {
          'vendorInvoice.findUnique': async () => vendorInvoiceDraft(),
          'actionPolicy.findMany': async () => [
            {
              id: 'policy-vi-submit-allow',
              flowType: 'vendor_invoice',
              actionKey: 'submit',
              priority: 100,
              isEnabled: true,
              subjects: null,
              stateConstraints: null,
              requireReason: false,
              guards: null,
            },
          ],
          $transaction: async (callback) => {
            transactionCalled += 1;
            return callback(tx);
          },
          'auditLog.create': async () => ({ id: 'audit-001' }),
        },
        async () => {
          const server = await buildServer({ logger: false });
          try {
            const res = await server.inject({
              method: 'POST',
              url: '/vendor-invoices/vi-001/submit',
              headers: adminHeaders(),
              payload: {},
            });
            assert.equal(res.statusCode, 200, res.body);
            const payload = JSON.parse(res.body);
            assert.equal(payload?.id, 'vi-001');
            assert.equal(payload?.status, 'pending_qa');
            assert.equal(updateCalled, 1);
            assert.equal(transactionCalled, 1);
          } finally {
            await server.close();
          }
        },
      );
    });
  });
}
