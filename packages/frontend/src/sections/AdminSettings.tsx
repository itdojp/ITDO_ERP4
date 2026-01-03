import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type AlertSetting = {
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
  isEnabled?: boolean | null;
};

type ApprovalRule = {
  id: string;
  flowType: string;
  conditions?: Record<string, unknown> | null;
  steps?: Array<Record<string, unknown>> | null;
};

type PdfTemplate = {
  id: string;
  name: string;
  kind: string;
  version: string;
  description?: string | null;
  isDefault?: boolean | null;
};

type TemplateSetting = {
  id: string;
  kind: string;
  templateId: string;
  numberRule: string;
  layoutConfig?: Record<string, unknown> | null;
  logoUrl?: string | null;
  signatureText?: string | null;
  isDefault?: boolean | null;
};

const alertTypes = [
  'budget_overrun',
  'overtime',
  'approval_delay',
  'approval_escalation',
  'delivery_due',
];
const alertChannels = ['email', 'dashboard', 'slack', 'webhook'];
const flowTypes = [
  'estimate',
  'invoice',
  'expense',
  'leave',
  'time',
  'purchase_order',
  'vendor_invoice',
  'vendor_quote',
];
const templateKinds = ['estimate', 'invoice', 'purchase_order'];

function parseCsv(input: string): string[] {
  return input
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const createDefaultAlertForm = () => ({
  type: 'budget_overrun',
  threshold: '10',
  period: 'month',
  scopeProjectId: '',
  remindAfterHours: '',
  emails: 'alert@example.com',
  roles: 'mgmt',
  users: '',
  slackWebhooks: '',
  webhooks: '',
  channels: new Set<string>(['email', 'dashboard']),
});

const createDefaultRuleForm = () => ({
  flowType: 'invoice',
  conditionsJson: '{"amountMin": 0}',
  stepsJson: '[{"approverGroupId":"mgmt","stepOrder":1}]',
});

export const AdminSettings: React.FC = () => {
  const [alertItems, setAlertItems] = useState<AlertSetting[]>([]);
  const [ruleItems, setRuleItems] = useState<ApprovalRule[]>([]);
  const [templateItems, setTemplateItems] = useState<TemplateSetting[]>([]);
  const [pdfTemplates, setPdfTemplates] = useState<PdfTemplate[]>([]);
  const [message, setMessage] = useState('');
  const [alertForm, setAlertForm] = useState(createDefaultAlertForm);
  const [ruleForm, setRuleForm] = useState(createDefaultRuleForm);
  const [templateForm, setTemplateForm] = useState({
    kind: 'invoice',
    templateId: '',
    numberRule: 'PYYYY-MM-NNNN',
    layoutConfigJson: '',
    logoUrl: '',
    signatureText: '',
    isDefault: true,
  });
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(
    null,
  );
  const [editingAlertId, setEditingAlertId] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  const channels = useMemo(
    () => Array.from(alertForm.channels),
    [alertForm.channels],
  );
  const templatesForKind = useMemo(
    () =>
      pdfTemplates.filter((template) => template.kind === templateForm.kind),
    [pdfTemplates, templateForm.kind],
  );
  const templateNameMap = useMemo(
    () => new Map(pdfTemplates.map((template) => [template.id, template.name])),
    [pdfTemplates],
  );
  const logError = (label: string, err: unknown) => {
    console.error(`[AdminSettings] ${label}`, err);
  };

  const loadAlertSettings = async () => {
    try {
      const res = await api<{ items: AlertSetting[] }>('/alert-settings');
      setAlertItems(res.items || []);
    } catch (err) {
      logError('loadAlertSettings failed', err);
      setAlertItems([]);
    }
  };

  const loadApprovalRules = async () => {
    try {
      const res = await api<{ items: ApprovalRule[] }>('/approval-rules');
      setRuleItems(res.items || []);
    } catch (err) {
      logError('loadApprovalRules failed', err);
      setRuleItems([]);
    }
  };

  const loadTemplateSettings = async () => {
    try {
      const res = await api<{ items: TemplateSetting[] }>('/template-settings');
      setTemplateItems(res.items || []);
    } catch (err) {
      logError('loadTemplateSettings failed', err);
      setTemplateItems([]);
    }
  };

  const loadPdfTemplates = async () => {
    try {
      const res = await api<{ items: PdfTemplate[] }>('/pdf-templates');
      setPdfTemplates(res.items || []);
    } catch (err) {
      logError('loadPdfTemplates failed', err);
      setPdfTemplates([]);
    }
  };

  useEffect(() => {
    loadAlertSettings();
    loadApprovalRules();
    loadTemplateSettings();
    loadPdfTemplates();
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (templatesForKind.length === 0) return;
    setTemplateForm((prev) => {
      if (editingTemplateId != null) {
        return prev;
      }
      if (
        prev.templateId &&
        templatesForKind.some((t) => t.id === prev.templateId)
      ) {
        return prev;
      }
      return { ...prev, templateId: templatesForKind[0].id };
    });
  }, [templatesForKind, editingTemplateId]);

  const toggleChannel = (ch: string) => {
    const next = new Set(alertForm.channels);
    if (next.has(ch)) {
      next.delete(ch);
    } else {
      next.add(ch);
    }
    setAlertForm({ ...alertForm, channels: next });
  };

  const toggleAlert = async (
    id: string,
    enabled: boolean | null | undefined,
  ) => {
    try {
      await api(`/alert-settings/${id}/${enabled ? 'disable' : 'enable'}`, {
        method: 'POST',
      });
      await loadAlertSettings();
    } catch (err) {
      logError('toggleAlert failed', err);
      setMessage('状態変更に失敗しました');
    }
  };

  const parseJson = (label: string, raw: string) => {
    if (!raw.trim()) return undefined;
    try {
      return JSON.parse(raw);
    } catch (err) {
      logError(`parseJson ${label} failed`, err);
      setMessage(`${label} のJSONが不正です`);
      return null;
    }
  };

  const resetAlertForm = () => {
    setAlertForm(createDefaultAlertForm());
    setEditingAlertId(null);
  };

  const resetRuleForm = () => {
    setRuleForm(createDefaultRuleForm());
    setEditingRuleId(null);
  };

  const resetTemplateForm = () => {
    setTemplateForm({
      kind: 'invoice',
      templateId: '',
      numberRule: 'PYYYY-MM-NNNN',
      layoutConfigJson: '',
      logoUrl: '',
      signatureText: '',
      isDefault: true,
    });
    setEditingTemplateId(null);
  };

  const submitTemplateSetting = async () => {
    if (!templatesForKind.length) {
      setMessage('テンプレートを先に登録してください');
      return;
    }
    if (!templateForm.numberRule.trim()) {
      setMessage('番号ルールを入力してください');
      return;
    }
    if (!templateForm.templateId.trim()) {
      setMessage('テンプレートを選択してください');
      return;
    }
    if (
      !templatesForKind.some(
        (template) => template.id === templateForm.templateId,
      )
    ) {
      setMessage('テンプレートが存在しません');
      return;
    }
    const layoutConfig = parseJson(
      'layoutConfig',
      templateForm.layoutConfigJson,
    );
    if (layoutConfig === null) return;
    const payload = {
      kind: templateForm.kind,
      templateId: templateForm.templateId,
      numberRule: templateForm.numberRule.trim(),
      layoutConfig: layoutConfig || undefined,
      logoUrl: templateForm.logoUrl.trim() || undefined,
      signatureText: templateForm.signatureText.trim() || undefined,
      isDefault: templateForm.isDefault,
    };
    try {
      if (editingTemplateId) {
        await api(`/template-settings/${editingTemplateId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setMessage('テンプレ設定を更新しました');
      } else {
        await api('/template-settings', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage('テンプレ設定を作成しました');
      }
      await loadTemplateSettings();
      resetTemplateForm();
    } catch (err) {
      logError('submitTemplateSetting failed', err);
      setMessage('テンプレ設定の保存に失敗しました');
    }
  };

  const startEditTemplate = (item: TemplateSetting) => {
    setEditingTemplateId(item.id);
    setTemplateForm({
      kind: item.kind,
      templateId: item.templateId,
      numberRule: item.numberRule,
      layoutConfigJson: item.layoutConfig
        ? JSON.stringify(item.layoutConfig, null, 2)
        : '',
      logoUrl: item.logoUrl || '',
      signatureText: item.signatureText || '',
      isDefault: Boolean(item.isDefault),
    });
  };

  const setTemplateDefault = async (id: string) => {
    try {
      await api(`/template-settings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDefault: true }),
      });
      await loadTemplateSettings();
      setMessage('デフォルトテンプレートを更新しました');
    } catch (err) {
      logError('setTemplateDefault failed', err);
      setMessage('デフォルト設定に失敗しました');
    }
  };

  const startEditAlert = (item: AlertSetting) => {
    setEditingAlertId(item.id);
    setAlertForm({
      type: item.type,
      threshold: String(item.threshold ?? ''),
      period: item.period || '',
      scopeProjectId: item.scopeProjectId || '',
      remindAfterHours:
        item.remindAfterHours != null ? String(item.remindAfterHours) : '',
      emails: (item.recipients?.emails || []).join(','),
      roles: (item.recipients?.roles || []).join(','),
      users: (item.recipients?.users || []).join(','),
      slackWebhooks: (item.recipients?.slackWebhooks || []).join(','),
      webhooks: (item.recipients?.webhooks || []).join(','),
      channels: new Set(
        item.channels && item.channels.length > 0
          ? item.channels
          : ['email', 'dashboard'],
      ),
    });
  };

  const submitAlertSetting = async () => {
    if (!channels.length) {
      setMessage('通知チャネルを選択してください');
      return;
    }
    const remindAfterRaw = alertForm.remindAfterHours.trim();
    const remindAfter =
      remindAfterRaw.length > 0 ? Number(remindAfterRaw) : undefined;
    const slackWebhooks = parseCsv(alertForm.slackWebhooks);
    const webhooks = parseCsv(alertForm.webhooks);
    const invalidUrls = [...slackWebhooks, ...webhooks].filter(
      (url) => !isValidHttpUrl(url),
    );
    if (invalidUrls.length) {
      setMessage('Slack/Webhook のURLが不正です');
      return;
    }
    const payload = {
      type: alertForm.type,
      threshold: Number(alertForm.threshold),
      period: alertForm.period,
      scopeProjectId: alertForm.scopeProjectId || undefined,
      remindAfterHours: Number.isFinite(remindAfter) ? remindAfter : undefined,
      recipients: {
        emails: parseCsv(alertForm.emails),
        roles: parseCsv(alertForm.roles),
        users: parseCsv(alertForm.users),
        slackWebhooks,
        webhooks,
      },
      channels,
    };
    try {
      if (editingAlertId) {
        await api(`/alert-settings/${editingAlertId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setMessage('アラート設定を更新しました');
      } else {
        await api('/alert-settings', {
          method: 'POST',
          body: JSON.stringify({ ...payload, isEnabled: true }),
        });
        setMessage('アラート設定を作成しました');
      }
      await loadAlertSettings();
      resetAlertForm();
    } catch (err) {
      logError('submitAlertSetting failed', err);
      if (editingAlertId) {
        setMessage('更新に失敗しました。新規作成モードに戻しました');
        resetAlertForm();
        return;
      }
      setMessage('保存に失敗しました');
    }
  };

  const startEditRule = (item: ApprovalRule) => {
    setEditingRuleId(item.id);
    setRuleForm({
      flowType: item.flowType,
      conditionsJson: item.conditions
        ? JSON.stringify(item.conditions, null, 2)
        : '',
      stepsJson: item.steps ? JSON.stringify(item.steps, null, 2) : '[]',
    });
  };

  const submitApprovalRule = async () => {
    const conditions = parseJson('conditions', ruleForm.conditionsJson);
    if (conditions === null) return;
    const steps = parseJson('steps', ruleForm.stepsJson);
    if (steps === null) return;
    if (steps === undefined) {
      setMessage('steps を入力してください');
      return;
    }
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
      if (editingRuleId) {
        await api(`/approval-rules/${editingRuleId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setMessage('承認ルールを更新しました');
      } else {
        await api('/approval-rules', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage('承認ルールを作成しました');
      }
      await loadApprovalRules();
      resetRuleForm();
    } catch (err) {
      logError('submitApprovalRule failed', err);
      if (editingRuleId) {
        setMessage('更新に失敗しました。新規作成モードに戻しました');
        resetRuleForm();
        return;
      }
      setMessage('保存に失敗しました');
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
              <select
                value={alertForm.type}
                onChange={(e) =>
                  setAlertForm({ ...alertForm, type: e.target.value })
                }
              >
                {alertTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              閾値
              <input
                type="number"
                value={alertForm.threshold}
                onChange={(e) =>
                  setAlertForm({ ...alertForm, threshold: e.target.value })
                }
              />
            </label>
            <label>
              期間
              <input
                type="text"
                value={alertForm.period}
                onChange={(e) =>
                  setAlertForm({ ...alertForm, period: e.target.value })
                }
                placeholder="day/week/month"
              />
            </label>
            <label>
              projectId(任意)
              <input
                type="text"
                value={alertForm.scopeProjectId}
                onChange={(e) =>
                  setAlertForm({ ...alertForm, scopeProjectId: e.target.value })
                }
                placeholder="projectId"
              />
            </label>
            <label>
              再送間隔(h)
              <input
                type="number"
                value={alertForm.remindAfterHours}
                onChange={(e) =>
                  setAlertForm({
                    ...alertForm,
                    remindAfterHours: e.target.value,
                  })
                }
                placeholder="24"
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label>
              emails
              <input
                type="text"
                value={alertForm.emails}
                onChange={(e) =>
                  setAlertForm({ ...alertForm, emails: e.target.value })
                }
                placeholder="a@ex.com,b@ex.com"
              />
            </label>
            <label>
              roles
              <input
                type="text"
                value={alertForm.roles}
                onChange={(e) =>
                  setAlertForm({ ...alertForm, roles: e.target.value })
                }
                placeholder="mgmt,exec"
              />
            </label>
            <label>
              users
              <input
                type="text"
                value={alertForm.users}
                onChange={(e) =>
                  setAlertForm({ ...alertForm, users: e.target.value })
                }
                placeholder="userId1,userId2"
              />
            </label>
            <label>
              Slack Webhooks
              <input
                type="text"
                value={alertForm.slackWebhooks}
                onChange={(e) =>
                  setAlertForm({ ...alertForm, slackWebhooks: e.target.value })
                }
                placeholder="https://hooks.slack.com/..."
              />
            </label>
            <label>
              Custom Webhooks
              <input
                type="text"
                value={alertForm.webhooks}
                onChange={(e) =>
                  setAlertForm({ ...alertForm, webhooks: e.target.value })
                }
                placeholder="https://example.com/notify"
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
            <button className="button" onClick={submitAlertSetting}>
              {editingAlertId ? '更新' : '作成'}
            </button>
            <button className="button secondary" onClick={resetAlertForm}>
              {editingAlertId ? 'キャンセル' : 'クリア'}
            </button>
            <button className="button secondary" onClick={loadAlertSettings}>
              再読込
            </button>
          </div>
          <div
            className="list"
            style={{ display: 'grid', gap: 8, marginTop: 8 }}
          >
            {alertItems.length === 0 && <div className="card">設定なし</div>}
            {alertItems.map((item) => (
              <div key={item.id} className="card" style={{ padding: 12 }}>
                <div
                  className="row"
                  style={{ justifyContent: 'space-between' }}
                >
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
                  remindAfterHours: {item.remindAfterHours ?? '-'}
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                  Slack:{' '}
                  {(item.recipients?.slackWebhooks || []).join(', ') || '-'} /
                  Webhook: {(item.recipients?.webhooks || []).join(', ') || '-'}
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <button
                    className="button secondary"
                    onClick={() => toggleAlert(item.id, item.isEnabled)}
                  >
                    {item.isEnabled ? '無効化' : '有効化'}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => startEditAlert(item)}
                  >
                    編集
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
              <select
                value={ruleForm.flowType}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, flowType: e.target.value })
                }
              >
                {flowTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <label style={{ flex: 1, minWidth: 240 }}>
              conditions (JSON)
              <textarea
                value={ruleForm.conditionsJson}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, conditionsJson: e.target.value })
                }
                rows={3}
                style={{ width: '100%' }}
              />
            </label>
            <label style={{ flex: 1, minWidth: 240 }}>
              steps (JSON)
              <textarea
                value={ruleForm.stepsJson}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, stepsJson: e.target.value })
                }
                rows={3}
                style={{ width: '100%' }}
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="button" onClick={submitApprovalRule}>
              {editingRuleId ? '更新' : '作成'}
            </button>
            <button className="button secondary" onClick={resetRuleForm}>
              {editingRuleId ? 'キャンセル' : 'クリア'}
            </button>
            <button className="button secondary" onClick={loadApprovalRules}>
              再読込
            </button>
          </div>
          <div
            className="list"
            style={{ display: 'grid', gap: 8, marginTop: 8 }}
          >
            {ruleItems.length === 0 && <div className="card">ルールなし</div>}
            {ruleItems.map((rule) => (
              <div key={rule.id} className="card" style={{ padding: 12 }}>
                <div>
                  <strong>{rule.flowType}</strong>
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                  conditions:{' '}
                  {rule.conditions ? JSON.stringify(rule.conditions) : '-'}
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                  steps: {rule.steps ? JSON.stringify(rule.steps) : '-'}
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <button
                    className="button secondary"
                    onClick={() => startEditRule(rule)}
                  >
                    編集
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <strong>テンプレ設定（見積/請求/発注）</strong>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <label>
              種別
              <select
                value={templateForm.kind}
                onChange={(e) =>
                  setTemplateForm({ ...templateForm, kind: e.target.value })
                }
              >
                {templateKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              テンプレ
              <select
                value={templateForm.templateId}
                onChange={(e) =>
                  setTemplateForm({
                    ...templateForm,
                    templateId: e.target.value,
                  })
                }
              >
                {templatesForKind.length === 0 && (
                  <option value="">テンプレなし</option>
                )}
                {templatesForKind.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              番号ルール
              <input
                type="text"
                value={templateForm.numberRule}
                onChange={(e) =>
                  setTemplateForm({
                    ...templateForm,
                    numberRule: e.target.value,
                  })
                }
                placeholder="PYYYY-MM-NNNN"
              />
            </label>
            <label>
              ロゴURL
              <input
                type="text"
                value={templateForm.logoUrl}
                onChange={(e) =>
                  setTemplateForm({ ...templateForm, logoUrl: e.target.value })
                }
                placeholder="https://..."
              />
            </label>
            <label>
              署名テキスト
              <input
                type="text"
                value={templateForm.signatureText}
                onChange={(e) =>
                  setTemplateForm({
                    ...templateForm,
                    signatureText: e.target.value,
                  })
                }
                placeholder="代表取締役 ..."
              />
            </label>
            <label className="badge" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={templateForm.isDefault}
                onChange={(e) =>
                  setTemplateForm({
                    ...templateForm,
                    isDefault: e.target.checked,
                  })
                }
                style={{ marginRight: 6 }}
              />
              default
            </label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label style={{ flex: 1, minWidth: 240 }}>
              layoutConfig (JSON)
              <textarea
                value={templateForm.layoutConfigJson}
                onChange={(e) =>
                  setTemplateForm({
                    ...templateForm,
                    layoutConfigJson: e.target.value,
                  })
                }
                rows={3}
                style={{ width: '100%' }}
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="button" onClick={submitTemplateSetting}>
              {editingTemplateId ? '更新' : '作成'}
            </button>
            <button className="button secondary" onClick={resetTemplateForm}>
              クリア
            </button>
            <button className="button secondary" onClick={loadTemplateSettings}>
              再読込
            </button>
          </div>
          <div
            className="list"
            style={{ display: 'grid', gap: 8, marginTop: 8 }}
          >
            {templateItems.length === 0 && <div className="card">設定なし</div>}
            {templateItems.map((item) => (
              <div key={item.id} className="card" style={{ padding: 12 }}>
                <div
                  className="row"
                  style={{ justifyContent: 'space-between' }}
                >
                  <div>
                    <strong>{item.kind}</strong> / {item.templateId}
                    {templateNameMap.has(item.templateId) &&
                      ` (${templateNameMap.get(item.templateId)})`}{' '}
                    / {item.numberRule}
                  </div>
                  <span className="badge">
                    {item.isDefault ? 'default' : 'custom'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                  logo: {item.logoUrl || '-'} / signature:{' '}
                  {item.signatureText || '-'}
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <button
                    className="button secondary"
                    onClick={() => startEditTemplate(item)}
                  >
                    編集
                  </button>
                  <button
                    className="button secondary"
                    disabled={item.isDefault}
                    onClick={() => setTemplateDefault(item.id)}
                  >
                    デフォルト化
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
