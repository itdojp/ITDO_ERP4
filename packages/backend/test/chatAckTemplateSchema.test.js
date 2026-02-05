import assert from 'node:assert/strict';
import test from 'node:test';

import { Value } from '@sinclair/typebox/value';

import {
  chatAckTemplateSchema,
  chatAckTemplatePatchSchema,
} from '../dist/routes/validators.js';

test('chatAckTemplateSchema: accepts template with due/escalation', () => {
  const ok = Value.Check(chatAckTemplateSchema.body, {
    flowType: 'invoice',
    actionKey: 'approve',
    messageBody: '請求の確認依頼',
    requiredUserIds: ['u1'],
    dueInHours: 24,
    remindIntervalHours: 12,
    escalationAfterHours: 48,
    escalationRoles: ['mgmt'],
    isEnabled: true,
  });
  assert.equal(ok, true);
});

test('chatAckTemplateSchema: rejects missing messageBody', () => {
  const ok = Value.Check(chatAckTemplateSchema.body, {
    flowType: 'invoice',
    actionKey: 'approve',
  });
  assert.equal(ok, false);
});

test('chatAckTemplateSchema: rejects invalid dueInHours', () => {
  const ok = Value.Check(chatAckTemplateSchema.body, {
    flowType: 'invoice',
    actionKey: 'approve',
    messageBody: 'test',
    dueInHours: -1,
  });
  assert.equal(ok, false);
});

test('chatAckTemplatePatchSchema: accepts partial update', () => {
  const ok = Value.Check(chatAckTemplatePatchSchema.body, {
    remindIntervalHours: 6,
    escalationAfterHours: 24,
  });
  assert.equal(ok, true);
});
