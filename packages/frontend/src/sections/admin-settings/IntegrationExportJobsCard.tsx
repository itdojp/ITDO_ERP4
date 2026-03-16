import React from 'react';

export type IntegrationExportJobKind =
  | 'hr_leave_export_attendance'
  | 'hr_leave_export_payroll'
  | 'hr_employee_master_export'
  | 'accounting_ics_export';

export type IntegrationExportJobStatus = 'running' | 'success' | 'failed';

export type IntegrationExportJobItem = {
  kind: IntegrationExportJobKind;
  id: string;
  idempotencyKey: string;
  reexportOfId?: string | null;
  status?: IntegrationExportJobStatus | null;
  exportedCount?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  message?: string | null;
  scope?: {
    target?: string | null;
    updatedSince?: string | null;
    periodKey?: string | null;
  } | null;
};

type IntegrationExportJobsCardProps = {
  kindFilter: string;
  setKindFilter: React.Dispatch<React.SetStateAction<string>>;
  statusFilter: string;
  setStatusFilter: React.Dispatch<React.SetStateAction<string>>;
  limit: number;
  setLimit: React.Dispatch<React.SetStateAction<number>>;
  offset: number;
  setOffset: React.Dispatch<React.SetStateAction<number>>;
  items: IntegrationExportJobItem[];
  loading: boolean;
  redispatchingId: string | null;
  onLoad: () => void;
  onRedispatch: (item: IntegrationExportJobItem) => void;
  formatDateTime: (value?: string | null) => string;
};

const kindOptions: Array<{ value: string; label: string }> = [
  { value: '', label: 'すべて' },
  { value: 'hr_leave_export_attendance', label: '休暇CSV（勤怠）' },
  { value: 'hr_leave_export_payroll', label: '休暇CSV（給与）' },
  { value: 'hr_employee_master_export', label: '社員マスタCSV' },
  { value: 'accounting_ics_export', label: 'ICS仕訳CSV' },
];

const statusOptions: Array<{ value: string; label: string }> = [
  { value: '', label: 'すべて' },
  { value: 'running', label: 'running' },
  { value: 'success', label: 'success' },
  { value: 'failed', label: 'failed' },
];

function formatKindLabel(kind: IntegrationExportJobKind) {
  return kindOptions.find((option) => option.value === kind)?.label ?? kind;
}

function formatScope(scope?: IntegrationExportJobItem['scope']) {
  if (!scope) return '-';
  if (scope.periodKey) return `periodKey=${scope.periodKey}`;
  const parts = [];
  if (scope.target) parts.push(`target=${scope.target}`);
  if (scope.updatedSince) parts.push(`updatedSince=${scope.updatedSince}`);
  return parts.length ? parts.join(' / ') : '-';
}

function normalizePositiveInteger(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeNonNegativeInteger(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export const IntegrationExportJobsCard = ({
  kindFilter,
  setKindFilter,
  statusFilter,
  setStatusFilter,
  limit,
  setLimit,
  offset,
  setOffset,
  items,
  loading,
  redispatchingId,
  onLoad,
  onRedispatch,
  formatDateTime,
}: IntegrationExportJobsCardProps) => (
  <div
    className="card"
    style={{ padding: 12 }}
    data-testid="integration-export-jobs-card"
  >
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <strong>連携ジョブ一覧</strong>
      <span className="badge">{loading ? 'loading' : 'ready'}</span>
    </div>
    <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
      <label>
        種別
        <select
          aria-label="連携ジョブ種別"
          value={kindFilter}
          onChange={(event) => setKindFilter(event.target.value)}
          data-testid="integration-export-jobs-kind"
        >
          {kindOptions.map((option) => (
            <option key={option.value || 'all'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        ステータス
        <select
          aria-label="連携ジョブステータス"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          data-testid="integration-export-jobs-status"
        >
          {statusOptions.map((option) => (
            <option key={option.value || 'all'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        limit
        <input
          aria-label="連携ジョブlimit"
          type="number"
          min={1}
          max={100}
          value={limit}
          onChange={(event) =>
            setLimit(normalizePositiveInteger(event.target.value, 20))
          }
          data-testid="integration-export-jobs-limit"
        />
      </label>
      <label>
        offset
        <input
          aria-label="連携ジョブoffset"
          type="number"
          min={0}
          value={offset}
          onChange={(event) =>
            setOffset(normalizeNonNegativeInteger(event.target.value, 0))
          }
          data-testid="integration-export-jobs-offset"
        />
      </label>
      <button
        className="button secondary"
        type="button"
        onClick={onLoad}
        disabled={loading}
        data-testid="integration-export-jobs-load"
      >
        連携ジョブ取得
      </button>
    </div>
    <div className="list" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
      {items.length === 0 && (
        <div className="card" style={{ padding: 12 }}>
          ジョブなし
        </div>
      )}
      {items.map((item) => {
        const redispatchable = item.status === 'success';
        return (
          <div
            key={`${item.kind}:${item.id}`}
            className="card"
            style={{ padding: 12 }}
            data-testid={`integration-export-job-${item.id}`}
          >
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{formatKindLabel(item.kind)}</strong>
              </div>
              <span className="badge">{item.status || '-'}</span>
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
              id: {item.id}
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
              scope: {formatScope(item.scope)}
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
              idempotencyKey: {item.idempotencyKey}
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
              reexportOfId: {item.reexportOfId || '-'}
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
              exportedCount: {item.exportedCount ?? '-'} / startedAt:{' '}
              {formatDateTime(item.startedAt)} / finishedAt:{' '}
              {formatDateTime(item.finishedAt)}
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
              message: {item.message || '-'}
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <button
                className="button secondary"
                type="button"
                onClick={() => onRedispatch(item)}
                disabled={!redispatchable || redispatchingId === item.id}
                data-testid={`integration-export-job-redispatch-${item.id}`}
              >
                {redispatchingId === item.id ? '再出力中...' : '再出力'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);
