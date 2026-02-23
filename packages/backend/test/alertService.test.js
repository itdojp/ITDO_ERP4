import assert from 'node:assert/strict';
import test from 'node:test';

import { prisma } from '../dist/services/db.js';
import { computeAndTrigger, triggerAlert } from '../dist/services/alert.js';

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

test('triggerAlert: open alert exists and reminder disabled keeps idempotent', async () => {
  const existing = {
    id: 'alert-existing',
    reminderAt: null,
    reminderCount: 0,
    sentResult: [],
    sentChannels: [],
  };
  const createCalls = [];
  const updateCalls = [];

  const result = await withPrismaStubs(
    {
      'alert.findFirst': async () => existing,
      'alert.create': async (args) => {
        createCalls.push(args);
        return { id: 'unexpected-create' };
      },
      'alert.update': async (args) => {
        updateCalls.push(args);
        return { id: 'unexpected-update' };
      },
    },
    async () =>
      triggerAlert(
        {
          id: 'setting-1',
          recipients: {},
          channels: ['dashboard'],
          remindAfterHours: null,
          remindMaxCount: null,
        },
        120,
        100,
        'project:1',
        new Date('2026-02-24T09:00:00.000Z'),
      ),
  );

  assert.equal(result, existing);
  assert.equal(createCalls.length, 0);
  assert.equal(updateCalls.length, 0);
});

test('triggerAlert: due reminder increments reminderCount and merges sent results', async () => {
  const existing = {
    id: 'alert-reminder',
    reminderAt: new Date('2026-02-24T08:00:00.000Z'),
    reminderCount: 0,
    sentResult: [{ channel: 'dashboard', status: 'stub' }],
    sentChannels: ['dashboard'],
  };
  const updateCalls = [];
  const now = new Date('2026-02-24T09:00:00.000Z');

  await withPrismaStubs(
    {
      'alert.findFirst': async () => existing,
      'alert.update': async (args) => {
        updateCalls.push(args);
        return args.data;
      },
    },
    async () =>
      triggerAlert(
        {
          id: 'setting-2',
          recipients: {},
          channels: ['dashboard'],
          remindAfterHours: 1,
          remindMaxCount: 2,
        },
        130,
        100,
        'project:2',
        now,
      ),
  );

  assert.equal(updateCalls.length, 1);
  const payload = updateCalls[0].data;
  assert.equal(payload.reminderCount, 1);
  assert.ok(payload.reminderAt instanceof Date);
  assert.equal(
    payload.reminderAt.toISOString(),
    new Date('2026-02-24T10:00:00.000Z').toISOString(),
  );
  assert.equal(Array.isArray(payload.sentResult), true);
  assert.equal(payload.sentResult.length, 2);
  assert.equal(Array.isArray(payload.sentChannels), true);
  assert.equal(payload.sentChannels.length, 2);
});

test('computeAndTrigger: metric equals threshold closes open alert (boundary)', async () => {
  const updateManyCalls = [];
  await withPrismaStubs(
    {
      'alertSetting.findMany': async () => [
        {
          id: 'setting-boundary',
          type: 'overtime',
          threshold: 100,
          scopeProjectId: 'project-boundary',
          isEnabled: true,
        },
      ],
      'alert.updateMany': async (args) => {
        updateManyCalls.push(args);
        return { count: 1 };
      },
    },
    async () =>
      computeAndTrigger({
        overtime: async () => ({ metric: 100, targetRef: 'project-boundary' }),
      }),
  );

  assert.equal(updateManyCalls.length, 1);
  assert.deepEqual(updateManyCalls[0], {
    where: {
      settingId: 'setting-boundary',
      status: 'open',
      targetRef: 'project-boundary',
    },
    data: { status: 'closed' },
  });
});

test('computeAndTrigger: metric over threshold uses scopeProjectId fallback targetRef', async () => {
  const createCalls = [];
  const closeCalls = [];
  await withPrismaStubs(
    {
      'alertSetting.findMany': async () => [
        {
          id: 'setting-over',
          type: 'overtime',
          threshold: 100,
          scopeProjectId: 'project-fallback',
          isEnabled: true,
          recipients: {},
          channels: ['dashboard'],
          remindAfterHours: null,
          remindMaxCount: null,
        },
      ],
      'alert.findFirst': async () => null,
      'alert.create': async (args) => {
        createCalls.push(args);
        return { id: 'alert-created' };
      },
      'alert.updateMany': async (args) => {
        closeCalls.push(args);
        return { count: 0 };
      },
    },
    async () =>
      computeAndTrigger({
        overtime: async () => ({ metric: 120 }),
      }),
  );

  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].data.targetRef, 'project-fallback');
  assert.equal(closeCalls.length, 0);
});
