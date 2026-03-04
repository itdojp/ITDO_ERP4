import { FastifyInstance } from 'fastify';
import { isDeepStrictEqual } from 'node:util';
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
  evidenceSnapshotDiffQuerySchema,
  evidenceSnapshotHistoryQuerySchema,
} from './validators.js';

const apiErrorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: true,
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
    },
  },
} as const;

const evidencePackErrorResponses = {
  200: {
    description: 'Default Response',
  },
  403: apiErrorResponseSchema,
  404: apiErrorResponseSchema,
  500: apiErrorResponseSchema,
} as const;

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
    targetTable?: string | null;
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

  // Fail-safe: time entries are personal data and should not be readable just by project membership.
  const targetTable = normalizeString(approval.targetTable).toLowerCase();
  if (targetTable === 'time_entries' || targetTable === 'time_entry') {
    return false;
  }

  const projectIds = user?.projectIds ?? [];
  if (approval.projectId && projectIds.includes(approval.projectId))
    return true;
  return false;
}

function extractChatMessageIdsFromSnapshotItems(items: unknown): string[] {
  if (!items || typeof items !== 'object' || Array.isArray(items)) return [];
  const refs = (items as Record<string, unknown>).internalRefs;
  if (!Array.isArray(refs)) return [];
  const ids = new Set<string>();
  for (const entry of refs) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const kind = normalizeString(row.kind);
    const id = normalizeString(row.id);
    if (kind !== 'chat_message' || !id) continue;
    ids.add(id);
  }
  return Array.from(ids);
}

function normalizeSha256(value: unknown): {
  sha256: string | null;
  hashRaw?: string | null;
} {
  const raw = normalizeString(value);
  if (!raw) return { sha256: null };
  const hex = raw.toLowerCase();
  if (/^[a-f0-9]{64}$/.test(hex)) return { sha256: hex };
  return { sha256: null, hashRaw: raw };
}

async function buildEvidencePackWorkflowHistory(approvalInstanceId: string) {
  const steps = await prisma.approvalStep.findMany({
    where: { instanceId: approvalInstanceId },
    orderBy: [{ stepOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      stepOrder: true,
      approverGroupId: true,
      approverUserId: true,
      status: true,
      actedBy: true,
      actedAt: true,
      createdAt: true,
    },
  });
  const stepIds = steps.map((step) => step.id);

  const instanceEventActions = [
    'approval_approve',
    'approval_reject',
    'approval_cancel',
    'approval_stage_auto_cancel',
  ];
  const stepEventActions = ['approval_step_approve', 'approval_step_reject'];

  const [instanceEvents, stepEvents] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        targetTable: 'approval_instances',
        targetId: approvalInstanceId,
        action: { in: instanceEventActions },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        action: true,
        createdAt: true,
        targetTable: true,
        targetId: true,
        userId: true,
        actorRole: true,
        actorGroupId: true,
        reasonText: true,
        metadata: true,
      },
    }),
    stepIds.length
      ? prisma.auditLog.findMany({
          where: {
            targetTable: 'approval_steps',
            targetId: { in: stepIds },
            action: { in: stepEventActions },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            action: true,
            createdAt: true,
            targetTable: true,
            targetId: true,
            userId: true,
            actorRole: true,
            actorGroupId: true,
            reasonText: true,
            metadata: true,
          },
        })
      : [],
  ]);

  const events = [...instanceEvents, ...stepEvents].sort((left, right) => {
    const leftTime = left.createdAt.getTime();
    const rightTime = right.createdAt.getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id);
  });

  return {
    steps: steps.map((step) => ({
      id: step.id,
      stepOrder: step.stepOrder,
      approverGroupId: step.approverGroupId ?? null,
      approverUserId: step.approverUserId ?? null,
      status: String(step.status ?? ''),
      actedBy: step.actedBy ?? null,
      actedAt: step.actedAt ? step.actedAt.toISOString() : null,
      createdAt: step.createdAt.toISOString(),
    })),
    events: events.map((event) => ({
      id: event.id,
      action: event.action,
      occurredAt: event.createdAt.toISOString(),
      targetTable: event.targetTable ?? null,
      targetId: event.targetId ?? null,
      userId: event.userId ?? null,
      actorRole: event.actorRole ?? null,
      actorGroupId: event.actorGroupId ?? null,
      reasonText: event.reasonText ?? null,
      metadata: event.metadata ?? null,
    })),
  };
}

