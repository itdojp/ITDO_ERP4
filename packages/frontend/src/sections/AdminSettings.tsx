import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import {
  FormWizard,
  PolicyFormBuilder,
  createLocalStorageDraftAutosaveAdapter,
  useDraftAutosave,
} from '../ui';
import type { PolicyFormSchema, PolicyFormValue } from '../ui';
import { AuditHistoryPanel } from './admin-settings/AuditHistoryPanel';
import { ChatSettingsCard } from './ChatSettingsCard';
import { ChatRoomSettingsCard } from './ChatRoomSettingsCard';
import { GroupManagementCard } from './GroupManagementCard';
import { RateCardSettingsCard } from './RateCardSettingsCard';
import { ScimSettingsCard } from './ScimSettingsCard';
import { WorklogSettingsCard } from './WorklogSettingsCard';

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
  remindMaxCount?: number | null;
  isEnabled?: boolean | null;
};

type ApprovalRule = {
  id: string;
  flowType: string;
  version?: number | null;
  isActive?: boolean | null;
  effectiveFrom?: string | null;
  conditions?: Record<string, unknown> | null;
  steps?: unknown | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type AuditLogItem = {
  id: string;
  action: string;
  userId?: string | null;
  actorRole?: string | null;
  actorGroupId?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
  targetTable?: string | null;
  targetId?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};

type ActionPolicy = {
  id: string;
  flowType: string;
  actionKey: string;
  priority?: number | null;
  isEnabled?: boolean | null;
  subjects?: Record<string, unknown> | null;
  stateConstraints?: Record<string, unknown> | null;
  requireReason?: boolean | null;
  guards?: unknown | null;
};

type ActionPolicyForm = {
  flowType: string;
  actionKey: string;
  priority?: number;
  isEnabled: boolean;
  requireReason: boolean;
  subjectsJson: string;
  stateConstraintsJson: string;
  guardsJson: string;
};

type ChatAckTemplate = {
  id: string;
  flowType: string;
  actionKey: string;
  messageBody: string;
  requiredUserIds?: string[] | null;
  requiredGroupIds?: string[] | null;
  requiredRoles?: string[] | null;
  dueInHours?: number | null;
  remindIntervalHours?: number | null;
  escalationAfterHours?: number | null;
  escalationUserIds?: string[] | null;
  escalationGroupIds?: string[] | null;
  escalationRoles?: string[] | null;
  isEnabled?: boolean | null;
  createdAt?: string | null;
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

type IntegrationSetting = {
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

type IntegrationRun = {
  id: string;
  settingId: string;
  status?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  message?: string | null;
  metrics?: Record<string, unknown> | null;
  retryCount?: number | null;
  nextRetryAt?: string | null;
};

type ReportSubscription = {
  id: string;
  name?: string | null;
  reportKey: string;
  format?: string | null;
  schedule?: string | null;
  params?: Record<string, unknown> | null;
  recipients?: Record<string, unknown> | null;
  channels?: string[] | null;
  isEnabled?: boolean | null;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
};

type ReportDelivery = {
  id: string;
  subscriptionId?: string | null;
  channel?: string | null;
  status?: string | null;
  target?: string | null;
  sentAt?: string | null;
  createdAt?: string | null;
};

const alertTypes = [
  'budget_overrun',
  'overtime',
  'approval_delay',
  'approval_escalation',
  'delivery_due',
  'integration_failure',
  'daily_report_missing',
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
const integrationTypes = ['hr', 'crm'];
const integrationStatuses = ['active', 'disabled'];
const reportFormats = ['csv', 'pdf'];

const actionPolicyFormSchema: PolicyFormSchema = {
  sections: [
    {
      id: 'basic',
      title: '基本設定',
    },
    {
      id: 'constraints',
      title: '適用条件/ガード',
    },
  ],
  fields: [
    {
      name: 'flowType',
      label: 'flowType',
      type: 'select',
      required: true,
      sectionId: 'basic',
      options: flowTypes.map((type) => ({ label: type, value: type })),
    },
    {
      name: 'actionKey',
      label: 'actionKey',
      type: 'text',
      required: true,
      sectionId: 'basic',
      placeholder: 'submit/send/edit/...',
    },
    {
      name: 'priority',
      label: 'priority',
      type: 'number',
      sectionId: 'basic',
      step: 1,
      validator: (fieldValue) => {
        if (
          fieldValue === undefined ||
          fieldValue === null ||
          fieldValue === ''
        ) {
          return undefined;
        }
        if (
          typeof fieldValue !== 'number' ||
          !Number.isFinite(fieldValue) ||
          !Number.isInteger(fieldValue)
        ) {
          return 'priority は整数で入力してください';
        }
        return undefined;
      },
    },
    {
      name: 'isEnabled',
      label: 'isEnabled',
      type: 'checkbox',
      sectionId: 'basic',
    },
    {
      name: 'requireReason',
      label: 'requireReason',
      type: 'checkbox',
      sectionId: 'basic',
    },
    {
      name: 'subjectsJson',
      label: 'subjects (JSON)',
      type: 'textarea',
      sectionId: 'constraints',
      rows: 3,
      columnSpan: 2,
      placeholder:
        '{"roles":["admin","mgmt"],"groupIds":["mgmt"],"userIds":["user@example.com"]}',
    },
    {
      name: 'stateConstraintsJson',
      label: 'stateConstraints (JSON)',
      type: 'textarea',
      sectionId: 'constraints',
      rows: 3,
      columnSpan: 2,
      placeholder: '{"statusIn":["draft"],"statusNotIn":["cancelled"]}',
    },
    {
      name: 'guardsJson',
      label: 'guards (JSON)',
      type: 'textarea',
      sectionId: 'constraints',
      rows: 3,
      columnSpan: 2,
      placeholder:
        '[{"type":"approval_open"},{"type":"project_closed"},{"type":"period_lock"},{"type":"editable_days"},{"type":"chat_ack_completed"}]',
    },
  ],
};

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
    return '-';
  }
}

const createDefaultAlertForm = () => ({
  type: 'budget_overrun',
  threshold: '10',
  period: 'month',
  scopeProjectId: '',
  remindAfterHours: '',
  remindMaxCount: '',
  emails: 'alert@example.com',
  roles: 'mgmt',
  users: '',
  slackWebhooks: '',
  webhooks: '',
  channels: new Set<string>(['email', 'dashboard']),
});

type AlertFormDraftPayload = Omit<
  ReturnType<typeof createDefaultAlertForm>,
  'channels' | 'slackWebhooks' | 'webhooks'
> & {
  channels: string[];
};

const createDefaultRuleForm = () => ({
  flowType: 'invoice',
  version: '1',
  isActive: true,
  effectiveFrom: '',
  conditionsJson: '{"amountMin": 0}',
  stepsJson: '[{"approverGroupId":"mgmt","stepOrder":1}]',
});

const createDefaultActionPolicyForm = (): ActionPolicyForm => ({
  flowType: 'invoice',
  actionKey: 'submit',
  priority: 0,
  isEnabled: true,
  requireReason: false,
  subjectsJson: '',
  stateConstraintsJson: '',
  guardsJson: '',
});

function normalizeActionPolicyForm(value: PolicyFormValue): ActionPolicyForm {
  const priorityRaw = value.priority;
  let priority: number | undefined;
  if (typeof priorityRaw === 'number') {
    priority = Number.isFinite(priorityRaw) ? priorityRaw : undefined;
  } else if (typeof priorityRaw === 'string' && priorityRaw.trim().length > 0) {
    const parsed = Number(priorityRaw);
    priority = Number.isFinite(parsed) ? parsed : undefined;
  }
  return {
    flowType: typeof value.flowType === 'string' ? value.flowType : 'invoice',
    actionKey: typeof value.actionKey === 'string' ? value.actionKey : '',
    priority,
    isEnabled: value.isEnabled !== false,
    requireReason: value.requireReason === true,
    subjectsJson:
      typeof value.subjectsJson === 'string' ? value.subjectsJson : '',
    stateConstraintsJson:
      typeof value.stateConstraintsJson === 'string'
        ? value.stateConstraintsJson
        : '',
    guardsJson: typeof value.guardsJson === 'string' ? value.guardsJson : '',
  };
}

const createDefaultChatAckTemplateForm = () => ({
  flowType: 'invoice',
  actionKey: 'approve',
  messageBody: '',
  requiredUserIdsJson: '[]',
  requiredGroupIdsJson: '[]',
  requiredRolesJson: '[]',
  dueInHours: '',
  remindIntervalHours: '',
  escalationAfterHours: '',
  escalationUserIdsJson: '[]',
  escalationGroupIdsJson: '[]',
  escalationRolesJson: '[]',
  isEnabled: true,
});

const createDefaultIntegrationForm = () => ({
  type: 'crm',
  name: '',
  provider: '',
  status: 'active',
  schedule: '',
  configJson: '',
});

const createDefaultReportForm = () => ({
  name: '',
  reportKey: '',
  format: 'csv',
  schedule: '',
  paramsJson: '',
  recipientsJson: '',
  channels: 'dashboard',
  isEnabled: true,
});

export const AdminSettings: React.FC = () => {
  const [alertItems, setAlertItems] = useState<AlertSetting[]>([]);
  const [ruleItems, setRuleItems] = useState<ApprovalRule[]>([]);
  const [actionPolicyItems, setActionPolicyItems] = useState<ActionPolicy[]>(
    [],
  );
  const [chatAckTemplateItems, setChatAckTemplateItems] = useState<
    ChatAckTemplate[]
  >([]);
  const [templateItems, setTemplateItems] = useState<TemplateSetting[]>([]);
  const [pdfTemplates, setPdfTemplates] = useState<PdfTemplate[]>([]);
  const [integrationItems, setIntegrationItems] = useState<
    IntegrationSetting[]
  >([]);
  const [integrationRuns, setIntegrationRuns] = useState<IntegrationRun[]>([]);
  const [integrationRunFilterId, setIntegrationRunFilterId] =
    useState<string>('');
  const [reportItems, setReportItems] = useState<ReportSubscription[]>([]);
  const [reportDeliveries, setReportDeliveries] = useState<ReportDelivery[]>(
    [],
  );
  const [message, setMessage] = useState('');
  const [alertForm, setAlertForm] = useState(createDefaultAlertForm);
  const [alertWizardStep, setAlertWizardStep] = useState('basic');
  const [ruleForm, setRuleForm] = useState(createDefaultRuleForm);
  const [actionPolicyForm, setActionPolicyForm] = useState(
    createDefaultActionPolicyForm,
  );
  const [chatAckTemplateForm, setChatAckTemplateForm] = useState(
    createDefaultChatAckTemplateForm,
  );
  const [integrationForm, setIntegrationForm] = useState(
    createDefaultIntegrationForm,
  );
  const [reportForm, setReportForm] = useState(createDefaultReportForm);
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
  const [approvalRuleAuditOpen, setApprovalRuleAuditOpen] = useState<
    Record<string, boolean>
  >({});
  const [approvalRuleAuditLoading, setApprovalRuleAuditLoading] = useState<
    Record<string, boolean>
  >({});
  const [approvalRuleAuditLogs, setApprovalRuleAuditLogs] = useState<
    Record<string, AuditLogItem[]>
  >({});
  const [approvalRuleAuditSelected, setApprovalRuleAuditSelected] = useState<
    Record<string, string>
  >({});
  const [editingActionPolicyId, setEditingActionPolicyId] = useState<
    string | null
  >(null);
  const [editingChatAckTemplateId, setEditingChatAckTemplateId] = useState<
    string | null
  >(null);
  const [actionPolicyAuditOpen, setActionPolicyAuditOpen] = useState<
    Record<string, boolean>
  >({});
  const [actionPolicyAuditLoading, setActionPolicyAuditLoading] = useState<
    Record<string, boolean>
  >({});
  const [actionPolicyAuditLogs, setActionPolicyAuditLogs] = useState<
    Record<string, AuditLogItem[]>
  >({});
  const [actionPolicyAuditSelected, setActionPolicyAuditSelected] = useState<
    Record<string, string>
  >({});
  const [editingIntegrationId, setEditingIntegrationId] = useState<
    string | null
  >(null);
  const [editingReportId, setEditingReportId] = useState<string | null>(null);
  const [reportDeliveryFilterId, setReportDeliveryFilterId] =
    useState<string>('');
  const [reportDryRun, setReportDryRun] = useState(true);
  const alertDraftAdapter = useMemo(
    () =>
      createLocalStorageDraftAutosaveAdapter<AlertFormDraftPayload>(
        'erp4-admin-settings-alert-form-draft',
      ),
    [],
  );
  const alertFormDraftValue = useMemo<AlertFormDraftPayload>(
    () => ({
      type: alertForm.type,
      threshold: alertForm.threshold,
      period: alertForm.period,
      scopeProjectId: alertForm.scopeProjectId,
      remindAfterHours: alertForm.remindAfterHours,
      remindMaxCount: alertForm.remindMaxCount,
      emails: alertForm.emails,
      roles: alertForm.roles,
      users: alertForm.users,
      channels: Array.from(alertForm.channels),
    }),
    [alertForm],
  );
  const alertDraft = useDraftAutosave<AlertFormDraftPayload>({
    value: alertFormDraftValue,
    adapter: alertDraftAdapter,
    onRestore: (payload) => {
      setAlertForm({
        ...payload,
        slackWebhooks: '',
        webhooks: '',
        channels: new Set(payload.channels),
      });
      setEditingAlertId(null);
      setAlertWizardStep('basic');
    },
    intervalMs: 10000,
  });

  const channels = useMemo(
    () => Array.from(alertForm.channels),
    [alertForm.channels],
  );
  const toggleChannel = useCallback(
    (ch: string) => {
      const next = new Set(alertForm.channels);
      if (next.has(ch)) {
        next.delete(ch);
      } else {
        next.add(ch);
      }
      setAlertForm({ ...alertForm, channels: next });
    },
    [alertForm],
  );
  const canSubmitAlertForm = useMemo(() => {
    const thresholdValue = Number(alertForm.threshold.trim());
    return Boolean(
      alertForm.type.trim() &&
      alertForm.threshold.trim() &&
      Number.isFinite(thresholdValue) &&
      alertForm.period.trim() &&
      channels.length > 0,
    );
  }, [alertForm.period, alertForm.threshold, alertForm.type, channels.length]);
  const alertWizardSteps = useMemo(
    () => [
      {
        id: 'basic',
        title: '基本設定',
        description: '種別・閾値・期間などの基本条件を入力します。',
        isComplete: Boolean(
          alertForm.type.trim() &&
          alertForm.threshold.trim() &&
          Number.isFinite(Number(alertForm.threshold.trim())) &&
          alertForm.period.trim(),
        ),
        content: (
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
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
            <label>
              再送回数上限
              <input
                type="number"
                value={alertForm.remindMaxCount}
                onChange={(e) =>
                  setAlertForm({
                    ...alertForm,
                    remindMaxCount: e.target.value,
                  })
                }
                placeholder="3"
                min={0}
              />
            </label>
          </div>
        ),
      },
      {
        id: 'recipients',
        title: '通知先',
        description: 'メール/ロール/Webhook の送信先を定義します。',
        optional: true,
        content: (
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
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
        ),
      },
      {
        id: 'channels',
        title: 'チャネル確認',
        description: '通知チャネルを確認し、保存を実行します。',
        isComplete: channels.length > 0,
        content: (
          <div style={{ display: 'grid', gap: 8 }}>
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
            <div style={{ fontSize: 12, color: '#475569' }}>
              選択中チャネル: {channels.join(', ') || '未選択'}
            </div>
          </div>
        ),
      },
    ],
    [alertForm, channels, toggleChannel],
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
  const approvalRuleMonitoring = useMemo(() => {
    const now = new Date();
    const parseDate = (value?: string | null) => {
      if (!value) return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed;
    };
    const compareByDateDesc = (
      left: ApprovalRule,
      right: ApprovalRule,
      field: keyof ApprovalRule,
    ) => {
      const a = parseDate(left[field] as string | null);
      const b = parseDate(right[field] as string | null);
      const aTime = a ? a.getTime() : 0;
      const bTime = b ? b.getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      return 0;
    };
    const createGroup = () => ({
      effective: [] as ApprovalRule[],
      future: [] as ApprovalRule[],
      inactive: [] as ApprovalRule[],
      fallback: null as ApprovalRule | null,
    });
    const groups: Record<
      string,
      {
        effective: ApprovalRule[];
        future: ApprovalRule[];
        inactive: ApprovalRule[];
        fallback: ApprovalRule | null;
      }
    > = {};
    for (const flowType of flowTypes) {
      groups[flowType] = createGroup();
    }
    for (const rule of ruleItems) {
      const flowType = rule.flowType;
      if (!groups[flowType]) {
        groups[flowType] = createGroup();
      }
      const isActive = rule.isActive ?? true;
      const effectiveFrom = parseDate(rule.effectiveFrom ?? null);
      if (!isActive) {
        groups[flowType].inactive.push(rule);
      } else if (effectiveFrom && effectiveFrom.getTime() > now.getTime()) {
        groups[flowType].future.push(rule);
      } else {
        groups[flowType].effective.push(rule);
      }
    }
    for (const flowType of Object.keys(groups)) {
      const group = groups[flowType];
      group.effective.sort((a, b) => {
        const byEffectiveFrom = compareByDateDesc(a, b, 'effectiveFrom');
        if (byEffectiveFrom !== 0) return byEffectiveFrom;
        return compareByDateDesc(a, b, 'createdAt');
      });
      group.future.sort((a, b) => compareByDateDesc(a, b, 'effectiveFrom'));
      group.inactive.sort((a, b) => compareByDateDesc(a, b, 'updatedAt'));
      group.fallback = group.effective[0] || null;
    }
    return { now, groups };
  }, [ruleItems]);
  const logError = useCallback((label: string, err: unknown) => {
    console.error(`[AdminSettings] ${label}`, err);
  }, []);

  const loadAlertSettings = useCallback(async () => {
    try {
      const res = await api<{ items: AlertSetting[] }>('/alert-settings');
      setAlertItems(res.items || []);
    } catch (err) {
      logError('loadAlertSettings failed', err);
      setAlertItems([]);
    }
  }, [logError]);

  const loadApprovalRules = useCallback(async () => {
    try {
      const res = await api<{ items: ApprovalRule[] }>('/approval-rules');
      setRuleItems(res.items || []);
    } catch (err) {
      logError('loadApprovalRules failed', err);
      setRuleItems([]);
    }
  }, [logError]);

  const loadApprovalRuleAuditLogs = useCallback(
    async (ruleId: string) => {
      try {
        setApprovalRuleAuditLoading((prev) => ({ ...prev, [ruleId]: true }));
        const query = new URLSearchParams();
        query.set('targetTable', 'approval_rules');
        query.set('targetId', ruleId);
        query.set('limit', '50');
        query.set('format', 'json');
        const res = await api<{ items: AuditLogItem[] }>(
          `/audit-logs?${query.toString()}`,
        );
        setApprovalRuleAuditLogs((prev) => ({
          ...prev,
          [ruleId]: res.items || [],
        }));
      } catch (err) {
        logError('loadApprovalRuleAuditLogs failed', err);
        setApprovalRuleAuditLogs((prev) => ({ ...prev, [ruleId]: [] }));
        setMessage('承認ルールの履歴取得に失敗しました');
      } finally {
        setApprovalRuleAuditLoading((prev) => ({ ...prev, [ruleId]: false }));
      }
    },
    [logError, setMessage],
  );

  const loadActionPolicies = useCallback(async () => {
    try {
      const res = await api<{ items: ActionPolicy[] }>('/action-policies');
      setActionPolicyItems(res.items || []);
    } catch (err) {
      logError('loadActionPolicies failed', err);
      setActionPolicyItems([]);
    }
  }, [logError]);

  const loadChatAckTemplates = useCallback(async () => {
    try {
      const res = await api<{ items: ChatAckTemplate[] }>(
        '/chat-ack-templates',
      );
      setChatAckTemplateItems(res.items || []);
    } catch (err) {
      logError('loadChatAckTemplates failed', err);
      setChatAckTemplateItems([]);
    }
  }, [logError]);

  const loadActionPolicyAuditLogs = useCallback(
    async (policyId: string) => {
      try {
        setActionPolicyAuditLoading((prev) => ({
          ...prev,
          [policyId]: true,
        }));
        const query = new URLSearchParams();
        query.set('targetTable', 'action_policies');
        query.set('targetId', policyId);
        query.set('limit', '50');
        query.set('format', 'json');
        const res = await api<{ items: AuditLogItem[] }>(
          `/audit-logs?${query.toString()}`,
        );
        setActionPolicyAuditLogs((prev) => ({
          ...prev,
          [policyId]: res.items || [],
        }));
      } catch (err) {
        logError('loadActionPolicyAuditLogs failed', err);
        setActionPolicyAuditLogs((prev) => ({ ...prev, [policyId]: [] }));
        setMessage('ActionPolicy の履歴取得に失敗しました');
      } finally {
        setActionPolicyAuditLoading((prev) => ({
          ...prev,
          [policyId]: false,
        }));
      }
    },
    [logError, setMessage],
  );

  const loadTemplateSettings = useCallback(async () => {
    try {
      const res = await api<{ items: TemplateSetting[] }>('/template-settings');
      setTemplateItems(res.items || []);
    } catch (err) {
      logError('loadTemplateSettings failed', err);
      setTemplateItems([]);
    }
  }, [logError]);

  const loadPdfTemplates = useCallback(async () => {
    try {
      const res = await api<{ items: PdfTemplate[] }>('/pdf-templates');
      setPdfTemplates(res.items || []);
    } catch (err) {
      logError('loadPdfTemplates failed', err);
      setPdfTemplates([]);
    }
  }, [logError]);

  const loadIntegrationSettings = useCallback(async () => {
    try {
      const res = await api<{ items: IntegrationSetting[] }>(
        '/integration-settings',
      );
      setIntegrationItems(res.items || []);
    } catch (err) {
      logError('loadIntegrationSettings failed', err);
      setIntegrationItems([]);
    }
  }, [logError]);

  const loadReportSubscriptions = useCallback(async () => {
    try {
      const res = await api<{ items: ReportSubscription[] }>(
        '/report-subscriptions',
      );
      setReportItems(res.items || []);
    } catch (err) {
      logError('loadReportSubscriptions failed', err);
      setReportItems([]);
    }
  }, [logError]);

  const loadReportDeliveries = useCallback(
    async (subscriptionId?: string) => {
      try {
        const query = new URLSearchParams();
        if (subscriptionId) {
          query.set('subscriptionId', subscriptionId);
        }
        const suffix = query.toString();
        const res = await api<{ items: ReportDelivery[] }>(
          `/report-deliveries${suffix ? `?${suffix}` : ''}`,
        );
        setReportDeliveries(res.items || []);
      } catch (err) {
        logError('loadReportDeliveries failed', err);
        setReportDeliveries([]);
      }
    },
    [logError],
  );

  const loadIntegrationRuns = useCallback(
    async (settingId?: string) => {
      try {
        const query = new URLSearchParams();
        if (settingId) {
          query.set('settingId', settingId);
        }
        query.set('limit', '50');
        const suffix = query.toString();
        const res = await api<{ items: IntegrationRun[] }>(
          `/integration-runs${suffix ? `?${suffix}` : ''}`,
        );
        setIntegrationRuns(res.items || []);
      } catch (err) {
        logError('loadIntegrationRuns failed', err);
        setIntegrationRuns([]);
      }
    },
    [logError],
  );

  useEffect(() => {
    loadAlertSettings();
    loadApprovalRules();
    loadActionPolicies();
    loadChatAckTemplates();
    loadTemplateSettings();
    loadPdfTemplates();
    loadIntegrationSettings();
    loadReportSubscriptions();
  }, [
    loadAlertSettings,
    loadApprovalRules,
    loadActionPolicies,
    loadChatAckTemplates,
    loadTemplateSettings,
    loadPdfTemplates,
    loadIntegrationSettings,
    loadReportSubscriptions,
  ]);

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

  const toggleApprovalRuleActive = async (
    id: string,
    current: boolean | null | undefined,
  ) => {
    try {
      await api(`/approval-rules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !(current ?? true) }),
      });
      await loadApprovalRules();
    } catch (err) {
      logError('toggleApprovalRuleActive failed', err);
      setMessage('状態変更に失敗しました');
    }
  };

  const parseJson = (label: string, raw: string) => {
    if (!raw.trim()) return undefined;
    try {
      return JSON.parse(raw);
    } catch (err) {
      // Invalid JSON from manual input is an expected validation case.
      if (import.meta.env.DEV) {
        console.warn(`[AdminSettings] parseJson ${label} failed`, err);
      }
      setMessage(`${label} のJSONが不正です`);
      return null;
    }
  };

  const resetAlertForm = () => {
    setAlertForm(createDefaultAlertForm());
    setEditingAlertId(null);
    setAlertWizardStep('basic');
  };

  const resetRuleForm = () => {
    setRuleForm(createDefaultRuleForm());
    setEditingRuleId(null);
  };

  const resetActionPolicyForm = () => {
    setActionPolicyForm(createDefaultActionPolicyForm());
    setEditingActionPolicyId(null);
  };

  const resetChatAckTemplateForm = () => {
    setChatAckTemplateForm(createDefaultChatAckTemplateForm());
    setEditingChatAckTemplateId(null);
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

  const resetIntegrationForm = () => {
    setIntegrationForm(createDefaultIntegrationForm());
    setEditingIntegrationId(null);
  };

  const resetReportForm = () => {
    setReportForm(createDefaultReportForm());
    setEditingReportId(null);
  };

  const submitIntegrationSetting = async () => {
    if (!integrationForm.type.trim()) {
      setMessage('連携種別を選択してください');
      return;
    }
    const config = parseJson('config', integrationForm.configJson);
    if (config === null) return;
    const payload = {
      type: integrationForm.type,
      name: integrationForm.name.trim() || undefined,
      provider: integrationForm.provider.trim() || undefined,
      status: integrationForm.status || undefined,
      schedule: integrationForm.schedule.trim() || undefined,
      config: config || undefined,
    };
    try {
      if (editingIntegrationId) {
        await api(`/integration-settings/${editingIntegrationId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setMessage('連携設定を更新しました');
      } else {
        await api('/integration-settings', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage('連携設定を作成しました');
      }
      await loadIntegrationSettings();
      resetIntegrationForm();
    } catch (err) {
      logError('submitIntegrationSetting failed', err);
      setMessage('連携設定の保存に失敗しました');
    }
  };

  const startEditIntegration = (item: IntegrationSetting) => {
    setEditingIntegrationId(item.id);
    setIntegrationForm({
      type: item.type,
      name: item.name || '',
      provider: item.provider || '',
      status: item.status || 'active',
      schedule: item.schedule || '',
      configJson: item.config ? JSON.stringify(item.config, null, 2) : '',
    });
  };

  const runIntegrationSetting = async (id: string) => {
    try {
      await api(`/integration-settings/${id}/run`, { method: 'POST' });
      setMessage('連携を実行しました');
      await loadIntegrationSettings();
    } catch (err) {
      logError('runIntegrationSetting failed', err);
      setMessage('連携の実行に失敗しました');
    }
  };

  const submitReportSubscription = async () => {
    const reportKey = reportForm.reportKey.trim();
    if (!reportKey) {
      setMessage('reportKey を入力してください');
      return;
    }
    const params = parseJson('params', reportForm.paramsJson);
    if (params === null) return;
    const recipients = parseJson('recipients', reportForm.recipientsJson);
    if (recipients === null) return;
    const channels = parseCsv(reportForm.channels);
    const payload = {
      name: reportForm.name.trim() || undefined,
      reportKey,
      format: reportForm.format || undefined,
      schedule: reportForm.schedule.trim() || undefined,
      params: params || undefined,
      recipients: recipients || undefined,
      channels: channels.length ? channels : undefined,
      isEnabled: reportForm.isEnabled,
    };
    try {
      if (editingReportId) {
        await api(`/report-subscriptions/${editingReportId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setMessage('レポート購読を更新しました');
      } else {
        await api('/report-subscriptions', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage('レポート購読を作成しました');
      }
      await loadReportSubscriptions();
      resetReportForm();
    } catch (err) {
      logError('submitReportSubscription failed', err);
      setMessage(editingReportId ? '更新に失敗しました' : '保存に失敗しました');
    }
  };

  const startEditReportSubscription = (item: ReportSubscription) => {
    setEditingReportId(item.id);
    setReportForm({
      name: item.name || '',
      reportKey: item.reportKey || '',
      format: item.format || 'csv',
      schedule: item.schedule || '',
      paramsJson: item.params ? JSON.stringify(item.params, null, 2) : '',
      recipientsJson: item.recipients
        ? JSON.stringify(item.recipients, null, 2)
        : '',
      channels: (item.channels || []).join(','),
      isEnabled: item.isEnabled ?? true,
    });
  };

  const toggleReportSubscription = async (item: ReportSubscription) => {
    const nextEnabled = !(item.isEnabled ?? true);
    try {
      await api(`/report-subscriptions/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isEnabled: nextEnabled }),
      });
      setMessage(
        nextEnabled
          ? 'レポート購読を有効化しました'
          : 'レポート購読を無効化しました',
      );
      await loadReportSubscriptions();
    } catch (err) {
      logError('toggleReportSubscription failed', err);
      setMessage('レポート購読の更新に失敗しました');
    }
  };

  const runReportSubscription = async (id: string) => {
    try {
      await api(`/report-subscriptions/${id}/run`, {
        method: 'POST',
        body: JSON.stringify({ dryRun: reportDryRun }),
      });
      setMessage('レポートを実行しました');
      await loadReportSubscriptions();
      if (!reportDryRun) {
        setReportDeliveryFilterId(id);
        await loadReportDeliveries(id);
      }
    } catch (err) {
      logError('runReportSubscription failed', err);
      setMessage('レポート実行に失敗しました');
    }
  };

  const runAllReportSubscriptions = async () => {
    try {
      const res = await api<{ count?: number }>(
        '/jobs/report-subscriptions/run',
        {
          method: 'POST',
          body: JSON.stringify({ dryRun: reportDryRun }),
        },
      );
      const count = res?.count ?? 0;
      setMessage(`レポートを実行しました (${count}件)`);
      await loadReportSubscriptions();
      if (!reportDryRun) {
        await loadReportDeliveries(reportDeliveryFilterId || undefined);
      }
    } catch (err) {
      logError('runAllReportSubscriptions failed', err);
      setMessage('一括実行に失敗しました');
    }
  };

  const showReportDeliveries = async (subscriptionId?: string) => {
    setReportDeliveryFilterId(subscriptionId || '');
    await loadReportDeliveries(subscriptionId);
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
    setAlertWizardStep('basic');
    setAlertForm({
      type: item.type,
      threshold: String(item.threshold ?? ''),
      period: item.period || '',
      scopeProjectId: item.scopeProjectId || '',
      remindAfterHours:
        item.remindAfterHours != null ? String(item.remindAfterHours) : '',
      remindMaxCount:
        item.remindMaxCount != null ? String(item.remindMaxCount) : '',
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
    const thresholdRaw = alertForm.threshold.trim();
    const thresholdValue = Number(thresholdRaw);
    if (!thresholdRaw || !Number.isFinite(thresholdValue)) {
      setMessage('閾値は数値で入力してください');
      return;
    }
    const remindAfterRaw = alertForm.remindAfterHours.trim();
    const remindMaxRaw = alertForm.remindMaxCount.trim();
    const remindAfter =
      remindAfterRaw.length > 0 ? Number(remindAfterRaw) : undefined;
    const remindMax =
      remindMaxRaw.length > 0 ? Number(remindMaxRaw) : undefined;
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
      threshold: thresholdValue,
      period: alertForm.period,
      scopeProjectId: alertForm.scopeProjectId || undefined,
      remindAfterHours: Number.isFinite(remindAfter) ? remindAfter : undefined,
      remindMaxCount: Number.isFinite(remindMax) ? remindMax : undefined,
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
      try {
        await alertDraft.clearDraft();
      } catch (clearErr) {
        logError('alertDraft.clearDraft failed', clearErr);
      }
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

  const startEditActionPolicy = (item: ActionPolicy) => {
    setEditingActionPolicyId(item.id);
    setActionPolicyForm({
      flowType: item.flowType,
      actionKey: item.actionKey,
      priority: item.priority ?? 0,
      isEnabled: item.isEnabled ?? true,
      requireReason: item.requireReason ?? false,
      subjectsJson: item.subjects ? JSON.stringify(item.subjects, null, 2) : '',
      stateConstraintsJson: item.stateConstraints
        ? JSON.stringify(item.stateConstraints, null, 2)
        : '',
      guardsJson: item.guards ? JSON.stringify(item.guards, null, 2) : '',
    });
  };

  const submitActionPolicy = async (
    formValue: ActionPolicyForm = actionPolicyForm,
  ) => {
    const actionKey = formValue.actionKey.trim();
    if (!actionKey) {
      setMessage('actionKey を入力してください');
      return;
    }
    const priority = formValue.priority;
    if (
      priority !== undefined &&
      (!Number.isFinite(priority) || !Number.isInteger(priority))
    ) {
      setMessage('priority は整数で入力してください');
      return;
    }
    const subjects = parseJson('subjects', formValue.subjectsJson);
    if (subjects === null) return;
    const stateConstraints = parseJson(
      'stateConstraints',
      formValue.stateConstraintsJson,
    );
    if (stateConstraints === null) return;
    const guards = parseJson('guards', formValue.guardsJson);
    if (guards === null) return;

    const payload = {
      flowType: formValue.flowType,
      actionKey,
      priority,
      isEnabled: formValue.isEnabled,
      requireReason: formValue.requireReason,
      ...(subjects !== undefined ? { subjects } : {}),
      ...(stateConstraints !== undefined ? { stateConstraints } : {}),
      ...(guards !== undefined ? { guards } : {}),
    };

    try {
      if (editingActionPolicyId) {
        await api(`/action-policies/${editingActionPolicyId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setMessage('ActionPolicy を更新しました');
      } else {
        await api('/action-policies', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage('ActionPolicy を作成しました');
      }
      await loadActionPolicies();
      resetActionPolicyForm();
    } catch (err) {
      logError('submitActionPolicy failed', err);
      if (editingActionPolicyId) {
        setMessage('更新に失敗しました。新規作成モードに戻しました');
        resetActionPolicyForm();
        return;
      }
      setMessage('保存に失敗しました');
    }
  };

  const submitChatAckTemplate = async () => {
    const flowType = chatAckTemplateForm.flowType.trim();
    const actionKey = chatAckTemplateForm.actionKey.trim();
    const messageBody = chatAckTemplateForm.messageBody.trim();
    if (!flowType || !actionKey || !messageBody) {
      setMessage('flowType / actionKey / messageBody を入力してください');
      return;
    }
    const requiredUserIds = parseJson(
      'requiredUserIds',
      chatAckTemplateForm.requiredUserIdsJson,
    );
    if (requiredUserIds === null) return;
    const requiredGroupIds = parseJson(
      'requiredGroupIds',
      chatAckTemplateForm.requiredGroupIdsJson,
    );
    if (requiredGroupIds === null) return;
    const requiredRoles = parseJson(
      'requiredRoles',
      chatAckTemplateForm.requiredRolesJson,
    );
    if (requiredRoles === null) return;
    const escalationUserIds = parseJson(
      'escalationUserIds',
      chatAckTemplateForm.escalationUserIdsJson,
    );
    if (escalationUserIds === null) return;
    const escalationGroupIds = parseJson(
      'escalationGroupIds',
      chatAckTemplateForm.escalationGroupIdsJson,
    );
    if (escalationGroupIds === null) return;
    const escalationRoles = parseJson(
      'escalationRoles',
      chatAckTemplateForm.escalationRolesJson,
    );
    if (escalationRoles === null) return;

    const parseOptionalNumber = (raw: string, min: number) => {
      const trimmed = raw.trim();
      if (!trimmed) return undefined;
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < min) return null;
      return Math.floor(parsed);
    };

    const dueInHours = parseOptionalNumber(chatAckTemplateForm.dueInHours, 0);
    if (dueInHours === null) {
      setMessage('dueInHours は0以上の数値で入力してください');
      return;
    }
    const remindIntervalHours = parseOptionalNumber(
      chatAckTemplateForm.remindIntervalHours,
      1,
    );
    if (remindIntervalHours === null) {
      setMessage('remindIntervalHours は1以上の数値で入力してください');
      return;
    }
    const escalationAfterHours = parseOptionalNumber(
      chatAckTemplateForm.escalationAfterHours,
      1,
    );
    if (escalationAfterHours === null) {
      setMessage('escalationAfterHours は1以上の数値で入力してください');
      return;
    }

    const payload = {
      flowType,
      actionKey,
      messageBody,
      requiredUserIds: requiredUserIds || undefined,
      requiredGroupIds: requiredGroupIds || undefined,
      requiredRoles: requiredRoles || undefined,
      dueInHours,
      remindIntervalHours,
      escalationAfterHours,
      escalationUserIds: escalationUserIds || undefined,
      escalationGroupIds: escalationGroupIds || undefined,
      escalationRoles: escalationRoles || undefined,
      isEnabled: chatAckTemplateForm.isEnabled,
    };

    try {
      if (editingChatAckTemplateId) {
        await api(`/chat-ack-templates/${editingChatAckTemplateId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setMessage('Ackテンプレートを更新しました');
      } else {
        await api('/chat-ack-templates', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage('Ackテンプレートを作成しました');
      }
      await loadChatAckTemplates();
      resetChatAckTemplateForm();
    } catch (err) {
      logError('submitChatAckTemplate failed', err);
      setMessage('Ackテンプレートの保存に失敗しました');
    }
  };

  const startEditChatAckTemplate = (item: ChatAckTemplate) => {
    setEditingChatAckTemplateId(item.id);
    setChatAckTemplateForm({
      flowType: item.flowType,
      actionKey: item.actionKey,
      messageBody: item.messageBody,
      requiredUserIdsJson: item.requiredUserIds
        ? JSON.stringify(item.requiredUserIds, null, 2)
        : '[]',
      requiredGroupIdsJson: item.requiredGroupIds
        ? JSON.stringify(item.requiredGroupIds, null, 2)
        : '[]',
      requiredRolesJson: item.requiredRoles
        ? JSON.stringify(item.requiredRoles, null, 2)
        : '[]',
      dueInHours:
        item.dueInHours !== null && item.dueInHours !== undefined
          ? String(item.dueInHours)
          : '',
      remindIntervalHours:
        item.remindIntervalHours !== null &&
        item.remindIntervalHours !== undefined
          ? String(item.remindIntervalHours)
          : '',
      escalationAfterHours:
        item.escalationAfterHours !== null &&
        item.escalationAfterHours !== undefined
          ? String(item.escalationAfterHours)
          : '',
      escalationUserIdsJson: item.escalationUserIds
        ? JSON.stringify(item.escalationUserIds, null, 2)
        : '[]',
      escalationGroupIdsJson: item.escalationGroupIds
        ? JSON.stringify(item.escalationGroupIds, null, 2)
        : '[]',
      escalationRolesJson: item.escalationRoles
        ? JSON.stringify(item.escalationRoles, null, 2)
        : '[]',
      isEnabled: item.isEnabled ?? true,
    });
  };

  const startEditRule = (item: ApprovalRule) => {
    setEditingRuleId(item.id);
    setRuleForm({
      flowType: item.flowType,
      version: String(item.version ?? 1),
      isActive: item.isActive ?? true,
      effectiveFrom: item.effectiveFrom ?? '',
      conditionsJson: item.conditions
        ? JSON.stringify(item.conditions, null, 2)
        : '',
      stepsJson: item.steps ? JSON.stringify(item.steps, null, 2) : '[]',
    });
  };

  const submitApprovalRule = async () => {
    const versionRaw = ruleForm.version.trim();
    let version: number | undefined;
    if (versionRaw.length > 0) {
      const parsed = Number(versionRaw);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
        setMessage('version は1以上の整数で入力してください');
        return;
      }
      version = parsed;
    }
    const effectiveFrom = ruleForm.effectiveFrom.trim();
    const conditions = parseJson('conditions', ruleForm.conditionsJson);
    if (conditions === null) return;
    const steps = parseJson('steps', ruleForm.stepsJson);
    if (steps === null) return;
    if (steps === undefined) {
      setMessage('steps を入力してください');
      return;
    }
    const isStepsArray = Array.isArray(steps);
    const isStepsObject = !isStepsArray && steps && typeof steps === 'object';
    if (!isStepsArray && !isStepsObject) {
      setMessage('steps は配列または {stages:[...]} の形式で入力してください');
      return;
    }
    if (isStepsArray) {
      if (!steps.length) {
        setMessage('steps は1件以上必要です');
        return;
      }
    } else {
      const stages = (steps as Record<string, unknown>).stages;
      if (!Array.isArray(stages) || stages.length < 1) {
        setMessage('stages は1件以上必要です');
        return;
      }
    }
    const payload = {
      flowType: ruleForm.flowType,
      version,
      isActive: ruleForm.isActive,
      ...(effectiveFrom ? { effectiveFrom } : {}),
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
        <ChatSettingsCard />
        <ChatRoomSettingsCard />
        <GroupManagementCard />
        <ScimSettingsCard />
        <RateCardSettingsCard />
        <WorklogSettingsCard />
        <div className="card" style={{ padding: 12 }}>
          <strong>アラート設定（簡易モック）</strong>
          <div style={{ marginTop: 8 }}>
            <FormWizard
              steps={alertWizardSteps}
              value={alertWizardStep}
              onValueChange={setAlertWizardStep}
              canSubmit={canSubmitAlertForm}
              isDirty={alertDraft.isDirty}
              protectUnsavedChanges
              autosave={{
                status: alertDraft.status,
                lastSavedAt: alertDraft.lastSavedAt
                  ? new Date(alertDraft.lastSavedAt).toLocaleString()
                  : undefined,
                message: alertDraft.errorMessage,
                onRestoreDraft: alertDraft.hasRestorableDraft
                  ? alertDraft.restoreDraft
                  : undefined,
                onRetrySave: () => {
                  void alertDraft.saveNow();
                },
              }}
              labels={{
                back: '戻る',
                next: '次へ',
                submit: editingAlertId ? '更新' : '作成',
                cancel: editingAlertId ? 'キャンセル' : 'クリア',
                optional: '任意',
                autosavePrefix: '下書き',
              }}
              onSubmit={submitAlertSetting}
              onCancel={() => {
                resetAlertForm();
                void alertDraft.clearDraft();
              }}
            />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="button secondary" onClick={loadAlertSettings}>
                再読込
              </button>
            </div>
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
                  remindAfterHours: {item.remindAfterHours ?? '-'} / maxCount:{' '}
                  {item.remindMaxCount ?? '-'}
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
                    {(item.isEnabled ?? true) ? '無効化' : '有効化'}
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
          <div style={{ fontSize: 12, color: '#475569', marginTop: 6 }}>
            <div>
              注意: ルール変更は既存の進行中承認には適用されません（申請時に
              steps/stagePolicy をスナップショット保持）。
              適用が必要な場合は「取消→再申請」運用で反映します。
            </div>
            <div>
              運用監視: isActive=true かつ effectiveFrom&lt;=現在時刻 が候補。
              複数候補がある場合は effectiveFrom desc / createdAt desc
              の順で評価し、条件一致がなければ先頭が fallback になります。
            </div>
          </div>
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer' }}>
              運用監視（有効化状態/影響範囲）
            </summary>
            <div
              className="list"
              style={{ display: 'grid', gap: 8, marginTop: 8 }}
            >
              <div style={{ fontSize: 12, color: '#475569' }}>
                現在時刻: {approvalRuleMonitoring.now.toLocaleString()}
              </div>
              {[
                ...flowTypes,
                ...Object.keys(approvalRuleMonitoring.groups)
                  .filter((flowType) => !flowTypes.includes(flowType))
                  .sort(),
              ].map((flowType) => {
                const group = approvalRuleMonitoring.groups[flowType];
                const fallback = group?.fallback || null;
                return (
                  <div key={flowType} className="card" style={{ padding: 10 }}>
                    <div
                      className="row"
                      style={{
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                      }}
                    >
                      <strong>{flowType}</strong>
                      <span className="badge">
                        effective:{group?.effective.length ?? 0} / future:
                        {group?.future.length ?? 0} / inactive:
                        {group?.inactive.length ?? 0}
                      </span>
                    </div>
                    <div
                      style={{ fontSize: 12, color: '#475569', marginTop: 4 }}
                    >
                      fallback:{' '}
                      {fallback
                        ? `v${fallback.version ?? 1} id=${fallback.id} effectiveFrom=${formatDateTime(
                            fallback.effectiveFrom,
                          )}`
                        : '-'}
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
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
            <label>
              version
              <input
                type="number"
                value={ruleForm.version}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, version: e.target.value })
                }
                min={1}
              />
            </label>
            <label>
              effectiveFrom (任意, ISO date-time)
              <input
                type="text"
                value={ruleForm.effectiveFrom}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, effectiveFrom: e.target.value })
                }
                placeholder="2026-01-29T00:00:00Z"
              />
            </label>
            <label className="badge" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={ruleForm.isActive}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, isActive: e.target.checked })
                }
                style={{ marginRight: 6 }}
              />
              isActive
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
            {ruleItems.map((rule) => {
              const isActive = rule.isActive ?? true;
              const effectiveFrom = rule.effectiveFrom
                ? new Date(rule.effectiveFrom)
                : null;
              const isEffectiveFromValid =
                Boolean(effectiveFrom) &&
                !Number.isNaN(effectiveFrom!.getTime());
              const now = approvalRuleMonitoring.now;
              const statusLabel = !isActive
                ? 'inactive'
                : isEffectiveFromValid &&
                    effectiveFrom!.getTime() > now.getTime()
                  ? 'future'
                  : 'effective';
              const isHistoryOpen = approvalRuleAuditOpen[rule.id] ?? false;
              const isHistoryLoading =
                approvalRuleAuditLoading[rule.id] ?? false;
              const auditLogs = approvalRuleAuditLogs[rule.id] || [];
              return (
                <div key={rule.id} className="card" style={{ padding: 12 }}>
                  <div
                    className="row"
                    style={{
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 6,
                    }}
                  >
                    <div>
                      <strong>{rule.flowType}</strong> (v{rule.version ?? 1}) /
                      id={rule.id}
                    </div>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <span className="badge">{statusLabel}</span>
                      <span className="badge">
                        isActive: {isActive ? 'true' : 'false'}
                      </span>
                      <span className="badge">
                        effectiveFrom: {formatDateTime(rule.effectiveFrom)}
                      </span>
                      <span className="badge">
                        updatedAt: {formatDateTime(rule.updatedAt)}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: '#475569',
                      marginTop: 4,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    conditions:{' '}
                    {rule.conditions ? formatJson(rule.conditions) : '-'}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: '#475569',
                      marginTop: 4,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    steps: {rule.steps ? formatJson(rule.steps) : '-'}
                  </div>
                  <div
                    className="row"
                    style={{ marginTop: 6, flexWrap: 'wrap' }}
                  >
                    <button
                      className="button secondary"
                      onClick={() =>
                        toggleApprovalRuleActive(rule.id, rule.isActive)
                      }
                    >
                      {isActive ? '無効化' : '有効化'}
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => startEditRule(rule)}
                    >
                      編集
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => {
                        const nextOpen = !isHistoryOpen;
                        setApprovalRuleAuditOpen((prev) => ({
                          ...prev,
                          [rule.id]: nextOpen,
                        }));
                        if (
                          nextOpen &&
                          approvalRuleAuditLogs[rule.id] === undefined
                        ) {
                          loadApprovalRuleAuditLogs(rule.id);
                        }
                      }}
                    >
                      {isHistoryOpen ? '履歴を閉じる' : '履歴を見る'}
                    </button>
                    {isHistoryOpen && (
                      <button
                        className="button secondary"
                        onClick={() => loadApprovalRuleAuditLogs(rule.id)}
                      >
                        履歴を再読込
                      </button>
                    )}
                  </div>
                  {isHistoryOpen && (
                    <div style={{ marginTop: 8 }}>
                      {isHistoryLoading && (
                        <div style={{ fontSize: 12, color: '#475569' }}>
                          読み込み中...
                        </div>
                      )}
                      {!isHistoryLoading && auditLogs.length === 0 && (
                        <div
                          className="card"
                          style={{ padding: 10, fontSize: 12 }}
                        >
                          履歴なし
                        </div>
                      )}
                      {!isHistoryLoading && (
                        <AuditHistoryPanel
                          logs={auditLogs}
                          selectedLogId={approvalRuleAuditSelected[rule.id]}
                          onSelectLog={(logId) => {
                            setApprovalRuleAuditSelected((prev) => ({
                              ...prev,
                              [rule.id]: logId,
                            }));
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <strong>ActionPolicy（権限/ロック）</strong>
          <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
            <PolicyFormBuilder
              schema={actionPolicyFormSchema}
              value={actionPolicyForm}
              onChange={(next) => {
                setActionPolicyForm(normalizeActionPolicyForm(next));
              }}
              onSubmit={(next) => {
                const normalized = normalizeActionPolicyForm(next);
                setActionPolicyForm(normalized);
                void submitActionPolicy(normalized);
              }}
              onReset={resetActionPolicyForm}
              layout="sectioned"
              submitLabel={editingActionPolicyId ? '更新' : '作成'}
              resetLabel={editingActionPolicyId ? 'キャンセル' : 'クリア'}
            />
            <div className="row">
              <button className="button secondary" onClick={loadActionPolicies}>
                再読込
              </button>
            </div>
          </div>
          <div
            className="list"
            style={{ display: 'grid', gap: 8, marginTop: 8 }}
          >
            {actionPolicyItems.length === 0 && (
              <div className="card">ポリシーなし</div>
            )}
            {actionPolicyItems.map((item) => {
              const isHistoryOpen = actionPolicyAuditOpen[item.id] ?? false;
              const isHistoryLoading =
                actionPolicyAuditLoading[item.id] ?? false;
              const auditLogs = actionPolicyAuditLogs[item.id] || [];
              return (
                <div key={item.id} className="card" style={{ padding: 12 }}>
                  <div
                    className="row"
                    style={{
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <strong>
                        {item.flowType} / {item.actionKey}
                      </strong>{' '}
                      (priority: {item.priority ?? 0}) / id={item.id}
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="badge">
                        {(item.isEnabled ?? true) ? 'enabled' : 'disabled'}
                      </span>
                      <span className="badge">
                        {item.requireReason ? 'requireReason' : 'no-reason'}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: '#475569',
                      marginTop: 4,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    subjects: {item.subjects ? formatJson(item.subjects) : '-'}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: '#475569',
                      marginTop: 4,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    stateConstraints:{' '}
                    {item.stateConstraints
                      ? formatJson(item.stateConstraints)
                      : '-'}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: '#475569',
                      marginTop: 4,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    guards: {item.guards ? formatJson(item.guards) : '-'}
                  </div>
                  <div
                    className="row"
                    style={{ marginTop: 6, flexWrap: 'wrap' }}
                  >
                    <button
                      className="button secondary"
                      onClick={() => startEditActionPolicy(item)}
                    >
                      編集
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => {
                        const nextOpen = !isHistoryOpen;
                        setActionPolicyAuditOpen((prev) => ({
                          ...prev,
                          [item.id]: nextOpen,
                        }));
                        if (
                          nextOpen &&
                          actionPolicyAuditLogs[item.id] === undefined
                        ) {
                          loadActionPolicyAuditLogs(item.id);
                        }
                      }}
                    >
                      {isHistoryOpen ? '履歴を閉じる' : '履歴を見る'}
                    </button>
                    {isHistoryOpen && (
                      <button
                        className="button secondary"
                        onClick={() => loadActionPolicyAuditLogs(item.id)}
                      >
                        履歴を再読込
                      </button>
                    )}
                  </div>
                  {isHistoryOpen && (
                    <div style={{ marginTop: 8 }}>
                      {isHistoryLoading && (
                        <div style={{ fontSize: 12, color: '#475569' }}>
                          読み込み中...
                        </div>
                      )}
                      {!isHistoryLoading && auditLogs.length === 0 && (
                        <div
                          className="card"
                          style={{ padding: 10, fontSize: 12 }}
                        >
                          履歴なし
                        </div>
                      )}
                      {!isHistoryLoading && (
                        <AuditHistoryPanel
                          logs={auditLogs}
                          selectedLogId={actionPolicyAuditSelected[item.id]}
                          onSelectLog={(logId) => {
                            setActionPolicyAuditSelected((prev) => ({
                              ...prev,
                              [item.id]: logId,
                            }));
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <strong>合意形成テンプレ（ack required）</strong>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <label>
              flowType
              <select
                value={chatAckTemplateForm.flowType}
                onChange={(e) =>
                  setChatAckTemplateForm({
                    ...chatAckTemplateForm,
                    flowType: e.target.value,
                  })
                }
              >
                {flowTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              actionKey
              <input
                type="text"
                value={chatAckTemplateForm.actionKey}
                onChange={(e) =>
                  setChatAckTemplateForm({
                    ...chatAckTemplateForm,
                    actionKey: e.target.value,
                  })
                }
                placeholder="approve/reject"
              />
            </label>
            <label className="badge" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={chatAckTemplateForm.isEnabled}
                onChange={(e) =>
                  setChatAckTemplateForm({
                    ...chatAckTemplateForm,
                    isEnabled: e.target.checked,
                  })
                }
                style={{ marginRight: 6 }}
              />
              isEnabled
            </label>
          </div>
          <label style={{ display: 'block', marginTop: 8 }}>
            messageBody
            <textarea
              value={chatAckTemplateForm.messageBody}
              onChange={(e) =>
                setChatAckTemplateForm({
                  ...chatAckTemplateForm,
                  messageBody: e.target.value,
                })
              }
              rows={3}
              style={{ width: '100%' }}
              placeholder="合意形成メッセージ本文"
            />
          </label>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <label style={{ flex: 1, minWidth: 240 }}>
              requiredUserIds (JSON)
              <textarea
                value={chatAckTemplateForm.requiredUserIdsJson}
                onChange={(e) =>
                  setChatAckTemplateForm({
                    ...chatAckTemplateForm,
                    requiredUserIdsJson: e.target.value,
                  })
                }
                rows={3}
                style={{ width: '100%' }}
                placeholder='["user@example.com"]'
              />
            </label>
            <label style={{ flex: 1, minWidth: 240 }}>
              requiredGroupIds (JSON)
              <textarea
                value={chatAckTemplateForm.requiredGroupIdsJson}
                onChange={(e) =>
                  setChatAckTemplateForm({
                    ...chatAckTemplateForm,
                    requiredGroupIdsJson: e.target.value,
                  })
                }
                rows={3}
                style={{ width: '100%' }}
                placeholder='["group-id"]'
              />
            </label>
            <label style={{ flex: 1, minWidth: 240 }}>
              requiredRoles (JSON)
              <textarea
                value={chatAckTemplateForm.requiredRolesJson}
                onChange={(e) =>
                  setChatAckTemplateForm({
                    ...chatAckTemplateForm,
                    requiredRolesJson: e.target.value,
                  })
                }
                rows={3}
                style={{ width: '100%' }}
                placeholder='["mgmt"]'
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <label>
              dueInHours
              <input
                type="number"
                value={chatAckTemplateForm.dueInHours}
                onChange={(e) =>
                  setChatAckTemplateForm({
                    ...chatAckTemplateForm,
                    dueInHours: e.target.value,
                  })
                }
                placeholder="(任意)"
                min={0}
              />
            </label>
            <label>
              remindIntervalHours
              <input
                type="number"
                value={chatAckTemplateForm.remindIntervalHours}
                onChange={(e) =>
                  setChatAckTemplateForm({
                    ...chatAckTemplateForm,
                    remindIntervalHours: e.target.value,
                  })
                }
                placeholder="(任意)"
                min={1}
              />
            </label>
            <label>
              escalationAfterHours
              <input
                type="number"
                value={chatAckTemplateForm.escalationAfterHours}
                onChange={(e) =>
                  setChatAckTemplateForm({
                    ...chatAckTemplateForm,
                    escalationAfterHours: e.target.value,
                  })
                }
                placeholder="(任意)"
                min={1}
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <label style={{ flex: 1, minWidth: 240 }}>
              escalationUserIds (JSON)
              <textarea
                value={chatAckTemplateForm.escalationUserIdsJson}
                onChange={(e) =>
                  setChatAckTemplateForm({
                    ...chatAckTemplateForm,
                    escalationUserIdsJson: e.target.value,
                  })
                }
                rows={3}
                style={{ width: '100%' }}
                placeholder='["manager@example.com"]'
              />
            </label>
            <label style={{ flex: 1, minWidth: 240 }}>
              escalationGroupIds (JSON)
              <textarea
                value={chatAckTemplateForm.escalationGroupIdsJson}
                onChange={(e) =>
                  setChatAckTemplateForm({
                    ...chatAckTemplateForm,
                    escalationGroupIdsJson: e.target.value,
                  })
                }
                rows={3}
                style={{ width: '100%' }}
                placeholder='["group-id"]'
              />
            </label>
            <label style={{ flex: 1, minWidth: 240 }}>
              escalationRoles (JSON)
              <textarea
                value={chatAckTemplateForm.escalationRolesJson}
                onChange={(e) =>
                  setChatAckTemplateForm({
                    ...chatAckTemplateForm,
                    escalationRolesJson: e.target.value,
                  })
                }
                rows={3}
                style={{ width: '100%' }}
                placeholder='["mgmt"]'
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="button" onClick={submitChatAckTemplate}>
              {editingChatAckTemplateId ? '更新' : '作成'}
            </button>
            <button
              className="button secondary"
              onClick={resetChatAckTemplateForm}
            >
              {editingChatAckTemplateId ? 'キャンセル' : 'クリア'}
            </button>
            <button className="button secondary" onClick={loadChatAckTemplates}>
              再読込
            </button>
          </div>
          <div
            className="list"
            style={{ display: 'grid', gap: 8, marginTop: 8 }}
          >
            {chatAckTemplateItems.length === 0 && (
              <div className="card">テンプレなし</div>
            )}
            {chatAckTemplateItems.map((item) => {
              const requiredLabel =
                [
                  item.requiredUserIds
                    ? `users=${formatJson(item.requiredUserIds)}`
                    : null,
                  item.requiredGroupIds
                    ? `groups=${formatJson(item.requiredGroupIds)}`
                    : null,
                  item.requiredRoles
                    ? `roles=${formatJson(item.requiredRoles)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' / ') || '-';
              const escalationLabel =
                [
                  item.escalationUserIds
                    ? `users=${formatJson(item.escalationUserIds)}`
                    : null,
                  item.escalationGroupIds
                    ? `groups=${formatJson(item.escalationGroupIds)}`
                    : null,
                  item.escalationRoles
                    ? `roles=${formatJson(item.escalationRoles)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' / ') || '-';
              return (
                <div key={item.id} className="card" style={{ padding: 12 }}>
                  <div
                    className="row"
                    style={{
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <strong>
                        {item.flowType} / {item.actionKey}
                      </strong>{' '}
                      / id={item.id}
                    </div>
                    <span className="badge">
                      {(item.isEnabled ?? true) ? 'enabled' : 'disabled'}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: '#475569',
                      marginTop: 4,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    messageBody: {item.messageBody}
                  </div>
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                    required: {requiredLabel}
                  </div>
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                    escalation: {escalationLabel}
                  </div>
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                    dueInHours: {item.dueInHours ?? '-'} / remindIntervalHours:{' '}
                    {item.remindIntervalHours ?? '-'} / escalationAfterHours:{' '}
                    {item.escalationAfterHours ?? '-'}
                  </div>
                  <div
                    className="row"
                    style={{ marginTop: 6, flexWrap: 'wrap' }}
                  >
                    <button
                      className="button secondary"
                      onClick={() => startEditChatAckTemplate(item)}
                    >
                      編集
                    </button>
                  </div>
                </div>
              );
            })}
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
                    disabled={Boolean(item.isDefault)}
                    onClick={() => setTemplateDefault(item.id)}
                  >
                    デフォルト化
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

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
            <button className="button" onClick={submitReportSubscription}>
              {editingReportId ? '更新' : '作成'}
            </button>
            <button className="button secondary" onClick={resetReportForm}>
              {editingReportId ? 'キャンセル' : 'クリア'}
            </button>
            <button
              className="button secondary"
              onClick={loadReportSubscriptions}
            >
              再読込
            </button>
            <button
              className="button secondary"
              onClick={runAllReportSubscriptions}
            >
              一括実行
            </button>
            <button
              className="button secondary"
              onClick={() => showReportDeliveries()}
            >
              配信履歴を表示
            </button>
          </div>
          <div
            className="list"
            style={{ display: 'grid', gap: 8, marginTop: 8 }}
          >
            {reportItems.length === 0 && <div className="card">購読なし</div>}
            {reportItems.map((item) => (
              <div key={item.id} className="card" style={{ padding: 12 }}>
                <div
                  className="row"
                  style={{ justifyContent: 'space-between' }}
                >
                  <div>
                    <strong>{item.reportKey}</strong>
                    {item.name ? ` / ${item.name}` : ''}
                  </div>
                  <span className="badge">
                    {item.isEnabled ? 'enabled' : 'disabled'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                  format: {item.format || '-'} / schedule:{' '}
                  {item.schedule || '-'} / channels:{' '}
                  {(item.channels || []).join(', ') || '-'}
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                  lastRun: {formatDateTime(item.lastRunAt)} / status:{' '}
                  {item.lastRunStatus || '-'}
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <button
                    className="button secondary"
                    onClick={() => startEditReportSubscription(item)}
                  >
                    編集
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => toggleReportSubscription(item)}
                  >
                    {item.isEnabled ? '無効化' : '有効化'}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => runReportSubscription(item.id)}
                    disabled={!item.isEnabled}
                  >
                    実行
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => showReportDeliveries(item.id)}
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
                onClick={() =>
                  showReportDeliveries(reportDeliveryFilterId || undefined)
                }
              >
                表示
              </button>
            </div>
            <div
              className="list"
              style={{ display: 'grid', gap: 8, marginTop: 8 }}
            >
              {reportDeliveries.length === 0 && (
                <div className="card">履歴なし</div>
              )}
              {reportDeliveries.map((delivery) => (
                <div key={delivery.id} className="card" style={{ padding: 12 }}>
                  <div
                    className="row"
                    style={{ justifyContent: 'space-between' }}
                  >
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
            <button className="button" onClick={submitIntegrationSetting}>
              {editingIntegrationId ? '更新' : '作成'}
            </button>
            <button className="button secondary" onClick={resetIntegrationForm}>
              {editingIntegrationId ? 'キャンセル' : 'クリア'}
            </button>
            <button
              className="button secondary"
              onClick={loadIntegrationSettings}
            >
              再読込
            </button>
            <button
              className="button secondary"
              onClick={() =>
                loadIntegrationRuns(integrationRunFilterId.trim() || undefined)
              }
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
                {integrationItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.type}
                    {item.name ? ` / ${item.name}` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            className="list"
            style={{ display: 'grid', gap: 8, marginTop: 8 }}
          >
            {integrationItems.length === 0 && (
              <div className="card">設定なし</div>
            )}
            {integrationItems.map((item) => (
              <div key={item.id} className="card" style={{ padding: 12 }}>
                <div
                  className="row"
                  style={{ justifyContent: 'space-between' }}
                >
                  <div>
                    <strong>{item.type}</strong>
                    {item.name ? ` / ${item.name}` : ''}
                  </div>
                  <span className="badge">{item.status || 'active'}</span>
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                  provider: {item.provider || '-'} / schedule:{' '}
                  {item.schedule || '-'}
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                  lastRun: {formatDateTime(item.lastRunAt)} / status:{' '}
                  {item.lastRunStatus || '-'}
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <button
                    className="button secondary"
                    onClick={() => startEditIntegration(item)}
                  >
                    編集
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => runIntegrationSetting(item.id)}
                    disabled={item.status === 'disabled'}
                  >
                    実行
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div
            className="list"
            style={{ display: 'grid', gap: 8, marginTop: 12 }}
          >
            {integrationRuns.length === 0 && (
              <div className="card">連携履歴なし</div>
            )}
            {integrationRuns.map((run) => (
              <div key={run.id} className="card" style={{ padding: 12 }}>
                <div
                  className="row"
                  style={{ justifyContent: 'space-between' }}
                >
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
      </div>
    </div>
  );
};
