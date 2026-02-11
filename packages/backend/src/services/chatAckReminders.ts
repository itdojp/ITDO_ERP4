import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { filterNotificationRecipients } from './appNotifications.js';
import { resolveChatAckRequiredRecipientUserIds } from './chatAckRecipients.js';

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
  candidateEscalations: number;
  skippedAlreadyNotified: number;
  createdNotifications: number;
  createdEscalations: number;
  sampleMessageIds: string[];
};

function parsePositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function normalizeIntervalHours(value: unknown, fallback: number) {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
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
  const defaultMinIntervalHours = parsePositiveIntEnv(
    'CHAT_ACK_REMINDER_MIN_INTERVAL_HOURS',
    DEFAULT_MIN_INTERVAL_HOURS,
  );

  const now = new Date();
  const lookbackFrom = new Date(
    now.getTime() - lookbackDays * 24 * 60 * 60 * 1000,
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
      room: { select: { type: true } },
    },
  });

  let maxIntervalHours = defaultMinIntervalHours;
  let skippedCompletedRequests = 0;
  type Candidate = {
    userId: string;
    projectId: string | null;
    roomId: string | null;
    messageId: string;
    dueAt: Date;
    senderUserId: string;
    excerpt: string;
    requiredCount: number;
    remindIntervalHours: number;
    thresholdAt: Date;
    isEscalation: boolean;
    kind: string;
  };
  const candidates: Candidate[] = [];
  const escalationCandidates: Candidate[] = [];
  const reminderKind = 'chat_ack_required';
  const escalationKind = 'chat_ack_escalation';

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
    const remindIntervalHours = normalizeIntervalHours(
      request.remindIntervalHours,
      defaultMinIntervalHours,
    );
    maxIntervalHours = Math.max(maxIntervalHours, remindIntervalHours);
    const excerpt = buildExcerpt(request.message?.body ?? '');
    const projectId = request.room.type === 'project' ? request.roomId : null;
    const roomId = normalizeString(request.roomId) || null;
    for (const userId of incompleteUserIds) {
      candidates.push({
        userId,
        projectId,
        roomId,
        messageId: request.messageId,
        dueAt: request.dueAt,
        senderUserId,
        excerpt,
        requiredCount,
        remindIntervalHours,
        thresholdAt: request.dueAt,
        isEscalation: false,
        kind: reminderKind,
      });
    }

    const escalationAfterHours = normalizeIntervalHours(
      request.escalationAfterHours,
      0,
    );
    if (escalationAfterHours > 0) {
      const escalationDueAt = new Date(
        request.dueAt.getTime() + escalationAfterHours * 3600 * 1000,
      );
      if (now >= escalationDueAt) {
        const escalationUserIds = await resolveChatAckRequiredRecipientUserIds({
          requiredUserIds: normalizeStringArray(request.escalationUserIds, {
            dedupe: true,
            max: 200,
          }),
          requiredGroupIds: normalizeStringArray(request.escalationGroupIds, {
            dedupe: true,
            max: 200,
          }),
          requiredRoles: normalizeStringArray(request.escalationRoles, {
            dedupe: true,
            max: 200,
          }),
        });
        for (const userId of escalationUserIds) {
          escalationCandidates.push({
            userId,
            projectId,
            roomId,
            messageId: request.messageId,
            dueAt: request.dueAt,
            senderUserId,
            excerpt,
            requiredCount,
            remindIntervalHours,
            thresholdAt: escalationDueAt,
            isEscalation: true,
            kind: escalationKind,
          });
        }
      }
    }
  }

  const allCandidates = [...candidates, ...escalationCandidates];
  const uniqueMessageIds = Array.from(
    new Set(allCandidates.map((item) => item.messageId)),
  );
  const uniqueUserIds = Array.from(
    new Set(allCandidates.map((item) => item.userId)),
  );

  const notifiedSince = new Date(
    now.getTime() - maxIntervalHours * 60 * 60 * 1000,
  );

  const existingReminders = uniqueMessageIds.length
    ? await prisma.appNotification.findMany({
        where: {
          kind: reminderKind,
          messageId: { in: uniqueMessageIds },
          userId: { in: uniqueUserIds },
          createdAt: { gte: notifiedSince },
        },
        select: { messageId: true, userId: true, createdAt: true },
      })
    : [];

  const latestNotifiedAt = new Map<string, Date>();
  for (const item of existingReminders) {
    if (!item.messageId) continue;
    const key = `${item.messageId}:${item.userId}`;
    const prev = latestNotifiedAt.get(key);
    if (!prev || item.createdAt > prev) {
      latestNotifiedAt.set(key, item.createdAt);
    }
  }

  const existingEscalations = uniqueMessageIds.length
    ? await prisma.appNotification.findMany({
        where: {
          kind: escalationKind,
          messageId: { in: uniqueMessageIds },
          userId: { in: uniqueUserIds },
        },
        select: { messageId: true, userId: true },
      })
    : [];
  const escalationSentKeys = new Set<string>();
  for (const item of existingEscalations) {
    if (!item.messageId) continue;
    escalationSentKeys.add(`${item.messageId}:${item.userId}`);
  }

  const toCreate: Candidate[] = [];
  let skippedAlreadyNotified = 0;
  for (const candidate of allCandidates) {
    if (candidate.isEscalation) {
      const key = `${candidate.messageId}:${candidate.userId}`;
      if (escalationSentKeys.has(key)) {
        skippedAlreadyNotified += 1;
        continue;
      }
      toCreate.push(candidate);
      continue;
    }
    const candidateNotifiedSince = new Date(
      now.getTime() - candidate.remindIntervalHours * 60 * 60 * 1000,
    );
    const threshold =
      candidate.thresholdAt > candidateNotifiedSince
        ? candidate.thresholdAt
        : candidateNotifiedSince;
    const key = `${candidate.messageId}:${candidate.userId}`;
    const last = latestNotifiedAt.get(key);
    if (last && last >= threshold) {
      skippedAlreadyNotified += 1;
      continue;
    }
    toCreate.push(candidate);
  }

  const grouped = new Map<
    string,
    {
      kind: string;
      roomId: string | null;
      scope: 'global' | 'chat_mentions';
      userIds: Set<string>;
    }
  >();
  for (const candidate of toCreate) {
    const scope = candidate.kind === reminderKind ? 'chat_mentions' : 'global';
    const key = `${candidate.kind}:${candidate.roomId ?? ''}:${scope}`;
    const current = grouped.get(key) ?? {
      kind: candidate.kind,
      roomId: candidate.roomId,
      scope,
      userIds: new Set<string>(),
    };
    current.userIds.add(candidate.userId);
    grouped.set(key, current);
  }

  const allowedByKey = new Map<string, Set<string>>();
  const groupedEntries = Array.from(grouped.entries());
  const filteredEntries = await Promise.all(
    groupedEntries.map(async ([key, group]) => {
      const filtered = await filterNotificationRecipients({
        kind: group.kind,
        roomId: group.roomId,
        userIds: Array.from(group.userIds),
        scope: group.scope,
      });
      return [key, new Set(filtered.allowed)] as const;
    }),
  );
  for (const [key, allowed] of filteredEntries) {
    allowedByKey.set(key, allowed);
  }

  const filteredToCreate = toCreate.filter((candidate) => {
    const scope = candidate.kind === reminderKind ? 'chat_mentions' : 'global';
    const key = `${candidate.kind}:${candidate.roomId ?? ''}:${scope}`;
    const allowed = allowedByKey.get(key);
    return Boolean(allowed?.has(candidate.userId));
  });

  const createdNotifications = dryRun
    ? filteredToCreate.length
    : (
        await prisma.appNotification.createMany({
          data: filteredToCreate.map((item) => ({
            userId: item.userId,
            kind: item.kind,
            projectId: item.projectId ?? null,
            messageId: item.messageId,
            payload: {
              fromUserId: item.senderUserId,
              roomId: item.roomId || undefined,
              excerpt: item.excerpt,
              dueAt: item.dueAt.toISOString(),
              requiredCount: item.requiredCount,
              escalation: item.isEscalation || undefined,
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
    minIntervalHours: defaultMinIntervalHours,
    scannedRequests: requests.length,
    skippedCompletedRequests,
    candidateNotifications: candidates.length,
    candidateEscalations: escalationCandidates.length,
    skippedAlreadyNotified,
    createdNotifications,
    createdEscalations: filteredToCreate.filter((item) => item.isEscalation)
      .length,
    sampleMessageIds: uniqueMessageIds.slice(0, 20),
  };
}
