import type { Prisma } from '@prisma/client';

const ERROR_CODE_ALIASES: Record<string, string> = {
  ACTION_POLICY_DENIED: 'policy_denied',
  POLICY_DENIED: 'policy_denied',
  APPROVAL_REQUIRED: 'approval_required',
  SCOPE_DENIED: 'scope_denied',
  REASON_REQUIRED: 'reason_required',
};

const DECISION_REQUEST_ERROR_CODES = new Set([
  'policy_denied',
  'approval_required',
]);

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeAgentErrorCode(raw: unknown): string | null {
  const normalized = normalizeString(raw);
  if (!normalized) return null;
  const alias = ERROR_CODE_ALIASES[normalized];
  if (alias) return alias;
  return normalized.toLowerCase();
}

export function shouldOpenDecisionRequest(errorCode: unknown) {
  const normalized = normalizeAgentErrorCode(errorCode);
  if (!normalized) return false;
  return DECISION_REQUEST_ERROR_CODES.has(normalized);
}

export function decisionTypeFromErrorCode(errorCode: unknown) {
  const normalized = normalizeAgentErrorCode(errorCode);
  if (normalized === 'approval_required') return 'approval_required';
  if (normalized === 'policy_denied') return 'policy_override';
  return 'manual_review';
}

function tryParseJsonPayload(payload: unknown): Record<string, unknown> | null {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  if (typeof payload !== 'string') return null;
  const trimmed = payload.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

export function extractAgentErrorCode(payload: unknown): string | null {
  const parsed = tryParseJsonPayload(payload);
  if (!parsed) return null;
  const error = parsed.error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  return normalizeAgentErrorCode((error as Record<string, unknown>).code);
}

export function extractAgentRunIdFromMetadata(
  metadata: Prisma.JsonValue | null | undefined,
) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const root = metadata as Record<string, unknown>;
  const agent = root._agent;
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)) {
    return null;
  }
  const runId = normalizeString((agent as Record<string, unknown>).runId);
  return runId || null;
}
