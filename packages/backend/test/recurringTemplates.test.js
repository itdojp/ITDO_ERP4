import assert from 'node:assert/strict';
import test from 'node:test';

import { runRecurringTemplates } from '../dist/services/recurring.js';
import { prisma } from '../dist/services/db.js';

function withPrismaStubs(stubs, fn) {
  const restores = [];
  for (const [path, stub] of Object.entries(stubs)) {
    const segments = path.split('.');
    const method = segments.pop();
    let target = prisma;
    for (const segment of segments) {
      target = target?.[segment];
    }
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

test('runRecurringTemplates skips side effects when another run already claimed the period', async () => {
  let transactionCalled = false;
  await withPrismaStubs(
    {
      'recurringProjectTemplate.findMany': async () => [
        {
          id: 'tpl-1',
          projectId: 'proj-1',
          project: { id: 'proj-1', status: 'active', currency: 'JPY' },
          nextRunAt: new Date('2026-01-01T00:00:00.000Z'),
          frequency: 'monthly',
        },
      ],
      'recurringGenerationLog.create': async () => {
        const error = new Error('duplicate');
        error.code = 'P2002';
        throw error;
      },
      $transaction: async () => {
        transactionCalled = true;
        throw new Error('unexpected transaction');
      },
    },
    async () => {
      const result = await runRecurringTemplates(
        new Date('2026-01-01T00:00:00.000Z'),
      );
      assert.equal(result.processed, 1);
      assert.equal(result.results[0].status, 'skipped');
      assert.equal(result.results[0].message, 'already_claimed');
    },
  );
  assert.equal(transactionCalled, false);
});
