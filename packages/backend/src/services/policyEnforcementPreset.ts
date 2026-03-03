const PHASE2_ACTION_POLICY_REQUIRED_ACTIONS = [
  'estimate:submit',
  'estimate:send',
  'invoice:submit',
  'invoice:mark_paid',
  'invoice:send',
  'purchase_order:submit',
  'purchase_order:send',
  'expense:submit',
  'expense:mark_paid',
  'expense:unmark_paid',
  'time:edit',
  'time:submit',
  'leave:submit',
  'vendor_invoice:update_allocations',
  'vendor_invoice:update_lines',
  'vendor_invoice:link_po',
  'vendor_invoice:unlink_po',
  'vendor_invoice:submit',
  '*:approve',
  '*:reject',
] as const;

const PHASE2_APPROVAL_EVIDENCE_REQUIRED_ACTIONS = [
  'estimate:send',
  'invoice:send',
  'purchase_order:send',
] as const;

const PHASE3_ACTION_POLICY_REQUIRED_ACTIONS = ['*:*'] as const;

type ActionPolicyEnforcementPreset = 'off' | 'phase2_core' | 'phase3_strict';

function normalizeString(value: string | undefined) {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePreset(
  presetText: string | undefined,
): ActionPolicyEnforcementPreset {
  const normalized = normalizeString(presetText)?.toLowerCase();
  if (normalized === 'phase2_core') return 'phase2_core';
  if (normalized === 'phase3_strict') return 'phase3_strict';
  return 'off';
}

function toCsv(items: readonly string[]) {
  return items.join(',');
}

export function getActionPolicyEnforcementPreset(
  presetText: string | undefined = process.env.ACTION_POLICY_ENFORCEMENT_PRESET,
) {
  return normalizePreset(presetText);
}

export function resolveActionPolicyRequiredActionsText(
  requiredActionsText: string | undefined = process.env
    .ACTION_POLICY_REQUIRED_ACTIONS,
  presetText: string | undefined = process.env.ACTION_POLICY_ENFORCEMENT_PRESET,
) {
  const explicit = normalizeString(requiredActionsText);
  if (explicit) return explicit;
  const preset = normalizePreset(presetText);
  if (preset === 'phase2_core') {
    return toCsv(PHASE2_ACTION_POLICY_REQUIRED_ACTIONS);
  }
  if (preset === 'phase3_strict') {
    return toCsv(PHASE3_ACTION_POLICY_REQUIRED_ACTIONS);
  }
  return undefined;
}

export function resolveApprovalEvidenceRequiredActionsText(
  requiredActionsText: string | undefined = process.env
    .APPROVAL_EVIDENCE_REQUIRED_ACTIONS,
  presetText: string | undefined = process.env.ACTION_POLICY_ENFORCEMENT_PRESET,
) {
  const explicit = normalizeString(requiredActionsText);
  if (explicit) return explicit;
  const preset = normalizePreset(presetText);
  if (preset === 'phase2_core' || preset === 'phase3_strict') {
    return toCsv(PHASE2_APPROVAL_EVIDENCE_REQUIRED_ACTIONS);
  }
  return undefined;
}
