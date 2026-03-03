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

test('GET /approval-instances/:id/evidence-snapshot denies project member for time_entries unless creator', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || MIN_DATABASE_URL;
  process.env.AUTH_MODE = 'header';

  const approval = {
    id: 'approval-time-001',
    targetTable: 'time_entries',
    projectId: 'project-001',
    createdBy: 'owner-001',
  };
  const snapshot = {
    id: 'snapshot-time-001',
    approvalInstanceId: approval.id,
    version: 1,
    capturedAt: new Date('2026-03-01T00:00:00.000Z'),
    sourceAnnotationUpdatedAt: null,
    items: { subject: { kind: 'time_entry' } },
  };

  await withPrismaStubs(
    {
      'approvalInstance.findUnique': async () => approval,
      'evidenceSnapshot.findFirst': async () => snapshot,
      'auditLog.create': async () => ({ id: 'audit-001' }),
    },
    async () => {
      const server = await buildServer({ logger: false });
      try {
        const denied = await server.inject({
          method: 'GET',
          url: `/approval-instances/${approval.id}/evidence-snapshot`,
          headers: {
            'x-user-id': 'project-user',
            'x-roles': 'user',
            'x-project-ids': approval.projectId,
          },
        });
        assert.equal(denied.statusCode, 403, denied.body);

        const allowed = await server.inject({
          method: 'GET',
          url: `/approval-instances/${approval.id}/evidence-snapshot`,
          headers: {
            'x-user-id': approval.createdBy,
            'x-roles': 'user',
            'x-project-ids': approval.projectId,
          },
        });
        assert.equal(allowed.statusCode, 200, allowed.body);
        const body = JSON.parse(allowed.body);
        assert.equal(body.exists, true);
        assert.equal(body.snapshot.id, snapshot.id);
      } finally {
        await server.close();
      }
    },
  );
});

