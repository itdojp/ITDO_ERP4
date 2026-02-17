import type { Prisma } from '@prisma/client';
import { normalizeStringArray } from './inputParsers.js';

export type NormalizedMentions = {
  mentions: Prisma.InputJsonValue | undefined;
  mentionsAll: boolean;
  mentionUserIds: string[];
  mentionGroupIds: string[];
};

export function normalizeMentions(value: unknown): NormalizedMentions {
  if (!value || typeof value !== 'object') {
    return {
      mentions: undefined,
      mentionsAll: false,
      mentionUserIds: [],
      mentionGroupIds: [],
    };
  }
  const record = value as {
    userIds?: unknown;
    groupIds?: unknown;
    all?: unknown;
  };
  const mentionUserIds = normalizeStringArray(record.userIds, {
    dedupe: true,
    max: 50,
  });
  const mentionGroupIds = normalizeStringArray(record.groupIds, {
    dedupe: true,
    max: 20,
  });
  const mentionsAll = record.all === true;
  const mentions =
    mentionUserIds.length || mentionGroupIds.length
      ? ({
          userIds: mentionUserIds.length ? mentionUserIds : undefined,
          groupIds: mentionGroupIds.length ? mentionGroupIds : undefined,
        } as Prisma.InputJsonValue)
      : undefined;
  return { mentions, mentionsAll, mentionUserIds, mentionGroupIds };
}
