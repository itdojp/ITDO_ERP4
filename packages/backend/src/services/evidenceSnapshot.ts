import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

type InternalRef = {
  kind: string;
  id: string;
  label?: string;
};

type SnapshotChatMessage = {
  id: string;
  roomId: string;
  userId: string;
  createdAt: string;
  excerpt: string;
  bodyHash?: string;
};

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveEvidenceSnapshotTargetKind(targetTable: string) {
  const normalized = targetTable.trim().toLowerCase();
  switch (normalized) {
    case 'estimate':
    case 'estimates':
      return 'estimate';
    case 'invoice':
    case 'invoices':
      return 'invoice';
    case 'purchase_order':
    case 'purchase_orders':
      return 'purchase_order';
    case 'vendor_quote':
    case 'vendor_quotes':
      return 'vendor_quote';
    case 'vendor_invoice':
    case 'vendor_invoices':
      return 'vendor_invoice';
    case 'expense':
    case 'expenses':
      return 'expense';
    case 'project':
    case 'projects':
      return 'project';
    case 'customer':
    case 'customers':
      return 'customer';
    case 'vendor':
    case 'vendors':
      return 'vendor';
    default:
      return null;
  }
}

function normalizeInternalRefs(value: unknown): InternalRef[] {
  if (!Array.isArray(value)) return [];
  const refs: InternalRef[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const kind = normalizeString(record.kind);
    const id = normalizeString(record.id);
    if (!kind || !id) continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = normalizeString(record.label);
    refs.push(label ? { kind, id, label } : { kind, id });
  }
  return refs;
}

function normalizeExternalUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const url = normalizeString(entry);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function toExcerpt(body: string, maxLength = 120) {
  const compact = body.replace(/\s+/g, ' ').trim();
  if (!compact) return '(no body)';
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
}

function hashBody(body: string) {
  const normalized = body.trim();
  if (!normalized) return '';
  return createHash('sha256').update(normalized).digest('hex');
}

async function buildSnapshotChatMessages(
  client: any,
  refs: InternalRef[],
): Promise<SnapshotChatMessage[]> {
  const ids = Array.from(
    new Set(
      refs
        .filter((ref) => ref.kind === 'chat_message')
        .map((ref) => normalizeString(ref.id))
        .filter(Boolean),
    ),
  );
  if (ids.length === 0) return [];

  const rows = (await client.chatMessage.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      roomId: true,
      userId: true,
      createdAt: true,
      body: true,
    },
  })) as Array<{
    id: string;
    roomId: string;
    userId: string;
    createdAt: Date;
    body: string;
  }>;
  const rowMap = new Map(rows.map((row: any) => [row.id, row] as const));
  const items: SnapshotChatMessage[] = [];
  for (const id of ids) {
    const row = rowMap.get(id);
    if (!row) continue;
    const bodyHash = hashBody(String(row.body ?? ''));
    items.push({
      id: row.id,
      roomId: row.roomId,
      userId: row.userId,
      createdAt: row.createdAt.toISOString(),
      excerpt: toExcerpt(String(row.body ?? '')),
      ...(bodyHash ? { bodyHash } : {}),
    });
  }
  return items;
}

export async function createEvidenceSnapshotForApproval(
  client: any,
  input: {
    approvalInstanceId: string;
    targetTable: string;
    targetId: string;
    capturedBy?: string | null;
    forceRegenerate?: boolean;
  },
) {
  const latest = await client.evidenceSnapshot.findFirst({
    where: { approvalInstanceId: input.approvalInstanceId },
    orderBy: { version: 'desc' },
  });
  if (latest && !input.forceRegenerate) {
    return {
      created: false as const,
      unsupportedTarget: false as const,
      snapshot: latest,
    };
  }

  const targetKind = resolveEvidenceSnapshotTargetKind(input.targetTable);
  if (!targetKind) {
    return {
      created: false as const,
      unsupportedTarget: true as const,
      snapshot: latest ?? null,
    };
  }

  const annotation = await client.annotation.findUnique({
    where: {
      targetKind_targetId: {
        targetKind,
        targetId: input.targetId,
      },
    },
    select: {
      notes: true,
      externalUrls: true,
      internalRefs: true,
      updatedAt: true,
    },
  });

  const internalRefs = normalizeInternalRefs(annotation?.internalRefs);
  const externalUrls = normalizeExternalUrls(annotation?.externalUrls);
  const chatMessages = await buildSnapshotChatMessages(client, internalRefs);
  const items = {
    notes: annotation?.notes ?? null,
    externalUrls,
    internalRefs,
    chatMessages,
  };

  const version = (latest?.version ?? 0) + 1;
  const snapshot = await client.evidenceSnapshot.create({
    data: {
      approvalInstanceId: input.approvalInstanceId,
      targetTable: input.targetTable,
      targetId: input.targetId,
      sourceAnnotationUpdatedAt: annotation?.updatedAt ?? null,
      capturedBy: input.capturedBy ?? null,
      version,
      items: items as Prisma.InputJsonValue,
    },
  });
  return {
    created: true as const,
    unsupportedTarget: false as const,
    snapshot,
  };
}
