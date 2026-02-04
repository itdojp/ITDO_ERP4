import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAllowedChatAckLinkTargetTable,
  validateChatAckLinkTarget,
} from '../dist/services/chatAckLinkTargets.js';

function buildClient(found) {
  return {
    approvalInstance: {
      findUnique: async () => (found ? { id: 'a1' } : null),
    },
  };
}

test('isAllowedChatAckLinkTargetTable: approval_instances only', () => {
  assert.equal(isAllowedChatAckLinkTargetTable('approval_instances'), true);
  assert.equal(isAllowedChatAckLinkTargetTable('unknown_table'), false);
});

test('validateChatAckLinkTarget: rejects invalid table', async () => {
  const res = await validateChatAckLinkTarget({
    targetTable: 'vendor_invoices',
    targetId: 'x',
    client: buildClient(true),
  });
  assert.deepEqual(res, { ok: false, reason: 'invalid_target_table' });
});

test('validateChatAckLinkTarget: rejects missing target', async () => {
  const res = await validateChatAckLinkTarget({
    targetTable: 'approval_instances',
    targetId: 'missing',
    client: buildClient(false),
  });
  assert.deepEqual(res, { ok: false, reason: 'target_not_found' });
});

test('validateChatAckLinkTarget: accepts approval instance', async () => {
  const res = await validateChatAckLinkTarget({
    targetTable: 'approval_instances',
    targetId: 'a1',
    client: buildClient(true),
  });
  assert.deepEqual(res, {
    ok: true,
    targetTable: 'approval_instances',
    targetId: 'a1',
  });
});
