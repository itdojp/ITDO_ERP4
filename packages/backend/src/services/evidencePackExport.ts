import { createHash } from 'node:crypto';

type ApprovalSummary = {
  id: string;
  flowType: string;
  targetTable: string;
  targetId: string;
  status: string;
  currentStep: number | null;
  projectId: string | null;
  createdAt: string;
  createdBy: string | null;
};

type SnapshotSummary = {
  id: string;
  version: number;
  capturedAt: string;
  capturedBy: string | null;
  sourceAnnotationUpdatedAt: string | null;
  items: unknown;
};

type ExportPayload = {
  schemaVersion: string;
  exportedAt: string;
  exportedBy: string | null;
  approval: ApprovalSummary;
  snapshot: SnapshotSummary;
};

type ExportIntegrity = {
  algorithm: 'sha256';
  digest: string;
  canonicalization: 'json-stable-sort-keys-v1';
};

export type EvidencePackJsonExport = {
  format: 'json';
  payload: ExportPayload;
  integrity: ExportIntegrity;
};

function stableClone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableClone);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, stableClone(v)]));
  }
  return value;
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function buildEvidencePackJsonExport(input: {
  exportedAt: Date;
  exportedBy?: string | null;
  approval: {
    id: string;
    flowType: string;
    targetTable: string;
    targetId: string;
    status: string;
    currentStep: number | null;
    projectId: string | null;
    createdAt: Date;
    createdBy: string | null;
  };
  snapshot: {
    id: string;
    version: number;
    capturedAt: Date;
    capturedBy: string | null;
    sourceAnnotationUpdatedAt: Date | null;
    items: unknown;
  };
}): EvidencePackJsonExport {
  const payload: ExportPayload = {
    schemaVersion: 'evidence-pack/v1',
    exportedAt: input.exportedAt.toISOString(),
    exportedBy: input.exportedBy ?? null,
    approval: {
      id: input.approval.id,
      flowType: input.approval.flowType,
      targetTable: input.approval.targetTable,
      targetId: input.approval.targetId,
      status: input.approval.status,
      currentStep: input.approval.currentStep,
      projectId: input.approval.projectId,
      createdAt: input.approval.createdAt.toISOString(),
      createdBy: input.approval.createdBy,
    },
    snapshot: {
      id: input.snapshot.id,
      version: input.snapshot.version,
      capturedAt: input.snapshot.capturedAt.toISOString(),
      capturedBy: input.snapshot.capturedBy,
      sourceAnnotationUpdatedAt:
        input.snapshot.sourceAnnotationUpdatedAt?.toISOString() ?? null,
      items: input.snapshot.items,
    },
  };

  const canonicalPayload = JSON.stringify(stableClone(payload));
  const integrity: ExportIntegrity = {
    algorithm: 'sha256',
    digest: sha256Hex(canonicalPayload),
    canonicalization: 'json-stable-sort-keys-v1',
  };

  return {
    format: 'json',
    payload,
    integrity,
  };
}
