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

test('GET /approval-instances/:id/evidence-pack/export forbids mask=0 for non admin/mgmt', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const approval = {
    id: 'approval-001',
    flowType: 'invoice',
    targetTable: 'invoices',
    targetId: 'inv-1',
    status: 'pending_qa',
    currentStep: 1,
    projectId: 'project-001',
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    createdBy: 'owner-001',
  };
  const snapshot = {
    id: 'snapshot-001',
    approvalInstanceId: approval.id,
    version: 1,
    capturedAt: new Date('2026-03-01T00:00:00.000Z'),
    capturedBy: 'owner-001',
    sourceAnnotationUpdatedAt: null,
    items: { notes: null, externalUrls: [], internalRefs: [] },
  };

  await withPrismaStubs(
    {
      'approvalInstance.findUnique': async () => approval,
      'evidenceSnapshot.findFirst': async () => snapshot,
      'approvalStep.findMany': async () => [],
      'auditLog.findMany': async () => [],
      'auditLog.create': async () => ({ id: 'audit-1' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const forbidden = await server.inject({
          method: 'GET',
          url: `/approval-instances/${approval.id}/evidence-pack/export?format=json&mask=0`,
          headers: {
            'x-user-id': 'project-user',
            'x-roles': 'user',
            'x-project-ids': approval.projectId,
          },
        });
        assert.equal(forbidden.statusCode, 403, forbidden.body);
        const forbiddenBody = JSON.parse(forbidden.body);
        assert.equal(forbiddenBody?.error?.code, 'UNMASKED_EXPORT_FORBIDDEN');

        const allowed = await server.inject({
          method: 'GET',
          url: `/approval-instances/${approval.id}/evidence-pack/export?format=json&mask=0`,
          headers: {
            'x-user-id': 'admin-1',
            'x-roles': 'admin',
          },
        });
        assert.equal(allowed.statusCode, 200, allowed.body);
        const allowedBody = JSON.parse(allowed.body);
        assert.equal(allowedBody?.payload?.schemaVersion, 'evidence-pack/v2');
      } finally {
        await server.close();
      }
    },
  );
});
