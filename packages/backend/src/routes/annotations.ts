import { Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { prisma } from '../services/db.js';
import { requireUserContext } from '../services/authContext.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { requireRole } from '../services/rbac.js';
import { DocStatusValue } from '../types.js';
import { annotationPatchSchema } from './validators.js';

type AnnotationTargetKind =
  | 'estimate'
  | 'invoice'
  | 'purchase_order'
  | 'vendor_quote'
  | 'vendor_invoice'
  | 'expense'
  | 'project'
  | 'customer'
  | 'vendor';

type InternalRefKind =
  | 'invoice'
  | 'estimate'
  | 'purchase_order'
  | 'vendor_quote'
  | 'vendor_invoice'
  | 'expense'
  | 'project'
  | 'customer'
  | 'vendor'
  | 'time_entry'
  | 'daily_report'
  | 'leave_request'
  | 'project_chat'
  | 'room_chat'
  | 'chat_message';

type InternalRef = {
  kind: InternalRefKind;
  id: string;
  label?: string;
};

const ANNOTATION_SETTING_ID = 'default';

type AnnotationLimits = {
  maxExternalUrlCount: number;
  maxExternalUrlLength: number;
  maxExternalUrlTotalLength: number;
  maxNotesLength: number;
};

const DEFAULT_LIMITS: AnnotationLimits = {
  maxExternalUrlCount: 20,
  maxExternalUrlLength: 2048,
  maxExternalUrlTotalLength: 16384,
  maxNotesLength: 20000,
};

const MAX_HISTORY_LIMIT = 200;
const DEFAULT_HISTORY_LIMIT = 50;

const ADMIN_ONLY_TARGETS = new Set<AnnotationTargetKind>([
  'purchase_order',
  'vendor_quote',
  'vendor_invoice',
  'project',
  'customer',
  'vendor',
]);

const ALLOWED_INTERNAL_REF_KINDS = new Set<InternalRefKind>([
  'invoice',
  'estimate',
  'purchase_order',
  'vendor_quote',
  'vendor_invoice',
  'expense',
  'project',
  'customer',
  'vendor',
  'time_entry',
  'daily_report',
  'leave_request',
  'project_chat',
  'room_chat',
  'chat_message',
]);

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeHistoryLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_HISTORY_LIMIT;
  return Math.max(1, Math.min(MAX_HISTORY_LIMIT, Math.floor(parsed)));
}

function resolveActorRole(roles: string[]) {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('mgmt')) return 'mgmt';
  if (roles.includes('exec')) return 'exec';
  if (roles.includes('hr')) return 'hr';
  if (roles.includes('user')) return 'user';
  return roles[0] ?? null;
}

function isLockedAfterApproval(status: string) {
  return (
    status === DocStatusValue.approved ||
    status === DocStatusValue.sent ||
    status === DocStatusValue.paid ||
    status === DocStatusValue.acknowledged
  );
}

async function getAnnotationLimits() {
  const current = await prisma.annotationSetting.findUnique({
    where: { id: ANNOTATION_SETTING_ID },
    select: {
      maxExternalUrlCount: true,
      maxExternalUrlLength: true,
      maxExternalUrlTotalLength: true,
      maxNotesLength: true,
    },
  });
  return current ?? DEFAULT_LIMITS;
}

function normalizeExternalUrls(
  value: unknown,
  limits: AnnotationLimits,
): string[] {
  if (value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error('INVALID_EXTERNAL_URLS');
  }
  const urls = value.map((item) => normalizeString(item));
  if (urls.some((url) => url === '')) {
    throw new Error('INVALID_EXTERNAL_URL');
  }
  if (urls.length > limits.maxExternalUrlCount) {
    throw new Error('TOO_MANY_EXTERNAL_URLS');
  }
  let total = 0;
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    if (url.length > limits.maxExternalUrlLength) {
      throw new Error('EXTERNAL_URL_TOO_LONG');
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('INVALID_EXTERNAL_URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('INVALID_EXTERNAL_URL');
    }
    if (seen.has(url)) continue;
    seen.add(url);
    normalized.push(url);
    total += url.length;
  }
  if (total > limits.maxExternalUrlTotalLength) {
    throw new Error('EXTERNAL_URL_TOTAL_TOO_LONG');
  }
  return normalized;
}

