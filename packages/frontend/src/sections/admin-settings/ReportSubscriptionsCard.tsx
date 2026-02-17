import React from 'react';

export type ReportFormState = {
  name: string;
  reportKey: string;
  format: string;
  schedule: string;
  paramsJson: string;
  recipientsJson: string;
  channels: string;
  isEnabled: boolean;
};

export type ReportSubscriptionsCardItem = {
  id: string;
  name?: string | null;
  reportKey: string;
  format?: string | null;
  schedule?: string | null;
  channels?: string[] | null;
  isEnabled?: boolean | null;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
};

export type ReportDeliveryItem = {
  id: string;
  subscriptionId?: string | null;
  channel?: string | null;
  status?: string | null;
  target?: string | null;
  sentAt?: string | null;
  createdAt?: string | null;
};

type ReportSubscriptionsCardProps = {
  reportForm: ReportFormState;
  setReportForm: React.Dispatch<React.SetStateAction<ReportFormState>>;
  reportFormats: string[];
  reportDryRun: boolean;
  setReportDryRun: React.Dispatch<React.SetStateAction<boolean>>;
  editingReportId: string | null;
  onSubmit: () => void;
  onReset: () => void;
  onReload: () => void;
  onRunAll: () => void;
  onShowDeliveries: (subscriptionId?: string) => void;
  items: ReportSubscriptionsCardItem[];
  onEdit: (item: ReportSubscriptionsCardItem) => void;
  onToggle: (item: ReportSubscriptionsCardItem) => void;
  onRun: (id: string) => void;
  reportDeliveryFilterId: string;
  setReportDeliveryFilterId: React.Dispatch<React.SetStateAction<string>>;
  deliveries: ReportDeliveryItem[];
  formatDateTime: (value?: string | null) => string;
};

