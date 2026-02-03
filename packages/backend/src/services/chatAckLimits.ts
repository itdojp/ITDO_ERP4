import { prisma } from './db.js';

const CHAT_SETTING_ID = 'default';
const MAX_LIMIT = 200;

export type ChatAckLimits = {
  maxUsers: number;
  maxGroups: number;
  maxRoles: number;
};

function normalizeLimit(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  if (normalized <= 0) return fallback;
  return Math.min(normalized, MAX_LIMIT);
}

export async function getChatAckLimits(): Promise<ChatAckLimits> {
  const setting = await prisma.chatSetting.findUnique({
    where: { id: CHAT_SETTING_ID },
    select: {
      ackMaxRequiredUsers: true,
      ackMaxRequiredGroups: true,
      ackMaxRequiredRoles: true,
    },
  });
  return {
    maxUsers: normalizeLimit(setting?.ackMaxRequiredUsers, 50),
    maxGroups: normalizeLimit(setting?.ackMaxRequiredGroups, 20),
    maxRoles: normalizeLimit(setting?.ackMaxRequiredRoles, 20),
  };
}