function normalizeInternalRefs(value: unknown): InternalRef[] {
  if (value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error('INVALID_INTERNAL_REFS');
  }
  const refs: InternalRef[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('INVALID_INTERNAL_REF');
    }
    const kind = normalizeString((entry as any).kind) as InternalRefKind;
    const id = normalizeString((entry as any).id);
    const labelRaw = (entry as any).label;
    const label =
      typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw.trim() : '';
    if (!kind || !ALLOWED_INTERNAL_REF_KINDS.has(kind)) {
      throw new Error('INVALID_INTERNAL_REF_KIND');
    }
    if (!id) {
      throw new Error('INVALID_INTERNAL_REF_ID');
    }
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(label ? { kind, id, label } : { kind, id });
  }
  return refs;
}

function normalizeNotes(
  value: unknown,
  limits: AnnotationLimits,
): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error('INVALID_NOTES');
  }
  const notes = value;
  if (notes.length > limits.maxNotesLength) {
    throw new Error('NOTES_TOO_LONG');
  }
  return notes;
}

async function resolveAnnotationTarget(kind: AnnotationTargetKind, id: string) {
  if (kind === 'estimate') {
    const found = await prisma.estimate.findUnique({
      where: { id },
      select: { id: true, projectId: true, status: true, deletedAt: true },
    });
    if (!found || found.deletedAt) return null;
    return {
      targetTable: 'estimates',
      projectId: found.projectId,
      status: found.status,
    };
  }
  if (kind === 'invoice') {
    const found = await prisma.invoice.findUnique({
      where: { id },
      select: { id: true, projectId: true, status: true, deletedAt: true },
    });
    if (!found || found.deletedAt) return null;
    return {
      targetTable: 'invoices',
      projectId: found.projectId,
      status: found.status,
    };
  }
  if (kind === 'expense') {
    const found = await prisma.expense.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        status: true,
        userId: true,
        deletedAt: true,
      },
    });
    if (!found || found.deletedAt) return null;
    return {
      targetTable: 'expenses',
      projectId: found.projectId,
      status: found.status,
      ownerUserId: found.userId,
    };
  }
  if (kind === 'purchase_order') {
    const found = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { id: true, projectId: true, status: true, deletedAt: true },
    });
    if (!found || found.deletedAt) return null;
    return {
      targetTable: 'purchase_orders',
      projectId: found.projectId,
      status: found.status,
    };
  }
  if (kind === 'vendor_quote') {
    const found = await prisma.vendorQuote.findUnique({
      where: { id },
      select: { id: true, projectId: true, status: true, deletedAt: true },
    });
    if (!found || found.deletedAt) return null;
    return {
      targetTable: 'vendor_quotes',
      projectId: found.projectId,
      status: found.status,
    };
  }
  if (kind === 'vendor_invoice') {
    const found = await prisma.vendorInvoice.findUnique({
      where: { id },
      select: { id: true, projectId: true, status: true, deletedAt: true },
    });
    if (!found || found.deletedAt) return null;
    return {
      targetTable: 'vendor_invoices',
      projectId: found.projectId,
      status: found.status,
    };
  }
  if (kind === 'project') {
    const found = await prisma.project.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!found || found.deletedAt) return null;
    return { targetTable: 'projects', projectId: found.id, status: null };
  }
  if (kind === 'customer') {
    const found = await prisma.customer.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) return null;
    return { targetTable: 'customers', projectId: null, status: null };
  }
  if (kind === 'vendor') {
    const found = await prisma.vendor.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) return null;
    return { targetTable: 'vendors', projectId: null, status: null };
  }
  return null;
}

function normalizeJsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function registerAnnotationRoutes(app: FastifyInstance) {
  const allowedRoles = ['admin', 'mgmt', 'user'];

  app.get(
    '/annotations/:kind/:id',
    { preHandler: requireRole(allowedRoles) },
    async (req, reply) => {
      const { userId, roles, projectIds = [] } = requireUserContext(req);
      if (!userId) return reply.code(401).send({ error: 'unauthorized' });

      const { kind: rawKind, id: rawId } = req.params as {
        kind: string;
        id: string;
      };
      const kind = normalizeString(rawKind) as AnnotationTargetKind;
      const id = normalizeString(rawId);
      if (!kind || !id) {
        return reply.status(400).send({ error: 'invalid_params' });
      }

      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      if (!isPrivileged && ADMIN_ONLY_TARGETS.has(kind)) {
        return reply.status(403).send({ error: 'forbidden' });
      }

      const target = await resolveAnnotationTarget(kind, id);
      if (!target) {
        return reply.status(404).send({ error: 'not_found' });
      }
      if (!isPrivileged) {
        if (target.projectId && !projectIds.includes(target.projectId)) {
          return reply.status(403).send({ error: 'forbidden_project' });
        }
        if (
          kind === 'expense' &&
          target.ownerUserId &&
          target.ownerUserId !== userId
        ) {
          return reply.status(403).send({ error: 'forbidden' });
        }
      }

      const current = await prisma.annotation.findUnique({
        where: { targetKind_targetId: { targetKind: kind, targetId: id } },
      });

      return {
        targetKind: kind,
        targetId: id,
        notes: current?.notes ?? null,
        externalUrls: normalizeJsonArray<string>(current?.externalUrls),
        internalRefs: normalizeJsonArray<InternalRef>(current?.internalRefs),
        updatedAt: current?.updatedAt ?? null,
        updatedBy: current?.updatedBy ?? null,
      };
    },
  );

  app.get(
    '/annotations/:kind/:id/history',
    { preHandler: requireRole(allowedRoles) },
    async (req, reply) => {
      const { userId, roles, projectIds = [] } = requireUserContext(req);
      if (!userId) return reply.code(401).send({ error: 'unauthorized' });

      const { kind: rawKind, id: rawId } = req.params as {
        kind: string;
        id: string;
      };
      const kind = normalizeString(rawKind) as AnnotationTargetKind;
      const id = normalizeString(rawId);
      if (!kind || !id) {
        return reply.status(400).send({ error: 'invalid_params' });
      }

      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      if (!isPrivileged && ADMIN_ONLY_TARGETS.has(kind)) {
        return reply.status(403).send({ error: 'forbidden' });
      }

      const target = await resolveAnnotationTarget(kind, id);
      if (!target) {
        return reply.status(404).send({ error: 'not_found' });
      }
      if (!isPrivileged) {
        if (target.projectId && !projectIds.includes(target.projectId)) {
          return reply.status(403).send({ error: 'forbidden_project' });
        }
        if (
          kind === 'expense' &&
          target.ownerUserId &&
          target.ownerUserId !== userId
        ) {
          return reply.status(403).send({ error: 'forbidden' });
        }
      }

      const limit = normalizeHistoryLimit((req.query as any)?.limit);
      const logs = await prisma.annotationLog.findMany({
        where: { targetKind: kind, targetId: id },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return {
        items: logs.map((log) => ({
          id: log.id,
          createdAt: log.createdAt,
          createdBy: log.createdBy ?? null,
          actorRole: log.actorRole ?? null,
          reasonCode: log.reasonCode ?? null,
          reasonText: log.reasonText ?? null,
          notes: log.notes ?? null,
          externalUrls: normalizeJsonArray<string>(log.externalUrls),
          internalRefs: normalizeJsonArray<InternalRef>(log.internalRefs),
        })),
      };
    },
  );

  app.patch(
    '/annotations/:kind/:id',
    { preHandler: requireRole(allowedRoles), schema: annotationPatchSchema },
    async (req, reply) => {
      const { userId, roles, projectIds = [] } = requireUserContext(req);
      if (!userId) return reply.code(401).send({ error: 'unauthorized' });

      const { kind: rawKind, id: rawId } = req.params as {
        kind: string;
        id: string;
      };
      const kind = normalizeString(rawKind) as AnnotationTargetKind;
      const id = normalizeString(rawId);
      if (!kind || !id) {
        return reply.status(400).send({ error: 'invalid_params' });
      }

      const isPrivileged = roles.includes('admin') || roles.includes('mgmt');
      if (!isPrivileged && ADMIN_ONLY_TARGETS.has(kind)) {
        return reply.status(403).send({ error: 'forbidden' });
      }

      const target = await resolveAnnotationTarget(kind, id);
      if (!target) {
        return reply.status(404).send({ error: 'not_found' });
      }
      if (!isPrivileged) {
        if (target.projectId && !projectIds.includes(target.projectId)) {
          return reply.status(403).send({ error: 'forbidden_project' });
        }
        if (
          kind === 'expense' &&
          target.ownerUserId &&
          target.ownerUserId !== userId
        ) {
          return reply.status(403).send({ error: 'forbidden' });
        }
        if (target.status && isLockedAfterApproval(target.status)) {
          return reply.status(403).send({ error: 'forbidden_locked' });
        }
      }

      const limits = await getAnnotationLimits();
      const body = (req.body || {}) as {
        notes?: string | null;
        externalUrls?: unknown;
        internalRefs?: unknown;
        reasonText?: string;
      };

      const current = await prisma.annotation.findUnique({
        where: { targetKind_targetId: { targetKind: kind, targetId: id } },
      });

      let reasonCode: string | null = null;
      const rawReasonText = normalizeString(body.reasonText);
      const requiresAdminOverride = Boolean(
        target.status && isLockedAfterApproval(target.status),
      );
      if (isPrivileged && requiresAdminOverride) {
        if (!rawReasonText) {
          return reply.status(400).send({ error: 'reason_required' });
        }
        reasonCode = 'admin_override';
      }

      let nextNotes: string | null | undefined;
      if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
        try {
          nextNotes = normalizeNotes(body.notes, limits);
        } catch (err) {
          return reply
            .status(400)
            .send({ error: String((err as Error).message) });
        }
      }

      let nextExternalUrls: string[] | undefined;
      if (Object.prototype.hasOwnProperty.call(body, 'externalUrls')) {
        try {
          nextExternalUrls = normalizeExternalUrls(body.externalUrls, limits);
        } catch (err) {
          return reply
            .status(400)
            .send({ error: String((err as Error).message) });
        }
      }

      let nextInternalRefs: InternalRef[] | undefined;
      if (Object.prototype.hasOwnProperty.call(body, 'internalRefs')) {
        try {
          nextInternalRefs = normalizeInternalRefs(body.internalRefs);
        } catch (err) {
          return reply
            .status(400)
            .send({ error: String((err as Error).message) });
        }
      }

      const mergedNotes =
        nextNotes !== undefined ? nextNotes : (current?.notes ?? null);
      const mergedExternalUrls =
        nextExternalUrls !== undefined
          ? nextExternalUrls
          : normalizeJsonArray<string>(current?.externalUrls);
      const mergedInternalRefs =
        nextInternalRefs !== undefined
          ? nextInternalRefs
          : normalizeJsonArray<InternalRef>(current?.internalRefs);

      if (mergedNotes !== null && mergedNotes.length > limits.maxNotesLength) {
        return reply.status(400).send({ error: 'NOTES_TOO_LONG' });
      }

      const actorRole = resolveActorRole(roles);

      const updated = await prisma.annotation.upsert({
        where: { targetKind_targetId: { targetKind: kind, targetId: id } },
        create: {
          targetKind: kind,
          targetId: id,
          notes: mergedNotes,
          externalUrls: mergedExternalUrls as unknown as Prisma.InputJsonValue,
          internalRefs: mergedInternalRefs as unknown as Prisma.InputJsonValue,
          createdBy: userId,
          updatedBy: userId,
        },
        update: {
          notes: mergedNotes,
          externalUrls: mergedExternalUrls as unknown as Prisma.InputJsonValue,
          internalRefs: mergedInternalRefs as unknown as Prisma.InputJsonValue,
          updatedBy: userId,
        },
      });

      await prisma.annotationLog.create({
        data: {
          targetKind: kind,
          targetId: id,
          notes: mergedNotes,
          externalUrls: mergedExternalUrls as unknown as Prisma.InputJsonValue,
          internalRefs: mergedInternalRefs as unknown as Prisma.InputJsonValue,
          reasonCode: reasonCode ?? null,
          reasonText: rawReasonText || null,
          actorRole,
          createdBy: userId,
        },
      });

      const beforeNotesLen = (current?.notes ?? '').length;
      const afterNotesLen = (mergedNotes ?? '').length;
      const beforeUrls = normalizeJsonArray<string>(current?.externalUrls);
      const afterUrls = mergedExternalUrls;
      const beforeRefs = normalizeJsonArray<InternalRef>(current?.internalRefs);
      const afterRefs = mergedInternalRefs;

      await logAudit({
        action: 'annotations_updated',
        targetTable: target.targetTable,
        targetId: id,
        reasonCode: reasonCode ?? undefined,
        reasonText: rawReasonText || undefined,
        metadata: {
          targetKind: kind,
          notesLength: { before: beforeNotesLen, after: afterNotesLen },
          externalUrlCount: {
            before: beforeUrls.length,
            after: afterUrls.length,
          },
          internalRefCount: {
            before: beforeRefs.length,
            after: afterRefs.length,
          },
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return {
        targetKind: kind,
        targetId: id,
        notes: updated.notes ?? null,
        externalUrls: normalizeJsonArray<string>(updated.externalUrls),
        internalRefs: normalizeJsonArray<InternalRef>(updated.internalRefs),
        updatedAt: updated.updatedAt,
        updatedBy: updated.updatedBy ?? null,
      };
    },
  );
}
