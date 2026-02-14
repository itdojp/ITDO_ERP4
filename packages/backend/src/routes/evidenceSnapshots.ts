import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/db.js';
import { auditContextFromRequest, logAudit } from '../services/audit.js';
import { requireRole } from '../services/rbac.js';
import {
  buildEvidencePackJsonExport,
  maskEvidencePackJsonExport,
  renderEvidencePackPdf,
} from '../services/evidencePackExport.js';
import { archiveEvidencePack } from '../services/evidencePackArchive.js';
import { createEvidenceSnapshotForApproval } from '../services/evidenceSnapshot.js';
import {
  evidencePackArchiveBodySchema,
  evidencePackExportQuerySchema,
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

function sanitizeAttachmentFilename(value: string) {
  return value.replace(/["\\\r\n]/g, '_');
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

async function findEvidenceSnapshotForPack(
  approvalInstanceId: string,
  version?: number,
) {
  if (version) {
    return prisma.evidenceSnapshot.findUnique({
      where: {
        approvalInstanceId_version: {
          approvalInstanceId,
          version,
        },
      },
    });
  }
  return prisma.evidenceSnapshot.findFirst({
    where: { approvalInstanceId },
    orderBy: { version: 'desc' },
  });
}

function resolveAuditErrorCode(error: unknown) {
  if (!(error instanceof Error)) return 'UNKNOWN_ERROR';
  if (error.message === 'PDF_EXPORT_FAILED') return 'PDF_EXPORT_FAILED';
  if (error.message.startsWith('evidence_archive_')) {
    return error.message.toUpperCase();
  }
  return 'EVIDENCE_ARCHIVE_FAILED';
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

  app.post(
    '/approval-instances/:id/evidence-pack/archive',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: evidencePackArchiveBodySchema,
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        format?: 'json' | 'pdf';
        version?: number;
        mask?: number;
      };

      const approval = await prisma.approvalInstance.findUnique({
        where: { id },
        select: {
          id: true,
          flowType: true,
          targetTable: true,
          targetId: true,
          status: true,
          currentStep: true,
          projectId: true,
          createdAt: true,
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

      const snapshot = await findEvidenceSnapshotForPack(
        approval.id,
        body.version,
      );
      if (!snapshot) {
        return reply.status(404).send({
          error: {
            code: 'SNAPSHOT_NOT_FOUND',
            message: 'Evidence snapshot not found',
          },
        });
      }

      const format = body.format ?? 'json';
      const shouldMask = body.mask === undefined ? true : body.mask === 1;
      const rawExported = buildEvidencePackJsonExport({
        exportedAt: new Date(),
        exportedBy: req.user?.userId ?? null,
        approval,
        snapshot,
      });
      const exported = shouldMask
        ? maskEvidencePackJsonExport(rawExported)
        : rawExported;

      let content: Buffer;
      let contentType: string;
      try {
        if (format === 'pdf') {
          content = await renderEvidencePackPdf(exported);
          contentType = 'application/pdf';
        } else {
          content = Buffer.from(
            `${JSON.stringify(exported, null, 2)}\n`,
            'utf8',
          );
          contentType = 'application/json; charset=utf-8';
        }
      } catch {
        await logAudit({
          action: 'evidence_pack_archived',
          targetTable: 'approval_instances',
          targetId: approval.id,
          metadata: {
            approvalInstanceId: approval.id,
            snapshotId: snapshot.id,
            snapshotVersion: snapshot.version,
            format,
            digest: exported.integrity.digest,
            mask: shouldMask,
            success: false,
            errorCode: 'PDF_EXPORT_FAILED',
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req),
        });
        return reply.status(500).send({
          error: {
            code: 'PDF_EXPORT_FAILED',
            message: 'Failed to render evidence pack PDF',
          },
        });
      }

      try {
        const archived = await archiveEvidencePack({
          approvalInstanceId: approval.id,
          snapshotId: snapshot.id,
          snapshotVersion: snapshot.version,
          format,
          mask: shouldMask,
          digest: exported.integrity.digest,
          exportedAt: new Date(exported.payload.exportedAt),
          archivedBy: req.user?.userId ?? null,
          content,
          contentType,
        });
        await logAudit({
          action: 'evidence_pack_archived',
          targetTable: 'approval_instances',
          targetId: approval.id,
          metadata: {
            approvalInstanceId: approval.id,
            snapshotId: snapshot.id,
            snapshotVersion: snapshot.version,
            format,
            digest: exported.integrity.digest,
            mask: shouldMask,
            provider: archived.provider,
            objectKey: archived.objectKey,
            metadataKey: archived.metadataKey,
            archiveUri: archived.archiveUri,
            sizeBytes: archived.sizeBytes,
            contentSha256: archived.checksumSha256,
            success: true,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req),
        });
        return {
          archived: true,
          archive: {
            ...archived,
            digest: exported.integrity.digest,
            format,
            mask: shouldMask,
          },
        };
      } catch (error) {
        const errorCode = resolveAuditErrorCode(error);
        await logAudit({
          action: 'evidence_pack_archived',
          targetTable: 'approval_instances',
          targetId: approval.id,
          metadata: {
            approvalInstanceId: approval.id,
            snapshotId: snapshot.id,
            snapshotVersion: snapshot.version,
            format,
            digest: exported.integrity.digest,
            mask: shouldMask,
            success: false,
            errorCode,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req),
        });
        return reply.status(500).send({
          error: {
            code: 'EVIDENCE_ARCHIVE_FAILED',
            message: 'Failed to archive evidence pack',
          },
        });
      }
    },
  );

  app.get(
    '/approval-instances/:id/evidence-pack/export',
    {
      preHandler: requireRole(['admin', 'mgmt', 'exec', 'user']),
      schema: evidencePackExportQuerySchema,
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const query = req.query as {
        format?: 'json' | 'pdf';
        version?: number;
        mask?: number;
      };
      const approval = await prisma.approvalInstance.findUnique({
        where: { id },
        select: {
          id: true,
          flowType: true,
          targetTable: true,
          targetId: true,
          status: true,
          currentStep: true,
          projectId: true,
          createdAt: true,
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

      const snapshot = await findEvidenceSnapshotForPack(
        approval.id,
        query.version,
      );
      if (!snapshot) {
        return reply.status(404).send({
          error: {
            code: 'SNAPSHOT_NOT_FOUND',
            message: 'Evidence snapshot not found',
          },
        });
      }

      const format = query.format ?? 'json';
      const rawExported = buildEvidencePackJsonExport({
        exportedAt: new Date(),
        exportedBy: req.user?.userId ?? null,
        approval,
        snapshot,
      });
      const shouldMask = query.mask === undefined ? true : query.mask === 1;
      const exported = shouldMask
        ? maskEvidencePackJsonExport(rawExported)
        : rawExported;
      const filenameBase = sanitizeAttachmentFilename(
        `evidence-pack-${approval.id}-v${snapshot.version}`,
      );
      if (format === 'pdf') {
        let buffer: Buffer;
        try {
          buffer = await renderEvidencePackPdf(exported);
        } catch {
          await logAudit({
            action: 'evidence_pack_exported',
            targetTable: 'approval_instances',
            targetId: approval.id,
            metadata: {
              approvalInstanceId: approval.id,
              snapshotId: snapshot.id,
              snapshotVersion: snapshot.version,
              format,
              digest: exported.integrity.digest,
              mask: shouldMask,
              success: false,
              errorCode: 'PDF_EXPORT_FAILED',
            } as Prisma.InputJsonValue,
            ...auditContextFromRequest(req),
          });
          return reply.status(500).send({
            error: {
              code: 'PDF_EXPORT_FAILED',
              message: 'Failed to render evidence pack PDF',
            },
          });
        }
        await logAudit({
          action: 'evidence_pack_exported',
          targetTable: 'approval_instances',
          targetId: approval.id,
          metadata: {
            approvalInstanceId: approval.id,
            snapshotId: snapshot.id,
            snapshotVersion: snapshot.version,
            format,
            digest: exported.integrity.digest,
            mask: shouldMask,
            success: true,
          } as Prisma.InputJsonValue,
          ...auditContextFromRequest(req),
        });
        reply.header(
          'Content-Disposition',
          `attachment; filename="${filenameBase}.pdf"`,
        );
        reply.type('application/pdf');
        return reply.send(buffer);
      }

      await logAudit({
        action: 'evidence_pack_exported',
        targetTable: 'approval_instances',
        targetId: approval.id,
        metadata: {
          approvalInstanceId: approval.id,
          snapshotId: snapshot.id,
          snapshotVersion: snapshot.version,
          format,
          digest: exported.integrity.digest,
          mask: shouldMask,
          success: true,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      reply.header(
        'Content-Disposition',
        `attachment; filename="${filenameBase}.json"`,
      );
      return exported;
    },
  );
}
