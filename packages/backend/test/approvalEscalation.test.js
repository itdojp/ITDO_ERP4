import assert from 'node:assert/strict';
import test from 'node:test';

import { prisma } from '../dist/services/db.js';
import { runApprovalEscalations } from '../dist/services/approvalEscalation.js';

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

test('runApprovalEscalations: overdue current step triggers once and closes stale open alerts', async () => {
  const fixedNow = Date.parse('2026-02-24T12:00:00.000Z');
  const originalDateNow = Date.now;
  const createCalls = [];
  const closeCalls = [];

  try {
    Date.now = () => fixedNow;
    await withPrismaStubs(
      {
        'alertSetting.findMany': async () => [
          {
            id: 'alert-setting-1',
            isEnabled: true,
            type: 'approval_escalation',
            threshold: 4,
            recipients: {},
            channels: ['dashboard'],
            remindAfterHours: null,
            remindMaxCount: null,
            scopeProjectId: null,
          },
        ],
        'approvalStep.findMany': async () => [
          {
            instanceId: 'inst-1',
            stepOrder: 1,
            createdAt: new Date(fixedNow - 6 * 3600000),
            instance: { currentStep: 1 },
          },
          {
            instanceId: 'inst-1',
            stepOrder: 1,
            createdAt: new Date(fixedNow - 5 * 3600000),
            instance: { currentStep: 1 },
          },
          {
            instanceId: 'inst-1',
            stepOrder: 2,
            createdAt: new Date(fixedNow - 8 * 3600000),
            instance: { currentStep: 1 },
          },
          {
            instanceId: 'inst-2',
            stepOrder: 1,
            createdAt: new Date(fixedNow - 4 * 3600000),
            instance: { currentStep: 1 },
          },
          {
            instanceId: 'inst-3',
            stepOrder: 1,
            createdAt: new Date(fixedNow - 3 * 3600000),
            instance: { currentStep: 1 },
          },
        ],
        'alert.findFirst': async () => null,
        'alert.create': async (args) => {
          createCalls.push(args);
          return { id: `alert-${createCalls.length}` };
        },
        'alert.updateMany': async (args) => {
          closeCalls.push(args);
          return { count: 1 };
        },
      },
      async () => runApprovalEscalations(),
    );
  } finally {
    Date.now = originalDateNow;
  }

  assert.equal(createCalls.length, 1);
  assert.equal(
    createCalls[0].data.targetRef,
    'approval_instance:inst-1:step:1',
  );
  assert.equal(Number(createCalls[0].data.reminderCount), 0);

  assert.equal(closeCalls.length, 1);
  assert.deepEqual(closeCalls[0], {
    where: {
      settingId: 'alert-setting-1',
      status: 'open',
      targetRef: { notIn: ['approval_instance:inst-1:step:1'] },
    },
    data: { status: 'closed' },
  });
});

test('runApprovalEscalations: no overdue step closes all open alerts for setting', async () => {
  const fixedNow = Date.parse('2026-02-24T12:00:00.000Z');
  const originalDateNow = Date.now;
  const createCalls = [];
  const closeCalls = [];

  try {
    Date.now = () => fixedNow;
    await withPrismaStubs(
      {
        'alertSetting.findMany': async () => [
          {
            id: 'alert-setting-2',
            isEnabled: true,
            type: 'approval_escalation',
            threshold: 6,
            recipients: {},
            channels: ['dashboard'],
            remindAfterHours: null,
            remindMaxCount: null,
            scopeProjectId: null,
          },
        ],
        'approvalStep.findMany': async () => [
          {
            instanceId: 'inst-10',
            stepOrder: 1,
            createdAt: new Date(fixedNow - 2 * 3600000),
            instance: { currentStep: 1 },
          },
        ],
        'alert.findFirst': async () => null,
        'alert.create': async (args) => {
          createCalls.push(args);
          return { id: `alert-${createCalls.length}` };
        },
        'alert.updateMany': async (args) => {
          closeCalls.push(args);
          return { count: 1 };
        },
      },
      async () => runApprovalEscalations(),
    );
  } finally {
    Date.now = originalDateNow;
  }

  assert.equal(createCalls.length, 0);
  assert.equal(closeCalls.length, 1);
  assert.deepEqual(closeCalls[0], {
    where: { settingId: 'alert-setting-2', status: 'open' },
    data: { status: 'closed' },
  });
});
