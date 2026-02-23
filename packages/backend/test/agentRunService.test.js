import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decisionTypeFromErrorCode,
  extractAgentErrorCode,
  extractAgentRunIdFromMetadata,
  normalizeAgentErrorCode,
  shouldOpenDecisionRequest,
} from '../dist/services/agentRuns.js';

test('normalizeAgentErrorCode: supports legacy uppercase aliases', () => {
  assert.equal(normalizeAgentErrorCode('ACTION_POLICY_DENIED'), 'policy_denied');
  assert.equal(normalizeAgentErrorCode('APPROVAL_REQUIRED'), 'approval_required');
  assert.equal(normalizeAgentErrorCode('scope_denied'), 'scope_denied');
  assert.equal(normalizeAgentErrorCode(''), null);
});

test('extractAgentErrorCode: parses API error payload', () => {
  const payload = JSON.stringify({
    error: { code: 'ACTION_POLICY_DENIED', message: 'denied' },
  });
  assert.equal(extractAgentErrorCode(payload), 'policy_denied');
  assert.equal(extractAgentErrorCode({ error: { code: 'APPROVAL_REQUIRED' } }), 'approval_required');
  assert.equal(extractAgentErrorCode('plain text'), null);
});

test('decisionTypeFromErrorCode / shouldOpenDecisionRequest', () => {
  assert.equal(shouldOpenDecisionRequest('policy_denied'), true);
  assert.equal(shouldOpenDecisionRequest('approval_required'), true);
  assert.equal(shouldOpenDecisionRequest('scope_denied'), false);
  assert.equal(decisionTypeFromErrorCode('policy_denied'), 'policy_override');
  assert.equal(decisionTypeFromErrorCode('approval_required'), 'approval_required');
});

test('extractAgentRunIdFromMetadata: returns runId from metadata._agent', () => {
  assert.equal(
    extractAgentRunIdFromMetadata({
      _agent: { runId: 'run-100' },
      other: true,
    }),
    'run-100',
  );
  assert.equal(extractAgentRunIdFromMetadata({}), null);
  assert.equal(extractAgentRunIdFromMetadata(null), null);
});
