import { normalizeStringArray } from './inputParsers.js';

export function resolveAckRequiredTarget(
  requiredUserIdsRaw: unknown,
  userId: string,
) {
  const requiredUserIds = normalizeStringArray(requiredUserIdsRaw, {
    dedupe: true,
  });
  return {
    isRequired: requiredUserIds.includes(userId),
    requiredUserCount: requiredUserIds.length,
  };
}
