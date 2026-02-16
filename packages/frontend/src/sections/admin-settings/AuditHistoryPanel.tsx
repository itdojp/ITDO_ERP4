import React from 'react';
import { AuditTimeline, DiffViewer } from '../../ui';
import type { AuditEvent } from '../../ui';

export type AuditHistoryLog = {
  id: string;
  action: string;
  userId?: string | null;
  actorRole?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};

type AuditHistoryPanelProps = {
  logs: AuditHistoryLog[];
  selectedLogId?: string;
  onSelectLog: (logId: string) => void;
};

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatJson(value: unknown): string {
  if (value === undefined) return '-';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function resolveAuditEventTone(action: string): AuditEvent['tone'] {
  const normalized = action.toLowerCase();
  if (
    normalized.includes('error') ||
    normalized.includes('reject') ||
    normalized.includes('fail')
  ) {
    return 'error';
  }
  if (
    normalized.includes('delete') ||
    normalized.includes('disable') ||
    normalized.includes('cancel')
  ) {
    return 'warning';
  }
  if (
    normalized.includes('create') ||
    normalized.includes('enable') ||
    normalized.includes('approve')
  ) {
    return 'success';
  }
  if (normalized.includes('update') || normalized.includes('edit')) {
    return 'info';
  }
  return 'default';
}

function parseAuditMetadata(metadata?: Record<string, unknown> | null): {
  raw: Record<string, unknown>;
  before: unknown;
  after: unknown;
  patch: unknown;
  hasBeforeAfter: boolean;
  hasPatch: boolean;
} {
  const raw =
    metadata && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>)
      : {};
  const before = raw.before;
  const after = raw.after;
  const patch = raw.patch;
  return {
    raw,
    before,
    after,
    patch,
    hasBeforeAfter: before !== undefined || after !== undefined,
    hasPatch: patch !== undefined,
  };
}

function toAuditEvent(log: AuditHistoryLog): AuditEvent {
  const reason =
    log.reasonCode || log.reasonText
      ? `reason: ${log.reasonCode || '-'} / ${log.reasonText || '-'}`
      : undefined;
  return {
    id: log.id,
    time: formatDateTime(log.createdAt),
    actor: `${log.actorRole || '-'} / ${log.userId || '-'}`,
    action: log.action,
    target: '-',
    summary: reason,
    tone: resolveAuditEventTone(log.action),
  };
}

export const AuditHistoryPanel: React.FC<AuditHistoryPanelProps> = ({
  logs,
  selectedLogId,
  onSelectLog,
}) => {
  if (logs.length === 0) {
    return null;
  }
  const events = logs.map(toAuditEvent);
  const selectedLog = logs.find((log) => log.id === selectedLogId) || logs[0];
  const selectedMeta = parseAuditMetadata(selectedLog.metadata);

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <AuditTimeline
        events={events}
        selectedEventId={selectedLog.id}
        onSelectEvent={(event) => onSelectLog(event.id)}
      />
      <div className="card" style={{ padding: 10 }}>
        <div style={{ fontSize: 12, color: '#475569' }}>
          {formatDateTime(selectedLog.createdAt)} / {selectedLog.action} /{' '}
          {selectedLog.actorRole || '-'} / {selectedLog.userId || '-'}
        </div>
        {(selectedLog.reasonText || selectedLog.reasonCode) && (
          <div style={{ color: '#475569', marginTop: 6, fontSize: 12 }}>
            reason: {selectedLog.reasonCode || '-'} /{' '}
            {selectedLog.reasonText || '-'}
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          {selectedMeta.hasBeforeAfter ? (
            <DiffViewer
              before={selectedMeta.before}
              after={selectedMeta.after}
              format="json"
            />
          ) : (
            <pre
              style={{
                margin: 0,
                padding: 10,
                whiteSpace: 'pre-wrap',
                borderRadius: 6,
                background: '#0f172a',
                color: '#e2e8f0',
                fontSize: 12,
              }}
            >
              {formatJson(selectedMeta.raw)}
            </pre>
          )}
        </div>
        {selectedMeta.hasPatch && (
          <details style={{ marginTop: 8 }}>
            <summary
              style={{ cursor: 'pointer', fontSize: 12, color: '#475569' }}
            >
              patch
            </summary>
            <pre
              style={{
                margin: '6px 0 0',
                padding: 10,
                whiteSpace: 'pre-wrap',
                borderRadius: 6,
                background: '#0f172a',
                color: '#e2e8f0',
                fontSize: 12,
              }}
            >
              {formatJson(selectedMeta.patch)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
};
