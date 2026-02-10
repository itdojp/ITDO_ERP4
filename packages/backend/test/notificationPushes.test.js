import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dispatchNotificationPushes,
  isNotificationPushKindEnabled,
} from '../dist/services/notificationPushes.js';

test('isNotificationPushKindEnabled: uses default allowlist', () => {
  assert.equal(isNotificationPushKindEnabled('chat_mention', undefined), true);
  assert.equal(isNotificationPushKindEnabled('project_created', undefined), false);
});

test('isNotificationPushKindEnabled: wildcard enables all kinds', () => {
  assert.equal(isNotificationPushKindEnabled('project_created', '*'), true);
});

test('dispatchNotificationPushes: skips when kind is disabled', async () => {
  const res = await dispatchNotificationPushes(
    {
      kind: 'project_created',
      userIds: ['u1'],
      projectId: 'p1',
    },
    {
      pushKindsEnv: 'chat_mention,approval_pending',
      isWebPushEnabledFn: () => true,
      client: {
        pushSubscription: {
          findMany: async () => [],
          updateMany: async () => ({ count: 0 }),
        },
      },
      sendWebPushFn: async () => ({ enabled: true, results: [] }),
      logAuditFn: async () => undefined,
    },
  );
  assert.equal(res.attempted, false);
  assert.equal(res.reason, 'kind_disabled');
});

test('dispatchNotificationPushes: dispatches and disables stale subscriptions', async () => {
  const updateManyCalls = [];
  const auditEntries = [];
  let capturedPayload = null;
  const res = await dispatchNotificationPushes(
    {
      kind: 'chat_mention',
      userIds: ['u1', 'u2', 'u1'],
      messageId: 'msg_1',
      payload: { excerpt: '本文サンプル' },
      actorUserId: 'actor_1',
    },
    {
      pushKindsEnv: 'chat_mention',
      isWebPushEnabledFn: () => true,
      client: {
        pushSubscription: {
          findMany: async () => [
            {
              id: 'sub_ok',
              endpoint: 'https://example.com/ok',
              p256dh: 'p256dh-ok',
              auth: 'auth-ok',
              userId: 'u1',
            },
            {
              id: 'sub_gone',
              endpoint: 'https://example.com/gone',
              p256dh: 'p256dh-gone',
              auth: 'auth-gone',
              userId: 'u2',
            },
          ],
          updateMany: async (args) => {
            updateManyCalls.push(args);
            return { count: 1 };
          },
        },
      },
      sendWebPushFn: async (_subscriptions, payload) => {
        capturedPayload = payload;
        return {
          enabled: true,
          results: [
            { subscriptionId: 'sub_ok', status: 'success' },
            {
              subscriptionId: 'sub_gone',
              status: 'failed',
              error: 'gone',
              statusCode: 410,
              shouldDisable: true,
            },
          ],
        };
      },
      logAuditFn: async (entry) => {
        auditEntries.push(entry);
      },
      now: new Date('2026-02-10T00:00:00.000Z'),
    },
  );

  assert.equal(res.attempted, true);
  assert.equal(res.kind, 'chat_mention');
  assert.equal(res.recipientCount, 2);
  assert.equal(res.subscriptionCount, 2);
  assert.equal(res.deliveredCount, 1);
  assert.equal(res.failedCount, 1);
  assert.equal(res.disabledCount, 1);

  assert.equal(updateManyCalls.length, 1);
  assert.deepEqual(updateManyCalls[0].where, { id: { in: ['sub_gone'] } });
  assert.equal(updateManyCalls[0].data.isActive, false);
  assert.equal(updateManyCalls[0].data.updatedBy, 'actor_1');

  assert.equal(capturedPayload.title, 'ERP4: メンション');
  assert.equal(capturedPayload.body, '本文サンプル');
  assert.equal(capturedPayload.url, '/#/open?kind=chat_message&id=msg_1');

  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0].action, 'notification_push_dispatched');
  assert.equal(auditEntries[0].targetTable, 'app_notifications');
  assert.equal(auditEntries[0].targetId, 'msg_1');
});
