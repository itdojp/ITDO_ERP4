import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type AlertSetting = {
  id: string;
  type: string;
  threshold: number;
  period: string;
  scopeProjectId?: string | null;
  recipients?: { emails?: string[]; roles?: string[]; users?: string[] } | null;
  channels?: string[] | null;
  isEnabled?: boolean | null;
};

type ApprovalRule = {
  id: string;
  flowType: string;
  conditions?: Record<string, unknown> | null;
  steps?: Array<Record<string, unknown>> | null;
};

const alertTypes = ['budget_overrun', 'overtime', 'approval_delay', 'delivery_due'];
const alertChannels = ['email', 'dashboard', 'slack', 'webhook'];
const flowTypes = ['estimate', 'invoice', 'expense', 'leave', 'time', 'purchase_order', 'vendor_invoice', 'vendor_quote'];

function parseCsv(input: string): string[] {
  return input.split(',').map((v) => v.trim()).filter(Boolean);
}

export const AdminSettings: React.FC = () => {
  const [alertItems, setAlertItems] = useState<AlertSetting[]>([]);
  const [ruleItems, setRuleItems] = useState<ApprovalRule[]>([]);
  const [message, setMessage] = useState('');
  const [alertForm, setAlertForm] = useState({
    type: 'budget_overrun',
    threshold: '10',
    period: 'month',
    scopeProjectId: '',
    emails: 'alert@example.com',
    roles: 'mgmt',
    users: '',
    channels: new Set<string>(['email', 'dashboard']),
  });
  const [ruleForm, setRuleForm] = useState({
    flowType: 'invoice',
    conditionsJson: '{"amountMin": 0}',
    stepsJson: '[{"approverGroupId":"mgmt","stepOrder":1}]',
  });

  const channels = useMemo(() => Array.from(alertForm.channels), [alertForm.channels]);

  const loadAlertSettings = async () => {
    try {
      const res = await api<{ items: AlertSetting[] }>('/alert-settings');
      setAlertItems(res.items || []);
    } catch (err) {
      setAlertItems([]);
    }
  };

  const loadApprovalRules = async () => {
    try {
      const res = await api<{ items: ApprovalRule[] }>('/approval-rules');
      setRuleItems(res.items || []);
    } catch (err) {
      setRuleItems([]);
    }
  };

  useEffect(() => {
    loadAlertSettings();
    loadApprovalRules();
  }, []);

  const toggleChannel = (ch: string) => {
    const next = new Set(alertForm.channels);
    if (next.has(ch)) {
      next.delete(ch);
    } else {
      next.add(ch);
    }
    setAlertForm({ ...alertForm, channels: next });
  };

  const createAlertSetting = async () => {
    if (!channels.length) {
      setMessage('通知チャネルを選択してください');
      return;
    }
    const payload = {
      type: alertForm.type,
      threshold: Number(alertForm.threshold),
      period: alertForm.period,
      scopeProjectId: alertForm.scopeProjectId || undefined,
      recipients: {
        emails: parseCsv(alertForm.emails),
        roles: parseCsv(alertForm.roles),
        users: parseCsv(alertForm.users),
      },
      channels,
      isEnabled: true,
    };
    try {
      await api('/alert-settings', { method: 'POST', body: JSON.stringify(payload) });
      setMessage('アラート設定を作成しました');
      await loadAlertSettings();
    } catch (err) {
      setMessage('作成に失敗しました');
    }
  };

  const toggleAlert = async (id: string, enabled: boolean | null | undefined) => {
    try {
      await api(`/alert-settings/${id}/${enabled ? 'disable' : 'enable'}`, { method: 'POST' });
      await loadAlertSettings();
    } catch (err) {
      setMessage('状態変更に失敗しました');
    }
  };

  const parseJson = (label: string, raw: string) => {
    if (!raw.trim()) return undefined;
    try {
      return JSON.parse(raw);
    } catch (err) {
      setMessage(`${label} のJSONが不正です`);
      return null;
    }
  };

  const createApprovalRule = async () => {
    const conditions = parseJson('conditions', ruleForm.conditionsJson);
    if (conditions === null) return;
    const steps = parseJson('steps', ruleForm.stepsJson);
    if (!Array.isArray(steps)) {
      setMessage('steps は配列で入力してください');
      return;
    }
    if (!steps.length) {
      setMessage('steps は1件以上必要です');
      return;
    }
    const payload = {
      flowType: ruleForm.flowType,
      conditions: conditions || undefined,
      steps,
    };
    try {
      await api('/approval-rules', { method: 'POST', body: JSON.stringify(payload) });
      setMessage('承認ルールを作成しました');
      await loadApprovalRules();
    } catch (err) {
      setMessage('作成に失敗しました');
    }
  };

  return (
    <div>
      <h2>Settings</h2>
      {message && <p>{message}</p>}
      <div className="list" style={{ display: 'grid', gap: 12 }}>
        <div className="card" style={{ padding: 12 }}>
          <strong>アラート設定（簡易モック）</strong>
          <div className="row" style={{ marginTop: 8 }}>
            <label>
              種別
              <select value={alertForm.type} onChange={(e) => setAlertForm({ ...alertForm, type: e.target.value })}>
                {alertTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>
            <label>
              閾値
              <input
                type="number"
                value={alertForm.threshold}
                onChange={(e) => setAlertForm({ ...alertForm, threshold: e.target.value })}
              />
            </label>
            <label>
              期間
              <input
                type="text"
                value={alertForm.period}
                onChange={(e) => setAlertForm({ ...alertForm, period: e.target.value })}
                placeholder="day/week/month"
              />
            </label>
            <label>
              projectId(任意)
              <input
                type="text"
                value={alertForm.scopeProjectId}
                onChange={(e) => setAlertForm({ ...alertForm, scopeProjectId: e.target.value })}
                placeholder="projectId"
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label>
              emails
              <input
                type="text"
                value={alertForm.emails}
                onChange={(e) => setAlertForm({ ...alertForm, emails: e.target.value })}
                placeholder="a@ex.com,b@ex.com"
              />
            </label>
            <label>
              roles
              <input
                type="text"
                value={alertForm.roles}
                onChange={(e) => setAlertForm({ ...alertForm, roles: e.target.value })}
                placeholder="mgmt,exec"
              />
            </label>
            <label>
              users
              <input
                type="text"
                value={alertForm.users}
                onChange={(e) => setAlertForm({ ...alertForm, users: e.target.value })}
                placeholder="userId1,userId2"
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {alertChannels.map((ch) => (
              <label key={ch} className="badge" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={alertForm.channels.has(ch)}
                  onChange={() => toggleChannel(ch)}
                  style={{ marginRight: 6 }}
                />
                {ch}
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="button" onClick={createAlertSetting}>作成</button>
            <button className="button secondary" onClick={loadAlertSettings}>再読込</button>
          </div>
          <div className="list" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {alertItems.length === 0 && <div className="card">設定なし</div>}
            {alertItems.map((item) => (
              <div key={item.id} className="card" style={{ padding: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <strong>{item.type}</strong> / {item.period} / threshold {item.threshold}
                  </div>
                  <span className="badge">{item.isEnabled ? 'enabled' : 'disabled'}</span>
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                  channels: {(item.channels || []).join(', ') || '-'} / emails: {(item.recipients?.emails || []).join(', ') || '-'}
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="button secondary" onClick={() => toggleAlert(item.id, item.isEnabled)}>
                    {item.isEnabled ? '無効化' : '有効化'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <strong>承認ルール（簡易モック）</strong>
          <div className="row" style={{ marginTop: 8 }}>
            <label>
              flowType
              <select value={ruleForm.flowType} onChange={(e) => setRuleForm({ ...ruleForm, flowType: e.target.value })}>
                {flowTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <label style={{ flex: 1, minWidth: 240 }}>
              conditions (JSON)
              <textarea
                value={ruleForm.conditionsJson}
                onChange={(e) => setRuleForm({ ...ruleForm, conditionsJson: e.target.value })}
                rows={3}
                style={{ width: '100%' }}
              />
            </label>
            <label style={{ flex: 1, minWidth: 240 }}>
              steps (JSON)
              <textarea
                value={ruleForm.stepsJson}
                onChange={(e) => setRuleForm({ ...ruleForm, stepsJson: e.target.value })}
                rows={3}
                style={{ width: '100%' }}
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="button" onClick={createApprovalRule}>作成</button>
            <button className="button secondary" onClick={loadApprovalRules}>再読込</button>
          </div>
          <div className="list" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {ruleItems.length === 0 && <div className="card">ルールなし</div>}
            {ruleItems.map((rule) => (
              <div key={rule.id} className="card" style={{ padding: 12 }}>
                <div>
                  <strong>{rule.flowType}</strong>
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                  conditions: {rule.conditions ? JSON.stringify(rule.conditions) : '-'}
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                  steps: {rule.steps ? JSON.stringify(rule.steps) : '-'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
