import { createHash } from 'node:crypto';

import type {
  KnowledgeActor,
  KnowledgeAuditActor,
  KnowledgeAuditActorContext,
} from './knowledgeItemPorts.js';
import {
  KnowledgeProvenanceConflictError,
  knowledgeProvenanceLimits,
  type KnowledgeConversationRole,
  type KnowledgeProvenanceOrigin,
} from './knowledgeProvenancePorts.js';

export type KnowledgeProvenanceFailure = {
  ok: false;
  statusCode: 400 | 404 | 409;
  code: 'invalid_request' | 'not_found' | 'version_conflict';
  message: string;
};

export type KnowledgeProvenanceResult<T> =
  { ok: true; value: T } | KnowledgeProvenanceFailure;

export function provenanceOk<T>(value: T): KnowledgeProvenanceResult<T> {
  return { ok: true, value };
}

export function provenanceInvalid(
  message = 'Invalid request',
): KnowledgeProvenanceFailure {
  return {
    ok: false,
    statusCode: 400,
    code: 'invalid_request',
    message,
  };
}

export function provenanceNotFound(): KnowledgeProvenanceFailure {
  return {
    ok: false,
    statusCode: 404,
    code: 'not_found',
    message: 'Not found',
  };
}

export function provenanceConflict(): KnowledgeProvenanceFailure {
  return {
    ok: false,
    statusCode: 409,
    code: 'version_conflict',
    message: 'Version conflict',
  };
}

export async function runKnowledgeProvenanceMutation<T>(
  work: () => Promise<KnowledgeProvenanceResult<T>>,
): Promise<KnowledgeProvenanceResult<T>> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof KnowledgeProvenanceConflictError) {
      return provenanceConflict();
    }
    throw error;
  }
}

export function hasKnowledgePrincipal(actor: KnowledgeActor): boolean {
  return typeof actor.userId === 'string' && actor.userId.trim().length > 0;
}

export function isBoundedKnowledgeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    [...value].length <= knowledgeProvenanceLimits.id
  );
}

export function isAllowedKnowledgeValue<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return (
    typeof value === 'string' && values.some((candidate) => candidate === value)
  );
}

export function normalizeBoundedText(
  value: unknown,
  maximumCodePoints: number,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized.length === 0 || [...normalized].length > maximumCodePoints) {
    return null;
  }
  return normalized;
}

export function normalizeOptionalBoundedText(
  value: unknown,
  maximumCodePoints: number,
): string | null | undefined {
  if (value === undefined || value === null) return null;
  return normalizeBoundedText(value, maximumCodePoints) ?? undefined;
}

export function normalizeBoundedContent(
  value: unknown,
  maximumBytes: number,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    Buffer.byteLength(normalized, 'utf8') > maximumBytes
  ) {
    return null;
  }
  return normalized;
}

const rfc3339DateTime =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/i;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseOptionalKnowledgeDate(
  value: unknown,
): Date | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = rfc3339DateTime.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[8] ?? 0);
  const offsetMinute = Number(match[9] ?? 0);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

export function isValidKnowledgeVersion(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= knowledgeProvenanceLimits.expectedVersion
  );
}

export function isValidKnowledgeListLimit(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= knowledgeProvenanceLimits.listLimit
  );
}

export function knowledgeProvenanceAuditActor(
  actor: KnowledgeActor,
  context: KnowledgeAuditActorContext,
): KnowledgeAuditActor {
  return {
    userId: actor.userId,
    requestId: context.requestId,
    source: context.source,
  };
}

export function sha256KnowledgeText(domain: string, value: string): string {
  return createHash('sha256')
    .update(`erp4:knowledge:${domain}:v1\0`, 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

export function isRoleOriginCompatible(
  role: KnowledgeConversationRole,
  origin: KnowledgeProvenanceOrigin,
): boolean {
  if (role === 'user') return origin === 'user' || origin === 'external';
  if (role === 'assistant') return origin === 'ai' || origin === 'external';
  if (role === 'system') return origin === 'system';
  return origin === 'tool';
}
