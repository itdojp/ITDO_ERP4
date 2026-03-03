import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getActionPolicyEnforcementPreset,
  resolveActionPolicyRequiredActionsText,
  resolveApprovalEvidenceRequiredActionsText,
} from '../dist/services/policyEnforcementPreset.js';

test('getActionPolicyEnforcementPreset: supports off/phase2_core/phase3_strict', () => {
  assert.equal(getActionPolicyEnforcementPreset(undefined), 'off');
  assert.equal(getActionPolicyEnforcementPreset('off'), 'off');
  assert.equal(getActionPolicyEnforcementPreset('phase2_core'), 'phase2_core');
  assert.equal(getActionPolicyEnforcementPreset('PHASE2_CORE'), 'phase2_core');
  assert.equal(
    getActionPolicyEnforcementPreset('phase3_strict'),
    'phase3_strict',
  );
  assert.equal(
    getActionPolicyEnforcementPreset('PHASE3_STRICT'),
    'phase3_strict',
  );
  assert.equal(getActionPolicyEnforcementPreset('unsupported'), 'off');
});

test('resolveActionPolicyRequiredActionsText: explicit env wins over preset', () => {
  const result = resolveActionPolicyRequiredActionsText(
    'invoice:submit',
    'phase2_core',
  );
  assert.equal(result, 'invoice:submit');
});

test('resolveActionPolicyRequiredActionsText: phase2_core preset provides high-risk defaults', () => {
  const result = resolveActionPolicyRequiredActionsText('', 'phase2_core');
  assert.equal(typeof result, 'string');
  assert.match(result, /invoice:submit/);
  assert.match(result, /invoice:send/);
  assert.match(result, /vendor_invoice:link_po/);
  assert.match(result, /\*:approve/);
});

test('resolveActionPolicyRequiredActionsText: phase3_strict preset enforces all flow actions', () => {
  const result = resolveActionPolicyRequiredActionsText('', 'phase3_strict');
  assert.equal(result, '*:*');
});

test('resolveApprovalEvidenceRequiredActionsText: phase2_core preset provides send defaults', () => {
  const result = resolveApprovalEvidenceRequiredActionsText(
    undefined,
    'phase2_core',
  );
  assert.equal(typeof result, 'string');
  assert.match(result, /estimate:send/);
  assert.match(result, /invoice:send/);
  assert.match(result, /purchase_order:send/);
});

test('resolveApprovalEvidenceRequiredActionsText: phase3_strict keeps send defaults', () => {
  const result = resolveApprovalEvidenceRequiredActionsText(
    undefined,
    'phase3_strict',
  );
  assert.equal(typeof result, 'string');
  assert.match(result, /estimate:send/);
  assert.match(result, /invoice:send/);
  assert.match(result, /purchase_order:send/);
});

test('resolveApprovalEvidenceRequiredActionsText: off preset leaves rule empty', () => {
  const result = resolveApprovalEvidenceRequiredActionsText('', 'off');
  assert.equal(result, undefined);
});
