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
      'recurringGenerationLog.updateMany': async () => ({ count: 0 }),
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

test('runRecurringTemplates retries a period whose previous claim ended in error', async () => {
  let transactionCalled = false;
  let retryClaimed = false;
  let logStatus = null;

  await withPrismaStubs(
    {
      'recurringProjectTemplate.findMany': async () => [
        {
          id: 'tpl-retry',
          projectId: 'proj-retry',
          project: { id: 'proj-retry', status: 'active', currency: 'JPY' },
          nextRunAt: new Date('2026-01-01T00:00:00.000Z'),
          frequency: 'monthly',
          shouldGenerateEstimate: false,
          shouldGenerateInvoice: false,
          defaultMilestoneName: 'Monthly retainer',
          billUpon: null,
          dueDateRule: null,
          defaultAmount: 1000,
          defaultCurrency: 'JPY',
          defaultTerms: 'Monthly retainer',
          defaultTaxRate: null,
        },
      ],
      'recurringGenerationLog.create': async () => {
        const error = new Error('duplicate');
        error.code = 'P2002';
        throw error;
      },
      'recurringGenerationLog.updateMany': async ({ where, data }) => {
        assert.deepEqual(where, {
          templateId: 'tpl-retry',
          periodKey: '2026-01',
          status: 'error',
        });
        assert.equal(data.status, 'running');
        assert.equal(data.message, 'generation_claimed');
        retryClaimed = true;
        return { count: 1 };
      },
      'projectMilestone.findFirst': async () => null,
      $transaction: async (fn) => {
        transactionCalled = true;
        return fn({
          projectMilestone: {
            create: async () => ({ id: 'milestone-retry' }),
          },
          recurringProjectTemplate: {
            update: async () => ({ id: 'tpl-retry' }),
          },
        });
      },
      'recurringGenerationLog.findUnique': async () => ({ status: 'running' }),
      'recurringGenerationLog.update': async ({ data }) => {
        logStatus = data.status;
        assert.equal(data.milestoneId, 'milestone-retry');
      },
    },
    async () => {
      const result = await runRecurringTemplates(
        new Date('2026-01-01T00:00:00.000Z'),
      );
      assert.equal(result.processed, 1);
      assert.equal(result.results[0].status, 'created');
      assert.equal(result.results[0].milestoneId, 'milestone-retry');
    },
  );

  assert.equal(retryClaimed, true);
  assert.equal(transactionCalled, true);
  assert.equal(logStatus, 'created');
});
