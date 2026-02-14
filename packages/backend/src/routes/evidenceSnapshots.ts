import { createHash } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { requireRole } from '../services/rbac.js';
import {
  evidenceSnapshotCreateSchema,
  evidenceSnapshotHistoryQuerySchema,
} from './validators.js';

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

function normalizeLimit(value: unknown) {
  if (value === undefined || value === null) return 50;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function resolveAnnotationTargetKind(targetTable: string) {
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

function canReadApprovalInstance(
  approval: {
    projectId: string | null;
    createdBy: string | null;
  },
  user: {
    userId?: string;
    roles?: string[];
    projectIds?: string[];
  } | null,
) {
  const roles = user?.roles ?? [];
  if (
    roles.includes('admin') ||
    roles.includes('mgmt') ||
    roles.includes('exec')
  ) {
    return true;
  }
  const userId = normalizeString(user?.userId);
  if (!userId) return false;
  if (approval.createdBy === userId) return true;
  const projectIds = user?.projectIds ?? [];
  if (approval.projectId && projectIds.includes(approval.projectId))
    return true;
  return false;
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

  const rows = await prisma.chatMessage.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      roomId: true,
      userId: true,
      createdAt: true,
      body: true,
    },
  });
  const rowMap = new Map(rows.map((row) => [row.id, row] as const));
  const items: SnapshotChatMessage[] = [];
  for (const id of ids) {
    const row = rowMap.get(id);
    if (!row) continue;
    const bodyHash = hashBody(row.body);
    items.push({
      id: row.id,
      roomId: row.roomId,
      userId: row.userId,
      createdAt: row.createdAt.toISOString(),
      excerpt: toExcerpt(row.body),
      ...(bodyHash ? { bodyHash } : {}),
    });
  }
  return items;
}

export async function registerEvidenceSnapshotRoutes(app: FastifyInstance) {
  app.post(
    '/approval-instances/:id/evidence-snapshot',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: evidenceSnapshotCreateSchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        forceRegenerate?: boolean;
        reasonText?: string;
      };
      const actorUserId = req.user?.userId ?? null;
      const reasonText = normalizeString(body.reasonText);
      const forceRegenerate = Boolean(body.forceRegenerate);

      const approval = await prisma.approvalInstance.findUnique({
        where: { id },
        select: {
          id: true,
          targetTable: true,
          targetId: true,
        },
      });
      if (!approval) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Approval instance not found' },
        });
      }
      const targetKind = resolveAnnotationTargetKind(approval.targetTable);
      if (!targetKind) {
        return reply.status(400).send({
          error: {
            code: 'UNSUPPORTED_TARGET',
            message: `targetTable is not supported: ${approval.targetTable}`,
          },
        });
      }

      const latest = await prisma.evidenceSnapshot.findFirst({
        where: { approvalInstanceId: approval.id },
        orderBy: { version: 'desc' },
      });
      if (latest && !forceRegenerate) {
        return {
          created: false,
          snapshot: latest,
        };
      }
      if (latest && forceRegenerate && !reasonText) {
        return reply.status(400).send({
          error: {
            code: 'REASON_REQUIRED',
            message: 'reasonText is required when forceRegenerate=true',
          },
        });
      }

      const annotation = await prisma.annotation.findUnique({
        where: {
          targetKind_targetId: {
            targetKind,
            targetId: approval.targetId,
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
      const chatMessages = await buildSnapshotChatMessages(internalRefs);
      const items = {
        notes: annotation?.notes ?? null,
        externalUrls,
        internalRefs,
        chatMessages,
      };
      const version = (latest?.version ?? 0) + 1;
      const created = await prisma.evidenceSnapshot.create({
        data: {
          approvalInstanceId: approval.id,
          targetTable: approval.targetTable,
          targetId: approval.targetId,
          sourceAnnotationUpdatedAt: annotation?.updatedAt ?? null,
          capturedBy: actorUserId,
          version,
          items: items as Prisma.InputJsonValue,
        },
      });

      await logAudit({
        action: latest
          ? 'evidence_snapshot_regenerated'
          : 'evidence_snapshot_created',
        targetTable: 'evidence_snapshots',
        targetId: created.id,
        reasonText: reasonText || undefined,
        metadata: {
          approvalInstanceId: created.approvalInstanceId,
          targetTable: created.targetTable,
          targetId: created.targetId,
          version: created.version,
          sourceAnnotationUpdatedAt:
            created.sourceAnnotationUpdatedAt?.toISOString() ?? null,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return {
        created: true,
        snapshot: created,
      };
    },
  );

  app.get(
    '/approval-instances/:id/evidence-snapshot',
    { preHandler: requireRole(['admin', 'mgmt', 'exec', 'user']) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const approval = await prisma.approvalInstance.findUnique({
        where: { id },
        select: {
          id: true,
          projectId: true,
          createdBy: true,
        },
      });
      if (!approval) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Approval instance not found' },
        });
      }
      if (!canReadApprovalInstance(approval, req.user ?? null)) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Access denied' },
        });
      }
      const latest = await prisma.evidenceSnapshot.findFirst({
        where: { approvalInstanceId: approval.id },
        orderBy: { version: 'desc' },
      });
      if (!latest) return { exists: false };

      await logAudit({
        action: 'evidence_snapshot_viewed',
        targetTable: 'evidence_snapshots',
        targetId: latest.id,
        metadata: {
          approvalInstanceId: latest.approvalInstanceId,
          version: latest.version,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return {
        exists: true,
        snapshot: latest,
      };
    },
  );

  app.get(
    '/approval-instances/:id/evidence-snapshot/history',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: evidenceSnapshotHistoryQuerySchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const query = req.query as { limit?: number };
      const approval = await prisma.approvalInstance.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!approval) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Approval instance not found' },
        });
      }

      const items = await prisma.evidenceSnapshot.findMany({
        where: { approvalInstanceId: approval.id },
        orderBy: { version: 'desc' },
        take: normalizeLimit(query.limit),
      });
      return { items };
    },
  );
}
