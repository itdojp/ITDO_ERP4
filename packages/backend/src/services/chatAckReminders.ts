import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';

const DEFAULT_LIMIT = 200;
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_MIN_INTERVAL_HOURS = 24;

type RunChatAckReminderOptions = {
  dryRun?: boolean;
  limit?: number;
  actorId?: string | null;
};

export type RunChatAckReminderResult = {
  ok: true;
  dryRun: boolean;
  now: string;
  lookbackDays: number;
  minIntervalHours: number;
  scannedRequests: number;
  skippedCompletedRequests: number;
  candidateNotifications: number;
  skippedAlreadyNotified: number;
  createdNotifications: number;
  sampleMessageIds: string[];
};

function parsePositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(
  value: unknown,
  options: { dedupe?: boolean; max?: number } = {},
): string[] {
  if (!Array.isArray(value)) return [];
  const max = options.max && options.max > 0 ? options.max : null;
  const out: string[] = [];
  const seen = options.dedupe ? new Set<string>() : null;
  for (const item of value) {
    const trimmed = normalizeString(item);
    if (!trimmed) continue;
    if (seen) {
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
    }
    out.push(trimmed);
    if (max && out.length >= max) break;
  }
  return out;
}

function buildExcerpt(body: string) {
  return body.replace(/\s+/g, ' ').trim().slice(0, 140);
}

export async function runChatAckReminders(
  options: RunChatAckReminderOptions = {},
): Promise<RunChatAckReminderResult> {
  const dryRun = Boolean(options.dryRun);
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit ?? DEFAULT_LIMIT)),
    500,
  );
  const lookbackDays = parsePositiveIntEnv(
    'CHAT_ACK_REMINDER_LOOKBACK_DAYS',
    DEFAULT_LOOKBACK_DAYS,
  );
  const minIntervalHours = parsePositiveIntEnv(
    'CHAT_ACK_REMINDER_MIN_INTERVAL_HOURS',
    DEFAULT_MIN_INTERVAL_HOURS,
  );

  const now = new Date();
  const lookbackFrom = new Date(
    now.getTime() - lookbackDays * 24 * 60 * 60 * 1000,
  );
  const notifiedSince = new Date(
    now.getTime() - minIntervalHours * 60 * 60 * 1000,
  );

  const requests = await prisma.chatAckRequest.findMany({
    where: {
      dueAt: {
        not: null,
        lte: now,
        gte: lookbackFrom,
      },
      canceledAt: null,
      message: { deletedAt: null },
    },
    orderBy: [{ dueAt: 'asc' }],
    take: limit,
    include: {
      acks: { select: { userId: true } },
      message: { select: { userId: true, body: true } },
    },
  });

  let skippedCompletedRequests = 0;
  type Candidate = {
    userId: string;
    projectId: string;
    messageId: string;
    dueAt: Date;
    senderUserId: string;
    excerpt: string;
    requiredCount: number;
  };
  const candidates: Candidate[] = [];

  for (const request of requests) {
    if (!request.dueAt) continue;
    const requiredUserIds = normalizeStringArray(request.requiredUserIds, {
      dedupe: true,
      max: 50,
    });
    const requiredCount = requiredUserIds.length;
    if (requiredCount <= 0) continue;

    const senderUserId = normalizeString(request.message?.userId);
    const ackedUserIds = new Set(
      request.acks.map((ack) => normalizeString(ack.userId)).filter(Boolean),
    );
    const incompleteUserIds = requiredUserIds.filter(
      (userId) => userId !== senderUserId && !ackedUserIds.has(userId),
    );
    if (!incompleteUserIds.length) {
      skippedCompletedRequests += 1;
      continue;
    }
    const excerpt = buildExcerpt(request.message?.body ?? '');
    for (const userId of incompleteUserIds) {
      candidates.push({
        userId,
        projectId: request.roomId,
        messageId: request.messageId,
        dueAt: request.dueAt,
        senderUserId,
        excerpt,
        requiredCount,
      });
    }
  }

  const uniqueMessageIds = Array.from(
    new Set(candidates.map((item) => item.messageId)),
  );
  const uniqueUserIds = Array.from(
    new Set(candidates.map((item) => item.userId)),
  );

  const existing = uniqueMessageIds.length
    ? await prisma.appNotification.findMany({
        where: {
          kind: 'chat_ack_required',
          messageId: { in: uniqueMessageIds },
          userId: { in: uniqueUserIds },
          createdAt: { gte: notifiedSince },
        },
        select: { messageId: true, userId: true, createdAt: true },
      })
    : [];

  const latestNotifiedAt = new Map<string, Date>();
  for (const item of existing) {
    if (!item.messageId) continue;
    const key = `${item.messageId}:${item.userId}`;
    const prev = latestNotifiedAt.get(key);
    if (!prev || item.createdAt > prev) {
      latestNotifiedAt.set(key, item.createdAt);
    }
  }

  const toCreate: Candidate[] = [];
  let skippedAlreadyNotified = 0;
  for (const candidate of candidates) {
    const threshold =
      candidate.dueAt > notifiedSince ? candidate.dueAt : notifiedSince;
    const key = `${candidate.messageId}:${candidate.userId}`;
    const last = latestNotifiedAt.get(key);
    if (last && last >= threshold) {
      skippedAlreadyNotified += 1;
      continue;
    }
    toCreate.push(candidate);
  }

  const createdNotifications = dryRun
    ? toCreate.length
    : (
        await prisma.appNotification.createMany({
          data: toCreate.map((item) => ({
            userId: item.userId,
            kind: 'chat_ack_required',
            projectId: item.projectId,
            messageId: item.messageId,
            payload: {
              fromUserId: item.senderUserId,
              excerpt: item.excerpt,
              dueAt: item.dueAt.toISOString(),
              requiredCount: item.requiredCount,
            } as Prisma.InputJsonValue,
            createdBy: options.actorId ?? undefined,
            updatedBy: options.actorId ?? undefined,
          })),
        })
      ).count;

  return {
    ok: true,
    dryRun,
    now: now.toISOString(),
    lookbackDays,
    minIntervalHours,
    scannedRequests: requests.length,
    skippedCompletedRequests,
    candidateNotifications: candidates.length,
    skippedAlreadyNotified,
    createdNotifications,
    sampleMessageIds: uniqueMessageIds.slice(0, 20),
  };
}
