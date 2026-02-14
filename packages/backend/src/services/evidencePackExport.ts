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
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, stableClone(v)]));
  }
  return value;
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function maskId(value: string) {
  if (!value) return value;
  if (value.length <= 3) return '*'.repeat(value.length);
  const keep = Math.min(4, Math.max(2, Math.ceil(value.length / 3)));
  return `${value.slice(0, keep)}${'*'.repeat(value.length - keep)}`;
}

function maskEmail(value: string) {
  const [local, domain] = value.split('@');
  if (!domain) return value;
  if (!local) return `***@${domain}`;
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  const prefix = local.slice(0, 2);
  const maskedLocal =
    prefix + '*'.repeat(Math.max(local.length - prefix.length, 3));
  return `${maskedLocal}@${domain}`;
}

function maskFreeText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (match) =>
      maskEmail(match),
    )
    .replace(/\b\d{10,13}\b/g, (match) => maskId(match));
}

function maskExternalUrl(value: string) {
  const raw = value.trim();
  if (!raw) return raw;
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}/***`;
  } catch {
    return maskFreeText(raw);
  }
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

export function maskEvidencePackJsonExport(
  source: EvidencePackJsonExport,
): EvidencePackJsonExport {
  const payload = JSON.parse(JSON.stringify(source.payload)) as ExportPayload;
  if (payload.exportedBy) {
    payload.exportedBy = payload.exportedBy.includes('@')
      ? maskEmail(payload.exportedBy)
      : maskId(payload.exportedBy);
  }
  if (payload.approval.createdBy) {
    payload.approval.createdBy = payload.approval.createdBy.includes('@')
      ? maskEmail(payload.approval.createdBy)
      : maskId(payload.approval.createdBy);
  }
  if (payload.snapshot.capturedBy) {
    payload.snapshot.capturedBy = payload.snapshot.capturedBy.includes('@')
      ? maskEmail(payload.snapshot.capturedBy)
      : maskId(payload.snapshot.capturedBy);
  }

  const items = (payload.snapshot.items ?? null) as {
    notes?: unknown;
    externalUrls?: unknown;
    internalRefs?: unknown;
    chatMessages?: unknown;
  } | null;
  if (items && typeof items === 'object') {
    if (typeof items.notes === 'string') {
      items.notes = maskFreeText(items.notes);
    }
    if (Array.isArray(items.externalUrls)) {
      items.externalUrls = items.externalUrls.map((value) =>
        typeof value === 'string' ? maskExternalUrl(value) : value,
      );
    }
    if (Array.isArray(items.internalRefs)) {
      items.internalRefs = items.internalRefs.map((ref) => {
        if (!ref || typeof ref !== 'object') return ref;
        const row = { ...(ref as Record<string, unknown>) };
        if (typeof row.label === 'string') {
          row.label = maskFreeText(row.label);
        }
        return row;
      });
    }
    if (Array.isArray(items.chatMessages)) {
      items.chatMessages = items.chatMessages.map((message) => {
        if (!message || typeof message !== 'object') return message;
        const row = { ...(message as Record<string, unknown>) };
        if (typeof row.userId === 'string') {
          row.userId = row.userId.includes('@')
            ? maskEmail(row.userId)
            : maskId(row.userId);
        }
        if (typeof row.excerpt === 'string') {
          row.excerpt = maskFreeText(row.excerpt);
        }
        return row;
      });
    }
  }

  const canonicalPayload = JSON.stringify(stableClone(payload));
  return {
    format: 'json',
    payload,
    integrity: {
      algorithm: 'sha256',
      digest: sha256Hex(canonicalPayload),
      canonicalization: 'json-stable-sort-keys-v1',
    },
  };
}
