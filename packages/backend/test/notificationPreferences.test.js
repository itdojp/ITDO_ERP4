import assert from 'node:assert/strict';
import test from 'node:test';

import { Value } from '@sinclair/typebox/value';

import {
  chatRoomNotificationSettingPatchSchema,
  notificationPreferencePatchSchema,
} from '../dist/routes/validators.js';

test('notificationPreferencePatchSchema: accepts digest with interval', () => {
  const ok = Value.Check(notificationPreferencePatchSchema.body, {
    emailMode: 'digest',
    emailDigestIntervalMinutes: 10,
  });
  assert.equal(ok, true);
});

test('notificationPreferencePatchSchema: rejects invalid digest interval', () => {
  const ok = Value.Check(notificationPreferencePatchSchema.body, {
    emailMode: 'digest',
    emailDigestIntervalMinutes: 0,
  });
  assert.equal(ok, false);
});

test('chatRoomNotificationSettingPatchSchema: accepts notify flags', () => {
  const ok = Value.Check(chatRoomNotificationSettingPatchSchema.body, {
    notifyAllPosts: true,
    notifyMentions: false,
    muteUntil: null,
  });
  assert.equal(ok, true);
});

test('chatRoomNotificationSettingPatchSchema: rejects invalid muteUntil', () => {
  const ok = Value.Check(chatRoomNotificationSettingPatchSchema.body, {
    muteUntil: 123,
  });
  assert.equal(ok, false);
});
