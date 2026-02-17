import React from 'react';
import { FormWizard } from '../../ui';

type AlertSettingsWizardProps = Pick<
  React.ComponentProps<typeof FormWizard>,
  | 'steps'
  | 'value'
  | 'onValueChange'
  | 'canSubmit'
  | 'isDirty'
  | 'autosave'
  | 'labels'
  | 'onSubmit'
  | 'onCancel'
>;

export type AlertSettingsCardItem = {
  id: string;
  type: string;
  threshold: number;
  period: string;
  scopeProjectId?: string | null;
  recipients?: {
    emails?: string[];
    roles?: string[];
    users?: string[];
    slackWebhooks?: string[];
    webhooks?: string[];
  } | null;
  channels?: string[] | null;
  remindAfterHours?: number | null;
  remindMaxCount?: number | null;
  isEnabled?: boolean | null;
};

type AlertSettingsCardProps = {
  wizard: AlertSettingsWizardProps;
  onReload: () => void;
  items: AlertSettingsCardItem[];
  onToggle: (id: string, enabled?: boolean | null) => void;
  onEdit: (item: AlertSettingsCardItem) => void;
};

export const AlertSettingsCard = ({
  wizard,
  onReload,
  items,
  onToggle,
  onEdit,
}: AlertSettingsCardProps) => (
  <div className="card" style={{ padding: 12 }}>
    <strong>アラート設定（簡易モック）</strong>
    <div style={{ marginTop: 8 }}>
      <FormWizard {...wizard} protectUnsavedChanges />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="button secondary" onClick={onReload}>
          再読込
        </button>
      </div>
    </div>
    <div className="list" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
      {items.length === 0 && <div className="card">設定なし</div>}
      {items.map((item) => (
        <div key={item.id} className="card" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>{item.type}</strong> / {item.period} / threshold{' '}
              {item.threshold}
            </div>
            <span className="badge">
              {item.isEnabled ? 'enabled' : 'disabled'}
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
            channels: {(item.channels || []).join(', ') || '-'} / emails:{' '}
            {(item.recipients?.emails || []).join(', ') || '-'}
          </div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
            remindAfterHours: {item.remindAfterHours ?? '-'} / maxCount:{' '}
            {item.remindMaxCount ?? '-'}
          </div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
            Slack: {(item.recipients?.slackWebhooks || []).join(', ') || '-'} /
            Webhook: {(item.recipients?.webhooks || []).join(', ') || '-'}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="button secondary"
              onClick={() => onToggle(item.id, item.isEnabled)}
            >
              {(item.isEnabled ?? true) ? '無効化' : '有効化'}
            </button>
            <button className="button secondary" onClick={() => onEdit(item)}>
              編集
            </button>
          </div>
        </div>
      ))}
    </div>
  </div>
);
