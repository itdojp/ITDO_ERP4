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

function normalizeScopes(scopes: unknown): string[] {
  if (!Array.isArray(scopes)) return [];
  return scopes.map((scope) => String(scope).trim()).filter(Boolean);
}

function normalizeMethod(value: unknown) {
  const normalized = normalizeString(value).toUpperCase();
  return normalized || 'UNKNOWN';
}

function normalizePath(value: unknown) {
  const raw = normalizeString(value);
  if (!raw) return '/';
  const index = raw.indexOf('?');
  return index >= 0 ? raw.slice(0, index) || '/' : raw;
}

export async function persistDelegatedScopeDeniedAgentRun(input: {
  requestId?: string | null;
  method?: string | null;
  path?: string | null;
  principalUserId?: string | null;
  actorUserId?: string | null;
  scopes?: string[] | null;
}) {
  const method = normalizeMethod(input.method);
  const path = normalizePath(input.path);
  const startedAt = new Date();
  const finishedAt = startedAt;
  const statusCode = 403;
  const errorCode = 'scope_denied';
  const requestId = normalizeString(input.requestId) || null;
  const principalUserId = normalizeString(input.principalUserId) || null;
  const actorUserId = normalizeString(input.actorUserId) || null;
  const scopes = normalizeScopes(input.scopes);
  const { prisma } = await import('./db.js');

  return prisma.$transaction(async (tx) => {
    const run = await tx.agentRun.create({
      data: {
        requestId: requestId ?? undefined,
        source: 'agent',
        principalUserId: principalUserId ?? undefined,
        actorUserId: actorUserId ?? undefined,
        scopes,
        method,
        path,
        status: 'failed',
        httpStatus: statusCode,
        errorCode,
        startedAt,
        finishedAt,
        metadata: {
          routePath: path,
          requestId,
          deniedIn: 'auth_on_request',
        },
      },
      select: { id: true },
    });
    const step = await tx.agentStep.create({
      data: {
        runId: run.id,
        stepOrder: 1,
        kind: 'api_request',
        name: `${method} ${path}`,
        status: 'failed',
        errorCode,
        startedAt,
        finishedAt,
        input: {
          requestId,
          method,
          path,
        },
        output: {
          statusCode,
          errorCode,
        },
        metadata: {
          deniedIn: 'auth_on_request',
        },
      },
      select: { id: true },
    });
    return { runId: run.id, stepId: step.id };
  });
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