async function buildEvidencePackAttachments(
  approval: {
    targetTable: string;
    targetId: string;
  },
  snapshot: { items: unknown },
) {
  const attachments: Array<{
    kind: 'expense_attachment' | 'chat_attachment';
    id: string;
    sourceTable: string;
    sourceId: string;
    filename: string | null;
    contentType: string | null;
    sizeBytes: number | null;
    sha256: string | null;
    hashRaw?: string | null;
  }> = [];

  const targetTable = normalizeString(approval.targetTable).toLowerCase();
  if (targetTable === 'expenses' || targetTable === 'expense') {
    const rows = await prisma.expenseAttachment.findMany({
      where: { expenseId: approval.targetId },
      select: {
        id: true,
        expenseId: true,
        fileName: true,
        contentType: true,
        fileSizeBytes: true,
        fileHash: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const row of rows) {
      const hash = normalizeSha256(row.fileHash);
      attachments.push({
        kind: 'expense_attachment',
        id: row.id,
        sourceTable: 'expenses',
        sourceId: row.expenseId,
        filename: row.fileName ?? null,
        contentType: row.contentType ?? null,
        sizeBytes:
          typeof row.fileSizeBytes === 'number' ? row.fileSizeBytes : null,
        sha256: hash.sha256,
        ...(hash.hashRaw ? { hashRaw: hash.hashRaw } : {}),
      });
    }
  }

  const chatMessageIds = extractChatMessageIdsFromSnapshotItems(snapshot.items);
  if (chatMessageIds.length) {
    const rows = await prisma.chatAttachment.findMany({
      where: { messageId: { in: chatMessageIds }, deletedAt: null },
      select: {
        id: true,
        messageId: true,
        sha256: true,
        sizeBytes: true,
        mimeType: true,
        originalName: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const row of rows) {
      attachments.push({
        kind: 'chat_attachment',
        id: row.id,
        sourceTable: 'chat_messages',
        sourceId: row.messageId,
        filename: row.originalName,
        contentType: row.mimeType ?? null,
        sizeBytes: typeof row.sizeBytes === 'number' ? row.sizeBytes : null,
        sha256: row.sha256 ?? null,
      });
    }
  }

  return attachments;
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

function createEvidenceSnapshotDiff(
  fromItems: unknown,
  toItems: unknown,
): Array<{
  key: string;
  before: unknown;
  after: unknown;
  beforeMissing: boolean;
  afterMissing: boolean;
}> {
  const from =
    fromItems && typeof fromItems === 'object' && !Array.isArray(fromItems)
      ? (fromItems as Record<string, unknown>)
      : {};
  const to =
    toItems && typeof toItems === 'object' && !Array.isArray(toItems)
      ? (toItems as Record<string, unknown>)
      : {};

  const keys = Array.from(new Set([...Object.keys(from), ...Object.keys(to)]));
  keys.sort((left, right) => left.localeCompare(right));

  return keys
    .filter((key) => !isDeepStrictEqual(from[key], to[key]))
    .map((key) => {
      const hasBefore = Object.prototype.hasOwnProperty.call(from, key);
      const hasAfter = Object.prototype.hasOwnProperty.call(to, key);
      return {
        key,
        before: hasBefore ? from[key] : null,
        after: hasAfter ? to[key] : null,
        beforeMissing: !hasBefore,
        afterMissing: !hasAfter,
      };
    });
}

async function resolveEvidenceSnapshotDiffRange(
  approvalInstanceId: string,
  query: { fromVersion?: number; toVersion?: number },
) {
  const fromVersion = query.fromVersion;
  const toVersion = query.toVersion;
  if (fromVersion === undefined && toVersion === undefined) {
    const latestTwo = await prisma.evidenceSnapshot.findMany({
      where: { approvalInstanceId },
      orderBy: { version: 'desc' },
      take: 2,
    });
    if (latestTwo.length < 2) {
      return { errorCode: 'SNAPSHOT_HISTORY_INSUFFICIENT' as const };
    }
    const toSnapshot = latestTwo[0];
    const fromSnapshot = latestTwo[1];
    return { fromSnapshot, toSnapshot };
  }
  if (fromVersion === undefined || toVersion === undefined) {
    return { errorCode: 'SNAPSHOT_VERSION_PAIR_REQUIRED' as const };
  }
  if (fromVersion === toVersion) {
    return { errorCode: 'SNAPSHOT_VERSION_RANGE_INVALID' as const };
  }
  const minVersion = Math.min(fromVersion, toVersion);
  const maxVersion = Math.max(fromVersion, toVersion);
  const [fromSnapshot, toSnapshot] = await Promise.all([
    prisma.evidenceSnapshot.findUnique({
      where: {
        approvalInstanceId_version: {
          approvalInstanceId,
          version: minVersion,
        },
      },
    }),
    prisma.evidenceSnapshot.findUnique({
      where: {
        approvalInstanceId_version: {
          approvalInstanceId,
          version: maxVersion,
        },
      },
    }),
  ]);
  if (!fromSnapshot || !toSnapshot) {
    return { errorCode: 'SNAPSHOT_NOT_FOUND' as const };
  }
  return { fromSnapshot, toSnapshot };
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
          targetTable: true,
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

  app.get(
    '/approval-instances/:id/evidence-snapshot/diff',
    {
      preHandler: requireRole(['admin', 'mgmt', 'exec', 'user']),
      schema: evidenceSnapshotDiffQuerySchema,
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const query = req.query as { fromVersion?: number; toVersion?: number };
      const approval = await prisma.approvalInstance.findUnique({
        where: { id },
        select: {
          id: true,
          targetTable: true,
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

      const resolved = await resolveEvidenceSnapshotDiffRange(approval.id, {
        fromVersion: query.fromVersion,
        toVersion: query.toVersion,
      });
      if (resolved.errorCode === 'SNAPSHOT_HISTORY_INSUFFICIENT') {
        return reply.status(409).send({
          error: {
            code: resolved.errorCode,
            message: 'At least two snapshot versions are required',
          },
        });
      }
      if (resolved.errorCode === 'SNAPSHOT_VERSION_PAIR_REQUIRED') {
        return reply.status(400).send({
          error: {
            code: resolved.errorCode,
            message: 'fromVersion and toVersion must be specified together',
          },
        });
      }
      if (resolved.errorCode === 'SNAPSHOT_VERSION_RANGE_INVALID') {
        return reply.status(400).send({
          error: {
            code: resolved.errorCode,
            message: 'fromVersion and toVersion must be different',
          },
        });
      }
      if (resolved.errorCode === 'SNAPSHOT_NOT_FOUND') {
        return reply.status(404).send({
          error: {
            code: resolved.errorCode,
            message: 'Snapshot version not found',
          },
        });
      }

      const diff = createEvidenceSnapshotDiff(
        resolved.fromSnapshot.items,
        resolved.toSnapshot.items,
      );

      await logAudit({
        action: 'evidence_snapshot_diff_viewed',
        targetTable: 'evidence_snapshots',
        targetId: resolved.toSnapshot.id,
        metadata: {
          approvalInstanceId: approval.id,
          fromVersion: resolved.fromSnapshot.version,
          toVersion: resolved.toSnapshot.version,
          changeCount: diff.length,
        } as Prisma.InputJsonValue,
        ...auditContextFromRequest(req),
      });

      return {
        fromSnapshot: {
          id: resolved.fromSnapshot.id,
          version: resolved.fromSnapshot.version,
          capturedAt: resolved.fromSnapshot.capturedAt,
          sourceAnnotationUpdatedAt:
            resolved.fromSnapshot.sourceAnnotationUpdatedAt,
        },
        toSnapshot: {
          id: resolved.toSnapshot.id,
          version: resolved.toSnapshot.version,
          capturedAt: resolved.toSnapshot.capturedAt,
          sourceAnnotationUpdatedAt:
            resolved.toSnapshot.sourceAnnotationUpdatedAt,
        },
        hasChanges: diff.length > 0,
        changeCount: diff.length,
        changedKeys: diff.map((item) => item.key),
        changes: diff,
      };
    },
  );

  app.post(
    '/approval-instances/:id/evidence-pack/archive',
    {
      preHandler: requireRole(['admin', 'mgmt']),
      schema: {
        ...evidencePackArchiveBodySchema,
        response: evidencePackErrorResponses,
      },
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
      const [workflowHistory, attachments] = await Promise.all([
        buildEvidencePackWorkflowHistory(approval.id),
        buildEvidencePackAttachments(approval, snapshot),
      ]);
      const rawExported = buildEvidencePackJsonExport({
        exportedAt: new Date(),
        exportedBy: req.user?.userId ?? null,
        approval,
        snapshot,
        workflowHistory,
        attachments,
      });
      const exported = shouldMask
        ? maskEvidencePackJsonExport(rawExported)
        : rawExported;

      let content: Buffer;
      let contentType: string;
      if (format === 'pdf') {
        try {
          content = await renderEvidencePackPdf(exported);
          contentType = 'application/pdf';
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
      } else {
        try {
          content = Buffer.from(
            `${JSON.stringify(exported, null, 2)}\n`,
            'utf8',
          );
          contentType = 'application/json; charset=utf-8';
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
              errorCode: 'JSON_EXPORT_FAILED',
            } as Prisma.InputJsonValue,
            ...auditContextFromRequest(req),
          });
          return reply.status(500).send({
            error: {
              code: 'JSON_EXPORT_FAILED',
              message: 'Failed to serialize evidence pack JSON',
            },
          });
        }
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
      schema: {
        ...evidencePackExportQuerySchema,
        response: evidencePackErrorResponses,
      },
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
      const shouldMask = query.mask === undefined ? true : query.mask === 1;
      if (!shouldMask) {
        const roles = req.user?.roles ?? [];
        const allowedUnmasked =
          roles.includes('admin') || roles.includes('mgmt');
        if (!allowedUnmasked) {
          return reply.status(403).send({
            error: {
              code: 'UNMASKED_EXPORT_FORBIDDEN',
              message: 'Unmasked export (mask=0) is restricted to admin/mgmt',
            },
          });
        }
      }
      const [workflowHistory, attachments] = await Promise.all([
        buildEvidencePackWorkflowHistory(approval.id),
        buildEvidencePackAttachments(approval, snapshot),
      ]);
      const rawExported = buildEvidencePackJsonExport({
        exportedAt: new Date(),
        exportedBy: req.user?.userId ?? null,
        approval,
        snapshot,
        workflowHistory,
        attachments,
      });
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
