import { prisma } from './db.js';

export type MentionGroupCandidate = {
  groupId: string;
  displayName?: string | null;
};

function normalizeSelectors(selectors: string[], max = 200) {
  const items = selectors
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  const deduped = Array.from(new Set(items));
  return max > 0 ? deduped.slice(0, max) : deduped;
}

export async function resolveGroupCandidatesBySelector(selectors: string[]) {
  const normalized = normalizeSelectors(selectors);
  if (!normalized.length) return [] as MentionGroupCandidate[];
  const rows = await prisma.groupAccount.findMany({
    where: {
      active: true,
      OR: [{ id: { in: normalized } }, { displayName: { in: normalized } }],
    },
    select: { id: true, displayName: true },
  });
  const map = new Map<string, MentionGroupCandidate>();
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!id) continue;
    const displayName =
      typeof row.displayName === 'string' ? row.displayName.trim() : '';
    map.set(id, { groupId: id, displayName: displayName || null });
  }
  return Array.from(map.values()).sort((a, b) => {
    const left = a.displayName || a.groupId;
    const right = b.displayName || b.groupId;
    return left.localeCompare(right);
  });
}
