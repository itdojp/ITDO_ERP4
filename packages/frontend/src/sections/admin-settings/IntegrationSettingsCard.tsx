import React from 'react';

export type IntegrationFormState = {
  type: string;
  name: string;
  provider: string;
  status: string;
  schedule: string;
  configJson: string;
};

export type IntegrationSettingsCardItem = {
  id: string;
  type: string;
  name?: string | null;
  provider?: string | null;
  status?: string | null;
  schedule?: string | null;
  config?: Record<string, unknown> | null;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
};

export type IntegrationRunItem = {
  id: string;
  settingId: string;
  status?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  message?: string | null;
  retryCount?: number | null;
  nextRetryAt?: string | null;
};

type IntegrationSettingsCardProps = {
  integrationForm: IntegrationFormState;
  setIntegrationForm: React.Dispatch<
    React.SetStateAction<IntegrationFormState>
  >;
  integrationTypes: string[];
  integrationStatuses: string[];
  editingIntegrationId: string | null;
  onSubmit: () => void;
  onReset: () => void;
  onReload: () => void;
  onShowRuns: (settingId?: string) => void;
  integrationRunFilterId: string;
  setIntegrationRunFilterId: React.Dispatch<React.SetStateAction<string>>;
  items: IntegrationSettingsCardItem[];
  onEdit: (item: IntegrationSettingsCardItem) => void;
  onRun: (id: string) => void;
  runs: IntegrationRunItem[];
  formatDateTime: (value?: string | null) => string;
};

export const IntegrationSettingsCard = ({
  integrationForm,
  setIntegrationForm,
  integrationTypes,
  integrationStatuses,
  editingIntegrationId,
  onSubmit,
  onReset,
  onReload,
  onShowRuns,
  integrationRunFilterId,
  setIntegrationRunFilterId,
  items,
  onEdit,
  onRun,
  runs,
  formatDateTime,
}: IntegrationSettingsCardProps) => (
  <div className="card" style={{ padding: 12 }}>
    <strong>外部連携設定（HR/CRM）</strong>
    <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
      <label>
        種別
        <select
          value={integrationForm.type}
          onChange={(e) =>
            setIntegrationForm({
              ...integrationForm,
              type: e.target.value,
            })
          }
        >
          {integrationTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label>
        名称
        <input
          type="text"
          value={integrationForm.name}
          onChange={(e) =>
            setIntegrationForm({
              ...integrationForm,
              name: e.target.value,
            })
          }
          placeholder="例: HRIS接続"
        />
      </label>
      <label>
        プロバイダ
        <input
          type="text"
          value={integrationForm.provider}
          onChange={(e) =>
            setIntegrationForm({
              ...integrationForm,
              provider: e.target.value,
            })
          }
          placeholder="例: azure_ad"
        />
      </label>
      <label>
        ステータス
        <select
          value={integrationForm.status}
          onChange={(e) =>
            setIntegrationForm({
              ...integrationForm,
              status: e.target.value,
            })
          }
        >
          {integrationStatuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <label>
        スケジュール
        <input
          type="text"
          value={integrationForm.schedule}
          onChange={(e) =>
            setIntegrationForm({
              ...integrationForm,
              schedule: e.target.value,
            })
          }
          placeholder="例: 0 3 * * *"
        />
      </label>
    </div>
    <div className="row" style={{ marginTop: 8 }}>
      <label style={{ flex: 1, minWidth: 240 }}>
        config (JSON)
        <textarea
          value={integrationForm.configJson}
          onChange={(e) =>
            setIntegrationForm({
              ...integrationForm,
              configJson: e.target.value,
            })
          }
          rows={3}
          style={{ width: '100%' }}
          placeholder='{"tenant":"example","clientId":"..."}'
        />
      </label>
    </div>
    <div className="row" style={{ marginTop: 8 }}>
      <button className="button" onClick={onSubmit}>
        {editingIntegrationId ? '更新' : '作成'}
      </button>
      <button className="button secondary" onClick={onReset}>
        {editingIntegrationId ? 'キャンセル' : 'クリア'}
      </button>
      <button className="button secondary" onClick={onReload}>
        再読込
      </button>
      <button
        className="button secondary"
        onClick={() => onShowRuns(integrationRunFilterId.trim() || undefined)}
      >
        履歴表示
      </button>
    </div>
    <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
      <label>
        履歴フィルタ
        <select
          value={integrationRunFilterId}
          onChange={(e) => setIntegrationRunFilterId(e.target.value)}
        >
          <option value="">すべて</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.type}
              {item.name ? ` / ${item.name}` : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
    <div className="list" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
      {items.length === 0 && <div className="card">設定なし</div>}
      {items.map((item) => (
        <div key={item.id} className="card" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>{item.type}</strong>
              {item.name ? ` / ${item.name}` : ''}
            </div>
            <span className="badge">{item.status || 'active'}</span>
          </div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
            provider: {item.provider || '-'} / schedule: {item.schedule || '-'}
          </div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
            lastRun: {formatDateTime(item.lastRunAt)} / status:{' '}
            {item.lastRunStatus || '-'}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="button secondary" onClick={() => onEdit(item)}>
              編集
            </button>
            <button
              className="button secondary"
              onClick={() => onRun(item.id)}
              disabled={item.status === 'disabled'}
            >
              実行
            </button>
          </div>
        </div>
      ))}
    </div>
    <div className="list" style={{ display: 'grid', gap: 8, marginTop: 12 }}>
      {runs.length === 0 && <div className="card">連携履歴なし</div>}
      {runs.map((run) => (
        <div key={run.id} className="card" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>{run.status || '-'}</strong> / retry:{' '}
              {run.retryCount ?? 0}
            </div>
            <span className="badge">{formatDateTime(run.startedAt)}</span>
          </div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
            finished: {formatDateTime(run.finishedAt)} / nextRetry:{' '}
            {formatDateTime(run.nextRetryAt)}
          </div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
            message: {run.message || '-'}
          </div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
            setting: {run.settingId}
          </div>
        </div>
      ))}
    </div>
  </div>
);
