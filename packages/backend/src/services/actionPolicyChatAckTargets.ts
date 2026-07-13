const ACTION_POLICY_CHAT_ACK_TARGET_TABLES = new Set(['approval_instances']);

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isAllowedActionPolicyChatAckLinkTargetTable(value: unknown) {
  const normalized = normalizeString(value);
  return ACTION_POLICY_CHAT_ACK_TARGET_TABLES.has(normalized);
}
