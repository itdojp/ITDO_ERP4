import { prisma } from './db.js';

const ALLOWED_TARGET_TABLES = new Set(['approval_instances']);

export type ChatAckLinkTargetValidationResult =
  | { ok: true; targetTable: 'approval_instances'; targetId: string }
  | {
      ok: false;
      reason: 'invalid_target_table' | 'target_not_found';
    };

type ChatAckLinkTargetClient = {
  approvalInstance: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
};

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function validateChatAckLinkTarget(options: {
  targetTable: string;
  targetId: string;
  client?: ChatAckLinkTargetClient;
}): Promise<ChatAckLinkTargetValidationResult> {
  const targetTable = normalizeString(options.targetTable);
  const targetId = normalizeString(options.targetId);
  if (!isAllowedChatAckLinkTargetTable(targetTable)) {
    return { ok: false, reason: 'invalid_target_table' };
  }
  const client = options.client ?? prisma;
  const target = await client.approvalInstance.findUnique({
    where: { id: targetId },
    select: { id: true },
  });
  if (!target) {
    return { ok: false, reason: 'target_not_found' };
  }
  return { ok: true, targetTable: 'approval_instances', targetId };
}

export function isAllowedChatAckLinkTargetTable(value: string) {
  const normalized = normalizeString(value);
  return ALLOWED_TARGET_TABLES.has(normalized);
}
