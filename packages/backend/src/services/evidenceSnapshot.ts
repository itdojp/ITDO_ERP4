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

type SnapshotSubject =
  | {
      kind: 'time_entry';
      timeEntry: {
        id: string;
        userId: string;
        projectId: string;
        taskId: string | null;
        workDate: string;
        minutes: number;
        workType: string | null;
        location: string | null;
        notes: string | null;
        status: string;
      };
    }
  | {
      kind: 'leave_request';
      leaveRequest: {
        id: string;
        userId: string;
        leaveType: string;
        startDate: string;
        endDate: string;
        hours: number | null;
        minutes: number | null;
        startTimeMinutes: number | null;
        endTimeMinutes: number | null;
        noConsultationConfirmed: boolean | null;
        noConsultationReason: string | null;
        status: string;
        notes: string | null;
      };
    };

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTargetTable(value: string) {
  return value.trim().toLowerCase();
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
    case 'leave_request':
    case 'leave_requests':
      return 'leave_request';
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

async function buildSnapshotSubject(
  client: any,
  input: { targetTable: string; targetId: string },
): Promise<SnapshotSubject | null> {
  const normalized = normalizeTargetTable(input.targetTable);
  if (normalized === 'time_entry' || normalized === 'time_entries') {
    const entry = await client.timeEntry?.findUnique?.({
      where: { id: input.targetId },
      select: {
        id: true,
        userId: true,
        projectId: true,
        taskId: true,
        workDate: true,
        minutes: true,
        workType: true,
        location: true,
        notes: true,
        status: true,
      },
    });
    if (!entry) return null;
    return {
      kind: 'time_entry',
      timeEntry: {
        id: entry.id,
        userId: entry.userId,
        projectId: entry.projectId,
        taskId: entry.taskId ?? null,
        workDate: new Date(entry.workDate).toISOString(),
        minutes: Number(entry.minutes ?? 0),
        workType: entry.workType ?? null,
        location: entry.location ?? null,
        notes: entry.notes ?? null,
        status: String(entry.status ?? ''),
      },
    };
  }
  if (normalized === 'leave_request' || normalized === 'leave_requests') {
    const request = await client.leaveRequest?.findUnique?.({
      where: { id: input.targetId },
      select: {
        id: true,
        userId: true,
        leaveType: true,
        startDate: true,
        endDate: true,
        hours: true,
        minutes: true,
        startTimeMinutes: true,
        endTimeMinutes: true,
        noConsultationConfirmed: true,
        noConsultationReason: true,
        status: true,
        notes: true,
      },
    });
    if (!request) return null;
    return {
      kind: 'leave_request',
      leaveRequest: {
        id: request.id,
        userId: request.userId,
        leaveType: request.leaveType,
        startDate: new Date(request.startDate).toISOString(),
        endDate: new Date(request.endDate).toISOString(),
        hours: typeof request.hours === 'number' ? Number(request.hours) : null,
        minutes:
          typeof request.minutes === 'number' ? Number(request.minutes) : null,
        startTimeMinutes:
          typeof request.startTimeMinutes === 'number'
            ? Number(request.startTimeMinutes)
            : null,
        endTimeMinutes:
          typeof request.endTimeMinutes === 'number'
            ? Number(request.endTimeMinutes)
            : null,
        noConsultationConfirmed:
          typeof request.noConsultationConfirmed === 'boolean'
            ? request.noConsultationConfirmed
            : null,
        noConsultationReason: request.noConsultationReason ?? null,
        status: String(request.status ?? ''),
        notes: request.notes ?? null,
      },
    };
  }
  return null;
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
  const subject = await buildSnapshotSubject(client, {
    targetTable: input.targetTable,
    targetId: input.targetId,
  });

  // Some targets are supported without Annotation (e.g. time_entries); others require it.
  if (!targetKind && !subject) {
    return {
      created: false as const,
      unsupportedTarget: true as const,
      snapshot: latest ?? null,
    };
  }

  const annotation = targetKind
    ? await client.annotation.findUnique({
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
      })
    : null;

  const internalRefs = normalizeInternalRefs(annotation?.internalRefs);
  const externalUrls = normalizeExternalUrls(annotation?.externalUrls);
  const chatMessages = await buildSnapshotChatMessages(client, internalRefs);
  const items = {
    ...(subject ? { subject } : {}),
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
