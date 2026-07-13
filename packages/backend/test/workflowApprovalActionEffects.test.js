import assert from 'node:assert/strict';
import test from 'node:test';
import { runApprovalActionSideEffects } from '../dist/application/workflow/approvalActionEffects.js';

function makeRequest() {
  const warnings = [];
  return {
    req: {
      log: {
        warn: (payload, message) => warnings.push({ payload, message }),
      },
    },
    warnings,
  };
}

const baseInstance = {
  id: 'approval-1',
  projectId: 'project-1',
  flowType: 'expense',
};

const updatedInstance = {
  id: 'approval-1',
  projectId: 'project-1',
  createdBy: 'requester-1',
  flowType: 'expense',
  targetTable: 'expenses',
  targetId: 'expense-1',
  currentStep: 2,
  steps: [
    {
      stepOrder: 2,
      status: 'pending_exec',
      approverGroupId: 'exec-group',
      approverUserId: null,
    },
  ],
};

test('runApprovalActionSideEffects sends outcome notification then applies chat ack templates', async () => {
  const { req } = makeRequest();
  const calls = [];

  await runApprovalActionSideEffects(
    {
      req,
      instance: baseInstance,
      updated: updatedInstance,
      result: { status: 'approved' },
      actionKey: 'approve',
      actorUserId: 'approver-1',
    },
    {
      createApprovalOutcomeNotification: async (options) => {
        calls.push(['outcome', options]);
      },
      createApprovalPendingNotifications: async (options) => {
        calls.push(['pending', options]);
      },
      applyChatAckTemplates: async (options) => {
        calls.push(['chatAck', options]);
      },
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'outcome');
  assert.deepEqual(calls[0][1], {
    approvalInstanceId: 'approval-1',
    projectId: 'project-1',
    requesterUserId: 'requester-1',
    actorUserId: 'approver-1',
    flowType: 'expense',
    targetTable: 'expenses',
    targetId: 'expense-1',
    outcome: 'approved',
  });
  assert.equal(calls[1][0], 'chatAck');
  assert.equal(calls[1][1].req, req);
  assert.deepEqual(
    { ...calls[1][1], req: '<request>' },
    {
      req: '<request>',
      flowType: 'expense',
      actionKey: 'approve',
      targetTable: 'approval_instances',
      targetId: 'approval-1',
      projectId: 'project-1',
      actorUserId: 'approver-1',
    },
  );
});

test('runApprovalActionSideEffects sends pending notification for pending approval result', async () => {
  const { req } = makeRequest();
  const calls = [];

  await runApprovalActionSideEffects(
    {
      req,
      instance: baseInstance,
      updated: updatedInstance,
      result: { status: 'pending_exec' },
      actionKey: 'approve',
      actorUserId: 'approver-1',
    },
    {
      createApprovalOutcomeNotification: async (options) => {
        calls.push(['outcome', options]);
      },
      createApprovalPendingNotifications: async (options) => {
        calls.push(['pending', options]);
      },
      applyChatAckTemplates: async (options) => {
        calls.push(['chatAck', options]);
      },
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'pending');
  assert.equal(calls[0][1].currentStep, 2);
  assert.deepEqual(calls[0][1].steps, updatedInstance.steps);
  assert.equal(calls[1][0], 'chatAck');
});

test('runApprovalActionSideEffects propagates notification failures before chat ack side effects', async () => {
  const { req } = makeRequest();
  let chatAckCalled = false;

  await assert.rejects(
    runApprovalActionSideEffects(
      {
        req,
        instance: baseInstance,
        updated: updatedInstance,
        result: { status: 'rejected' },
        actionKey: 'reject',
        actorUserId: 'approver-1',
      },
      {
        createApprovalOutcomeNotification: async () => {
          throw new Error('notification failed');
        },
        createApprovalPendingNotifications: async () => {},
        applyChatAckTemplates: async () => {
          chatAckCalled = true;
        },
      },
    ),
    /notification failed/,
  );
  assert.equal(chatAckCalled, false);
});

test('runApprovalActionSideEffects treats chat ack template failures as fail-open warnings', async () => {
  const { req, warnings } = makeRequest();
  const calls = [];

  await runApprovalActionSideEffects(
    {
      req,
      instance: baseInstance,
      updated: updatedInstance,
      result: { status: 'approved' },
      actionKey: 'approve',
      actorUserId: 'approver-1',
    },
    {
      createApprovalOutcomeNotification: async (options) => {
        calls.push(['outcome', options]);
      },
      createApprovalPendingNotifications: async () => {},
      applyChatAckTemplates: async () => {
        throw new Error('chat ack failed');
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, 'applyChatAckTemplates failed');
  assert.equal(warnings[0].payload.approvalInstanceId, 'approval-1');
  assert.match(warnings[0].payload.err.message, /chat ack failed/);
});
