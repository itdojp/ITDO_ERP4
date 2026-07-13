import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@prisma/client';

import {
  buildRecurringTemplateMutationData,
  listProjectRecurringGenerationLogs,
  normalizeRecurringFrequency,
  normalizeRecurringGenerationLogTake,
  toRecurringProjectTemplateJobContract,
  upsertProjectRecurringTemplate,
} from '../dist/application/projects/recurringTemplateUseCases.js';

test('buildRecurringTemplateMutationData parses schedule, defaults, and dueDateRule', () => {
  const data = buildRecurringTemplateMutationData({
    frequency: 'quarterly',
    nextRunAt: '2026-08-01T00:00:00.000Z',
    timezone: 'Asia/Tokyo',
    defaultAmount: 1000,
    defaultCurrency: 'JPY',
    defaultTaxRate: 0.1,
    defaultTerms: 'Monthly retainer',
    defaultMilestoneName: 'Recurring milestone',
    billUpon: 'time',
    dueDateRule: { type: 'periodEndPlusOffset', offsetDays: '10' },
    shouldGenerateEstimate: true,
    shouldGenerateInvoice: false,
    isActive: true,
  });

  assert.equal(data.frequency, 'quarterly');
  assert.equal(data.nextRunAt.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(data.timezone, 'Asia/Tokyo');
  assert.deepEqual(data.dueDateRule, {
    type: 'periodEndPlusOffset',
    offsetDays: 10,
  });
  assert.equal(data.billUpon, 'time');
  assert.equal(data.shouldGenerateEstimate, true);
  assert.equal(data.shouldGenerateInvoice, false);

  const nullRule = buildRecurringTemplateMutationData({
    frequency: 'monthly',
    dueDateRule: null,
  });
  assert.equal(nullRule.dueDateRule, Prisma.DbNull);
});

test('recurring pure helpers keep supported frequency, limit, and job contract rules', () => {
  assert.deepEqual(
    ['monthly', 'quarterly', 'semiannual', 'annual'].map((frequency) =>
      normalizeRecurringFrequency(frequency),
    ),
    ['monthly', 'quarterly', 'semiannual', 'annual'],
  );
  assert.equal(normalizeRecurringFrequency('weekly'), null);
  assert.equal(normalizeRecurringGenerationLogTake(undefined), 50);
  assert.equal(normalizeRecurringGenerationLogTake('0'), 50);
  assert.equal(normalizeRecurringGenerationLogTake('10.8'), 10);
  assert.equal(normalizeRecurringGenerationLogTake('999'), 200);

  const contract = toRecurringProjectTemplateJobContract({
    id: 'tpl-1',
    projectId: 'proj-1',
    frequency: 'unknown',
    nextRunAt: new Date('2026-09-01T00:00:00.000Z'),
    timezone: '',
    shouldGenerateEstimate: false,
    shouldGenerateInvoice: undefined,
    isActive: undefined,
  });
  assert.equal(contract.frequency, 'monthly');
  assert.equal(contract.nextRunAt.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(contract.timezone, null);
  assert.equal(contract.shouldGenerateEstimate, false);
  assert.equal(contract.shouldGenerateInvoice, true);
  assert.equal(contract.isActive, true);
});

test('upsertProjectRecurringTemplate writes create/update data only after project exists', async () => {
  let upsertArgs = null;
  const ports = {
    db: {
      project: {
        findUnique: async () => ({ id: 'proj-1' }),
      },
      recurringProjectTemplate: {
        upsert: async (args) => {
          upsertArgs = args;
          return { id: 'tpl-1', ...args.create };
        },
      },
    },
  };

  const result = await upsertProjectRecurringTemplate({
    projectId: 'proj-1',
    body: {
      frequency: 'annual',
      nextRunAt: '2026-12-01T00:00:00.000Z',
      dueDateRule: null,
      timezone: 'Asia/Tokyo',
      defaultAmount: 2000,
      shouldGenerateInvoice: true,
    },
    ports,
  });

  assert.equal(result.ok, true);
  assert.equal(upsertArgs.where.projectId, 'proj-1');
  assert.equal(upsertArgs.create.projectId, 'proj-1');
  assert.equal(upsertArgs.create.frequency, 'annual');
  assert.equal(
    upsertArgs.create.nextRunAt.toISOString(),
    '2026-12-01T00:00:00.000Z',
  );
  assert.equal(upsertArgs.create.dueDateRule, Prisma.DbNull);
  assert.deepEqual(upsertArgs.update, {
    frequency: 'annual',
    nextRunAt: upsertArgs.create.nextRunAt,
    timezone: 'Asia/Tokyo',
    defaultAmount: 2000,
    defaultCurrency: undefined,
    defaultTaxRate: undefined,
    defaultTerms: undefined,
    defaultMilestoneName: undefined,
    billUpon: undefined,
    dueDateRule: Prisma.DbNull,
    shouldGenerateEstimate: undefined,
    shouldGenerateInvoice: true,
    isActive: undefined,
  });
});

test('upsertProjectRecurringTemplate reports existing API errors for missing project and invalid dueDateRule', async () => {
  let upsertCalled = false;
  const missingProject = await upsertProjectRecurringTemplate({
    projectId: 'missing',
    body: { frequency: 'monthly' },
    ports: {
      db: {
        project: { findUnique: async () => null },
        recurringProjectTemplate: {
          upsert: async () => {
            upsertCalled = true;
          },
        },
      },
    },
  });
  assert.equal(missingProject.ok, false);
  assert.equal(missingProject.statusCode, 404);
  assert.deepEqual(missingProject.body, { error: 'not_found' });
  assert.equal(upsertCalled, false);

  const logged = [];
  const invalidRule = await upsertProjectRecurringTemplate({
    projectId: 'proj-1',
    body: {
      frequency: 'monthly',
      dueDateRule: { type: 'unsupported', offsetDays: 1 },
    },
    ports: {
      logger: {
        error: (payload, message) => logged.push({ payload, message }),
      },
      db: {
        project: { findUnique: async () => ({ id: 'proj-1' }) },
        recurringProjectTemplate: {
          upsert: async () => {
            throw new Error('upsert should not be called');
          },
        },
      },
    },
  });
  assert.equal(invalidRule.ok, false);
  assert.equal(invalidRule.statusCode, 400);
  assert.equal(invalidRule.body.error.code, 'INVALID_DUE_DATE_RULE');
  assert.equal(logged.length, 1);
});

test('upsertProjectRecurringTemplate validates direct service nextRunAt/frequency inputs', async () => {
  const ports = {
    db: {
      project: { findUnique: async () => ({ id: 'proj-1' }) },
      recurringProjectTemplate: {
        upsert: async () => {
          throw new Error('upsert should not be called');
        },
      },
    },
  };

  const invalidDate = await upsertProjectRecurringTemplate({
    projectId: 'proj-1',
    body: { frequency: 'monthly', nextRunAt: 'not-a-date' },
    ports,
  });
  assert.equal(invalidDate.ok, false);
  assert.equal(invalidDate.body.error.code, 'INVALID_NEXT_RUN_AT');

  const invalidFrequency = await upsertProjectRecurringTemplate({
    projectId: 'proj-1',
    body: { frequency: 'weekly' },
    ports,
  });
  assert.equal(invalidFrequency.ok, false);
  assert.equal(invalidFrequency.body.error.code, 'INVALID_FREQUENCY');
});

test('listProjectRecurringGenerationLogs preserves filters and limit clamp', async () => {
  let findManyArgs = null;
  const ports = {
    db: {
      project: {
        findUnique: async () => ({ id: 'proj-1', deletedAt: null }),
      },
      recurringGenerationLog: {
        findMany: async (args) => {
          findManyArgs = args;
          return [{ id: 'log-1' }];
        },
      },
    },
  };

  const result = await listProjectRecurringGenerationLogs({
    projectId: 'proj-1',
    query: {
      limit: '999',
      templateId: 'tpl-1',
      periodKey: '2026-07',
    },
    ports,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.items, [{ id: 'log-1' }]);
  assert.deepEqual(findManyArgs, {
    where: {
      projectId: 'proj-1',
      templateId: 'tpl-1',
      periodKey: '2026-07',
    },
    orderBy: [{ runAt: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  });
});