export const ReportSubscriptionsCard = ({
  reportForm,
  setReportForm,
  reportFormats,
  reportDryRun,
  setReportDryRun,
  editingReportId,
  onSubmit,
  onReset,
  onReload,
  onRunAll,
  onShowDeliveries,
  items,
  onEdit,
  onToggle,
  onRun,
  reportDeliveryFilterId,
  setReportDeliveryFilterId,
  deliveries,
  formatDateTime,
}: ReportSubscriptionsCardProps) => (
  <div className="card" style={{ padding: 12 }}>
    <strong>レポート購読（配信設定）</strong>
    <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
      <label>
        名称
        <input
          type="text"
          value={reportForm.name}
          onChange={(e) =>
            setReportForm({ ...reportForm, name: e.target.value })
          }
          placeholder="月次工数レポート"
        />
      </label>
      <label>
        reportKey
        <input
          type="text"
          value={reportForm.reportKey}
          onChange={(e) =>
            setReportForm({ ...reportForm, reportKey: e.target.value })
          }
          placeholder="project_hours_monthly"
        />
      </label>
      <label>
        format
        <select
          value={reportForm.format}
          onChange={(e) =>
            setReportForm({ ...reportForm, format: e.target.value })
          }
        >
          {reportFormats.map((format) => (
            <option key={format} value={format}>
              {format}
            </option>
          ))}
        </select>
      </label>
      <label>
        スケジュール
        <input
          type="text"
          value={reportForm.schedule}
          onChange={(e) =>
            setReportForm({ ...reportForm, schedule: e.target.value })
          }
          placeholder="0 8 * * 1"
        />
      </label>
      <label>
        channels (CSV)
        <input
          type="text"
          value={reportForm.channels}
          onChange={(e) =>
            setReportForm({ ...reportForm, channels: e.target.value })
          }
          placeholder="dashboard,email"
        />
      </label>
      <label className="badge" style={{ cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={reportForm.isEnabled}
          onChange={(e) =>
            setReportForm({ ...reportForm, isEnabled: e.target.checked })
          }
          style={{ marginRight: 6 }}
        />
        enabled
      </label>
    </div>
    <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
      <label style={{ flex: 1, minWidth: 240 }}>
        params (JSON)
        <textarea
          value={reportForm.paramsJson}
          onChange={(e) =>
            setReportForm({ ...reportForm, paramsJson: e.target.value })
          }
          rows={3}
          style={{ width: '100%' }}
          placeholder='{"projectId":"...","from":"2025-11-01"}'
        />
      </label>
      <label style={{ flex: 1, minWidth: 240 }}>
        recipients (JSON)
        <textarea
          value={reportForm.recipientsJson}
          onChange={(e) =>
            setReportForm({
              ...reportForm,
              recipientsJson: e.target.value,
            })
          }
          rows={3}
          style={{ width: '100%' }}
          placeholder='{"roles":["mgmt"],"emails":["a@example.com"]}'
        />
      </label>
    </div>
    <div className="row" style={{ marginTop: 8 }}>
      <label className="badge" style={{ cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={reportDryRun}
          onChange={(e) => setReportDryRun(e.target.checked)}
          style={{ marginRight: 6 }}
        />
        dry-run
      </label>
    </div>
    <div className="row" style={{ marginTop: 8 }}>
      <button className="button" onClick={onSubmit}>
        {editingReportId ? '更新' : '作成'}
      </button>
      <button className="button secondary" onClick={onReset}>
        {editingReportId ? 'キャンセル' : 'クリア'}
      </button>
      <button className="button secondary" onClick={onReload}>
        再読込
      </button>
      <button className="button secondary" onClick={onRunAll}>
        一括実行
      </button>
      <button className="button secondary" onClick={() => onShowDeliveries()}>
        配信履歴を表示
      </button>
    </div>
    <div className="list" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
      {items.length === 0 && <div className="card">購読なし</div>}
      {items.map((item) => (
        <div key={item.id} className="card" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>{item.reportKey}</strong>
              {item.name ? ` / ${item.name}` : ''}
            </div>
            <span className="badge">
              {item.isEnabled ? 'enabled' : 'disabled'}
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
            format: {item.format || '-'} / schedule: {item.schedule || '-'} /
            channels: {(item.channels || []).join(', ') || '-'}
          </div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
            lastRun: {formatDateTime(item.lastRunAt)} / status:{' '}
            {item.lastRunStatus || '-'}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="button secondary" onClick={() => onEdit(item)}>
              編集
            </button>
            <button className="button secondary" onClick={() => onToggle(item)}>
              {item.isEnabled ? '無効化' : '有効化'}
            </button>
            <button
              className="button secondary"
              onClick={() => onRun(item.id)}
              disabled={!item.isEnabled}
            >
              実行
            </button>
            <button
              className="button secondary"
              onClick={() => onShowDeliveries(item.id)}
            >
              配信履歴
            </button>
          </div>
        </div>
      ))}
    </div>
    <div className="card" style={{ padding: 12, marginTop: 8 }}>
      <strong>配信履歴</strong>
      <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
        filter: {reportDeliveryFilterId || 'all'}
      </div>
      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <label>
          購読ID
          <input
            type="text"
            value={reportDeliveryFilterId}
            onChange={(e) => setReportDeliveryFilterId(e.target.value)}
            placeholder="subscriptionId"
          />
        </label>
        <button
          className="button secondary"
          onClick={() => onShowDeliveries(reportDeliveryFilterId || undefined)}
        >
          表示
        </button>
      </div>
      <div className="list" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        {deliveries.length === 0 && <div className="card">履歴なし</div>}
        {deliveries.map((delivery) => (
          <div key={delivery.id} className="card" style={{ padding: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{delivery.channel || '-'}</strong> /{' '}
                {delivery.status || '-'}
              </div>
              <span className="badge">
                {formatDateTime(delivery.sentAt || delivery.createdAt)}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
              target: {delivery.target || '-'}
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
              subscription: {delivery.subscriptionId || '-'}
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);
