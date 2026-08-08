import assert from 'node:assert/strict';
import test from 'node:test';

import { isNotificationDeliveryContentVisible } from '../dist/services/notificationDeliveries.js';

test('email delivery revalidates chat references and forwards no unrelated fields', async () => {
  const calls = [];
  const visible = await isNotificationDeliveryContentVisible(
    {
      kind: 'chat_mention',
      userId: 'user-1',
      projectId: 'project-1',
      messageId: 'message-1',
      payload: { roomId: 'room-1', excerpt: 'synthetic' },
    },
    async (input) => {
      calls.push(input);
      return false;
    },
  );
  assert.equal(visible, false);
  assert.deepEqual(calls, [
    {
      kind: 'chat_mention',
      userId: 'user-1',
      projectId: 'project-1',
      messageId: 'message-1',
      payload: { roomId: 'room-1', excerpt: 'synthetic' },
    },
  ]);
});

test('email delivery does not apply chat ACL semantics to non-chat kinds', async () => {
  let calls = 0;
  const visible = await isNotificationDeliveryContentVisible(
    {
      kind: 'approval_pending',
      userId: 'user-1',
      projectId: 'project-1',
      messageId: null,
      payload: null,
    },
    async () => {
      calls += 1;
      return false;
    },
  );
  assert.equal(visible, true);
  assert.equal(calls, 0);
});

test('future chat notification kinds fail closed through the visibility boundary', async () => {
  const visible = await isNotificationDeliveryContentVisible(
    {
      kind: 'chat_future_internal',
      userId: 'user-1',
      projectId: null,
      messageId: 'message-1',
      payload: null,
    },
    async () => false,
  );
  assert.equal(visible, false);
});
