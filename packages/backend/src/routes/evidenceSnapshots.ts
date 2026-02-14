import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { requireRole } from '../services/rbac.js';
import { createEvidenceSnapshotForApproval } from '../services/evidenceSnapshot.js';
import {
  evidenceSnapshotCreateSchema,
  evidenceSnapshotHistoryQuerySchema,
} from './validators.js';

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLimit(value: unknown) {
  if (value === undefined || value === null) return 50;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
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

      const result = await createEvidenceSnapshotForApproval(prisma, {
        approvalInstanceId: approval.id,
        targetTable: approval.targetTable,
        targetId: approval.targetId,
        capturedBy: actorUserId,
        forceRegenerate,
      });
      if (result.unsupportedTarget) {
        return reply.status(400).send({
          error: {
            code: 'UNSUPPORTED_TARGET',
            message: `targetTable is not supported: ${approval.targetTable}`,
          },
        });
      }
      if (!result.created) {
        return {
          created: false,
          snapshot: result.snapshot,
        };
      }
      const created = result.snapshot;

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
