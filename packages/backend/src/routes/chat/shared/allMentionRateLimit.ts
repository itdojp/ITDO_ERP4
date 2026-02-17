import { prisma } from '../../../services/db.js';
import { parseNonNegativeInt } from './inputParsers.js';

export type AllMentionRateLimit =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'min_interval';
      minIntervalSeconds: number;
      lastAt: Date;
    }
  | {
      allowed: false;
      reason: 'max_24h';
      maxPer24h: number;
      windowStart: Date;
    };

export async function enforceAllMentionRateLimit(options: {
  projectId: string;
  userId: string;
  now: Date;
}): Promise<AllMentionRateLimit> {
  const minIntervalSeconds = parseNonNegativeInt(
    process.env.CHAT_ALL_MENTION_MIN_INTERVAL_SECONDS,
    60 * 60,
  );
  const maxPer24h = parseNonNegativeInt(
    process.env.CHAT_ALL_MENTION_MAX_PER_24H,
    3,
  );

  const since24h = new Date(options.now.getTime() - 24 * 60 * 60 * 1000);

  const [lastAll, count24h] = await Promise.all([
    minIntervalSeconds > 0
      ? prisma.chatMessage.findFirst({
          where: {
            roomId: options.projectId,
            userId: options.userId,
            mentionsAll: true,
            deletedAt: null,
          },
          select: { createdAt: true },
          orderBy: { createdAt: 'desc' },
        })
      : Promise.resolve(null),
    maxPer24h > 0
      ? prisma.chatMessage.count({
          where: {
            roomId: options.projectId,
            userId: options.userId,
            mentionsAll: true,
            deletedAt: null,
            createdAt: { gte: since24h },
          },
        })
      : Promise.resolve(0),
  ]);

  if (
    minIntervalSeconds > 0 &&
    lastAll &&
    options.now.getTime() - lastAll.createdAt.getTime() <
      minIntervalSeconds * 1000
  ) {
    return {
      allowed: false,
      reason: 'min_interval',
      minIntervalSeconds,
      lastAt: lastAll.createdAt,
    };
  }
  if (maxPer24h > 0 && count24h >= maxPer24h) {
    return {
      allowed: false,
      reason: 'max_24h',
      maxPer24h,
      windowStart: since24h,
    };
  }
  return { allowed: true };
}

export function buildAllMentionBlockedMetadata(
  projectId: string,
  rateLimit: Exclude<AllMentionRateLimit, { allowed: true }>,
) {
  const metadata: Record<string, unknown> = {
    projectId,
    reason: rateLimit.reason,
  };
  if (rateLimit.reason === 'min_interval') {
    metadata.minIntervalSeconds = rateLimit.minIntervalSeconds;
    metadata.lastAt = rateLimit.lastAt.toISOString();
  }
  if (rateLimit.reason === 'max_24h') {
    metadata.maxPer24h = rateLimit.maxPer24h;
    metadata.windowStart = rateLimit.windowStart.toISOString();
  }
  return metadata;
}
