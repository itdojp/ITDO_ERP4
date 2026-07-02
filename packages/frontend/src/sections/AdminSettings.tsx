import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, getAuthState } from '../api';
import {
  createLocalStorageDraftAutosaveAdapter,
  useDraftAutosave,
} from '../ui';
import {
  DEFAULT_ACCOUNTING_MAPPING_RULE_LIMIT,
  DEFAULT_ACCOUNTING_MAPPING_RULE_OFFSET,
  RECONCILIATION_PERIOD_KEY_PATTERN,
  alertChannels,
  alertTypes,
  compareApprovalRulesForSeries,
  createClientIdempotencyKey,
  createDefaultAccountingMappingRuleForm,
  createDefaultAccountingMappingRuleReapplyForm,
  createDefaultActionPolicyForm,
  createDefaultAlertForm,
  createDefaultChatAckTemplateForm,
  createDefaultIntegrationForm,
  createDefaultReportForm,
  createDefaultRuleForm,
  currentPeriodKey,
  flowTypes,
  formatDateTime,
  formatJson,
  getApprovalRuleSeriesKey,
  integrationStatuses,
  integrationTypes,
  isValidHttpUrl,
  parseCsv,
  parseDateTime,
  reportFormats,
  templateKinds,
  type ActionPolicy,
  type ActionPolicyForm,
  type AccountingMappingRuleReapplyForm,
  type AlertFormDraftPayload,
  type AlertSetting,
  type ApprovalRule,
  type AuditLogItem,
  type ChatAckTemplate,
  type IntegrationRun,
  type IntegrationSetting,
  type PdfTemplate,
  type ReportDelivery,
  type ReportSubscription,
  type TemplateSetting,
} from './admin-settings/adminSettingsModel';
import { AlertSettingsCard } from './admin-settings/AlertSettingsCard';
import { AdminSettingsPolicyPanel } from './admin-settings/AdminSettingsPolicyPanel';
import {
  IntegrationSettingsCard,
  type IntegrationRunMetrics,
} from './admin-settings/IntegrationSettingsCard';
import {
  IntegrationReconciliationCard,
  type IntegrationReconciliationDetails,
  type IntegrationReconciliationSummary,
} from './admin-settings/IntegrationReconciliationCard';
import {
  IntegrationExportJobsCard,
  type IntegrationExportJobItem,
} from './admin-settings/IntegrationExportJobsCard';
import {
  AccountingMappingRulesCard,
  type AccountingMappingRuleFormState,
  type AccountingMappingRuleItem,
  type AccountingMappingRuleReapplyResult,
} from './admin-settings/AccountingMappingRulesCard';
import { AuthIdentityMigrationCard } from './admin-settings/AuthIdentityMigrationCard';
import { ReportSubscriptionsCard } from './admin-settings/ReportSubscriptionsCard';
import { TemplateSettingsCard } from './admin-settings/TemplateSettingsCard';
import { ChatSettingsCard } from './ChatSettingsCard';
import { ChatRoomSettingsCard } from './ChatRoomSettingsCard';
import { GroupManagementCard } from './GroupManagementCard';
import { RateCardSettingsCard } from './RateCardSettingsCard';
import { ScimSettingsCard } from './ScimSettingsCard';
import { WorklogSettingsCard } from './WorklogSettingsCard';
import {
  WorkflowMetricGrid,
  WorkflowPageHeader,
  WorkflowPanel,
} from './workflowUx';
import type { WorkflowMetric } from './workflowUx';

const settingsPanelContentStyle: React.CSSProperties = {
  display: 'grid',
  gap: 12,
};

export const AdminSettings: React.FC = () => {
  const hasSystemAdminRole = getAuthState()?.roles?.includes('system_admin');
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
  const [integrationRunMetrics, setIntegrationRunMetrics] =
    useState<IntegrationRunMetrics | null>(null);
  const [integrationRunFilterId, setIntegrationRunFilterId] =
    useState<string>('');
  const [integrationExportJobItems, setIntegrationExportJobItems] = useState<
    IntegrationExportJobItem[]
  >([]);
  const [integrationExportJobKindFilter, setIntegrationExportJobKindFilter] =
    useState<string>('');
  const [
    integrationExportJobStatusFilter,
    setIntegrationExportJobStatusFilter,
  ] = useState<string>('');
  const [integrationExportJobLimit, setIntegrationExportJobLimit] =
    useState<number>(20);
  const [integrationExportJobOffset, setIntegrationExportJobOffset] =
    useState<number>(0);
  const [integrationExportJobLoading, setIntegrationExportJobLoading] =
    useState<boolean>(false);
  const [
    integrationExportJobRedispatchingId,
    setIntegrationExportJobRedispatchingId,
  ] = useState<string | null>(null);
  const [
    integrationReconciliationPeriodKey,
    setIntegrationReconciliationPeriodKey,
  ] = useState<string>(currentPeriodKey);
  const [
    integrationReconciliationSummary,
    setIntegrationReconciliationSummary,
  ] = useState<IntegrationReconciliationSummary | null>(null);
  const [
    integrationReconciliationDetails,
    setIntegrationReconciliationDetails,
  ] = useState<IntegrationReconciliationDetails | null>(null);
  const [
    integrationReconciliationDetailsLoading,
    setIntegrationReconciliationDetailsLoading,
  ] = useState<boolean>(false);
  const [
    integrationReconciliationDetailsError,
    setIntegrationReconciliationDetailsError,
  ] = useState<string | null>(null);
  const integrationReconciliationDetailsRequestId = useRef<number>(0);
  const [accountingMappingRuleItems, setAccountingMappingRuleItems] = useState<
    AccountingMappingRuleItem[]
  >([]);
  const [
    accountingMappingRuleFilterMappingKey,
    setAccountingMappingRuleFilterMappingKey,
  ] = useState<string>('');
  const [
    accountingMappingRuleFilterIsActive,
    setAccountingMappingRuleFilterIsActive,
  ] = useState<string>('');
  const [accountingMappingRuleLimit, setAccountingMappingRuleLimit] =
    useState<number>(DEFAULT_ACCOUNTING_MAPPING_RULE_LIMIT);
  const [accountingMappingRuleOffset, setAccountingMappingRuleOffset] =
    useState<number>(DEFAULT_ACCOUNTING_MAPPING_RULE_OFFSET);
  const [accountingMappingRuleLoading, setAccountingMappingRuleLoading] =
    useState<boolean>(false);
  const [accountingMappingRuleForm, setAccountingMappingRuleForm] = useState(
    createDefaultAccountingMappingRuleForm,
  );
  const [editingAccountingMappingRuleId, setEditingAccountingMappingRuleId] =
    useState<string | null>(null);
  const [
    accountingMappingRuleReapplyForm,
    setAccountingMappingRuleReapplyForm,
  ] = useState<AccountingMappingRuleReapplyForm>(
    createDefaultAccountingMappingRuleReapplyForm,
  );
  const [accountingMappingRuleReapplying, setAccountingMappingRuleReapplying] =
    useState(false);
  const [
    accountingMappingRuleReapplyResult,
    setAccountingMappingRuleReapplyResult,
  ] = useState<AccountingMappingRuleReapplyResult | null>(null);
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
  const approvalRuleSeries = useMemo(() => {
    const latestBySeries = new Map<string, ApprovalRule>();
    const countsBySeries = new Map<string, number>();
    const seriesCountByFlowType = new Map<string, number>();
    for (const rule of ruleItems) {
      const seriesKey = getApprovalRuleSeriesKey(rule);
      if (!countsBySeries.has(seriesKey)) {
        seriesCountByFlowType.set(
          rule.flowType,
          (seriesCountByFlowType.get(rule.flowType) ?? 0) + 1,
        );
      }
      countsBySeries.set(seriesKey, (countsBySeries.get(seriesKey) ?? 0) + 1);
      const currentLatest = latestBySeries.get(seriesKey);
      if (!currentLatest) {
        latestBySeries.set(seriesKey, rule);
        continue;
      }
      const compareResult = compareApprovalRulesForSeries(currentLatest, rule);
      if (compareResult > 0) {
        latestBySeries.set(seriesKey, rule);
        continue;
      }
    }
    const latestRuleIds = new Set(
      Array.from(latestBySeries.values()).map((rule) => rule.id),
    );
    const sortedRuleItems = [...ruleItems].sort((left, right) => {
      if (left.flowType !== right.flowType) {
        return left.flowType.localeCompare(right.flowType);
      }
      const leftRuleKey = left.ruleKey || left.id;
      const rightRuleKey = right.ruleKey || right.id;
      if (leftRuleKey !== rightRuleKey) {
        return leftRuleKey.localeCompare(rightRuleKey);
      }
      const seriesCompare = compareApprovalRulesForSeries(left, right);
      if (seriesCompare !== 0) return seriesCompare;
      const updatedDiff =
        (parseDateTime(right.updatedAt)?.getTime() ?? 0) -
        (parseDateTime(left.updatedAt)?.getTime() ?? 0);
      if (updatedDiff !== 0) return updatedDiff;
      return right.id.localeCompare(left.id);
    });
    return {
      countsBySeries,
      latestRuleIds,
      seriesCountByFlowType,
      sortedRuleItems,
    };
  }, [ruleItems]);
  const editingRule = useMemo(
    () => ruleItems.find((item) => item.id === editingRuleId) ?? null,
    [editingRuleId, ruleItems],
  );
  const approvalRuleMonitoring = useMemo(() => {
    const now = new Date();
    const compareByDateDesc = (
      left: ApprovalRule,
      right: ApprovalRule,
      field: keyof ApprovalRule,
    ) => {
      const a = parseDateTime(left[field] as string | null);
      const b = parseDateTime(right[field] as string | null);
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
      const effectiveFrom = parseDateTime(rule.effectiveFrom ?? null);
      const effectiveTo = parseDateTime(rule.effectiveTo ?? null);
      if (effectiveTo && effectiveTo.getTime() <= now.getTime()) {
        groups[flowType].inactive.push(rule);
      } else if (!isActive) {
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
    async (rule: ApprovalRule) => {
      const seriesKey = getApprovalRuleSeriesKey(rule);
      const seriesRules = ruleItems.filter(
        (item) => getApprovalRuleSeriesKey(item) === seriesKey,
      );
      try {
        setApprovalRuleAuditLoading((prev) => ({ ...prev, [seriesKey]: true }));
        const responses = await Promise.all(
          seriesRules.map(async (seriesRule) => {
            const query = new URLSearchParams();
            query.set('targetTable', 'approval_rules');
            query.set('targetId', seriesRule.id);
            query.set('limit', '50');
            query.set('format', 'json');
            const res = await api<{ items: AuditLogItem[] }>(
              `/audit-logs?${query.toString()}`,
            );
            return res.items || [];
          }),
        );
        const mergedLogs = Array.from(
          new Map(
            responses
              .flat()
              .sort((left, right) => {
                const leftTime = parseDateTime(left.createdAt)?.getTime() ?? 0;
                const rightTime =
                  parseDateTime(right.createdAt)?.getTime() ?? 0;
                return rightTime - leftTime;
              })
              .map((item) => [item.id, item]),
          ).values(),
        );
        setApprovalRuleAuditLogs((prev) => ({
          ...prev,
          [seriesKey]: mergedLogs,
        }));
      } catch (err) {
        logError('loadApprovalRuleAuditLogs failed', err);
        setApprovalRuleAuditLogs((prev) => ({ ...prev, [seriesKey]: [] }));
        setMessage('承認ルールの履歴取得に失敗しました');
      } finally {
        setApprovalRuleAuditLoading((prev) => ({
          ...prev,
          [seriesKey]: false,
        }));
      }
    },
    [logError, ruleItems, setMessage],
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
      const runQuery = new URLSearchParams();
      if (settingId) {
        runQuery.set('settingId', settingId);
      }
      runQuery.set('limit', '50');
      const runSuffix = runQuery.toString();
      const metricsQuery = new URLSearchParams();
      if (settingId) {
        metricsQuery.set('settingId', settingId);
      }
      metricsQuery.set('days', '30');
      const metricsSuffix = metricsQuery.toString();
      const [runsResult, metricsResult] = await Promise.allSettled([
        api<{ items: IntegrationRun[] }>(
          `/integration-runs${runSuffix ? `?${runSuffix}` : ''}`,
        ),
        api<IntegrationRunMetrics>(
          `/integration-runs/metrics${metricsSuffix ? `?${metricsSuffix}` : ''}`,
        ),
      ]);

      if (runsResult.status === 'fulfilled') {
        setIntegrationRuns(runsResult.value.items || []);
      } else {
        logError('loadIntegrationRuns failed', runsResult.reason);
        setIntegrationRuns([]);
      }

      if (metricsResult.status === 'fulfilled') {
        setIntegrationRunMetrics(metricsResult.value || null);
      } else {
        logError('loadIntegrationRunMetrics failed', metricsResult.reason);
        setIntegrationRunMetrics(null);
      }
    },
    [logError],
  );

  const loadIntegrationExportJobs = useCallback(
    async (options?: { suppressSuccessMessage?: boolean }) => {
      const query = new URLSearchParams();
      if (integrationExportJobKindFilter.trim()) {
        query.set('kind', integrationExportJobKindFilter.trim());
      }
      if (integrationExportJobStatusFilter.trim()) {
        query.set('status', integrationExportJobStatusFilter.trim());
      }
      query.set('limit', String(integrationExportJobLimit));
      query.set('offset', String(integrationExportJobOffset));
      setIntegrationExportJobLoading(true);
      try {
        const result = await api<{ items: IntegrationExportJobItem[] }>(
          `/integrations/jobs/exports?${query.toString()}`,
        );
        setIntegrationExportJobItems(result.items || []);
        if (!options?.suppressSuccessMessage) {
          setMessage('連携ジョブ一覧を取得しました');
        }
      } catch (err) {
        logError('loadIntegrationExportJobs failed', err);
        setIntegrationExportJobItems([]);
        setMessage('連携ジョブ一覧の取得に失敗しました');
      } finally {
        setIntegrationExportJobLoading(false);
      }
    },
    [
      integrationExportJobKindFilter,
      integrationExportJobLimit,
      integrationExportJobOffset,
      integrationExportJobStatusFilter,
      logError,
    ],
  );

  const redispatchIntegrationExportJob = useCallback(
    async (item: IntegrationExportJobItem) => {
      const idempotencyKey = createClientIdempotencyKey(
        `ui-redispatch-${item.kind}`,
      );
      setIntegrationExportJobRedispatchingId(item.id);
      try {
        await api(
          `/integrations/jobs/exports/${item.kind}/${item.id}/redispatch`,
          {
            method: 'POST',
            body: JSON.stringify({ idempotencyKey }),
          },
        );
        await loadIntegrationExportJobs({ suppressSuccessMessage: true });
        setMessage('連携ジョブを再出力しました');
      } catch (err) {
        logError('redispatchIntegrationExportJob failed', err);
        setMessage('連携ジョブの再出力に失敗しました');
      } finally {
        setIntegrationExportJobRedispatchingId((current) =>
          current === item.id ? null : current,
        );
      }
    },
    [loadIntegrationExportJobs, logError],
  );

  const updateIntegrationReconciliationPeriodKey = useCallback(
    (value: string) => {
      integrationReconciliationDetailsRequestId.current += 1;
      setIntegrationReconciliationPeriodKey(value);
      setIntegrationReconciliationSummary(null);
      setIntegrationReconciliationDetails(null);
      setIntegrationReconciliationDetailsLoading(false);
      setIntegrationReconciliationDetailsError(null);
    },
    [],
  );

  const loadIntegrationReconciliationSummary = useCallback(async () => {
    const periodKey = integrationReconciliationPeriodKey.trim();
    if (!RECONCILIATION_PERIOD_KEY_PATTERN.test(periodKey)) {
      integrationReconciliationDetailsRequestId.current += 1;
      setIntegrationReconciliationSummary(null);
      setIntegrationReconciliationDetails(null);
      setIntegrationReconciliationDetailsLoading(false);
      setIntegrationReconciliationDetailsError(null);
      setMessage('照合対象月は YYYY-MM 形式で入力してください');
      return;
    }
    try {
      const summary = await api<IntegrationReconciliationSummary>(
        `/integrations/reconciliation/summary?periodKey=${encodeURIComponent(periodKey)}`,
      );
      integrationReconciliationDetailsRequestId.current += 1;
      setIntegrationReconciliationSummary(summary);
      setIntegrationReconciliationDetails(null);
      setIntegrationReconciliationDetailsLoading(false);
      setIntegrationReconciliationDetailsError(null);
      setMessage('連携照合サマリを取得しました');
    } catch (err) {
      logError('loadIntegrationReconciliationSummary failed', err);
      integrationReconciliationDetailsRequestId.current += 1;
      setIntegrationReconciliationSummary(null);
      setIntegrationReconciliationDetails(null);
      setIntegrationReconciliationDetailsLoading(false);
      setIntegrationReconciliationDetailsError(null);
      setMessage('連携照合サマリの取得に失敗しました');
    }
  }, [integrationReconciliationPeriodKey, logError]);

  const loadIntegrationReconciliationDetails = useCallback(async () => {
    const periodKey = integrationReconciliationPeriodKey.trim();
    if (!RECONCILIATION_PERIOD_KEY_PATTERN.test(periodKey)) {
      setIntegrationReconciliationDetails(null);
      setIntegrationReconciliationDetailsError(
        '照合対象月は YYYY-MM 形式で入力してください',
      );
      setMessage('照合対象月は YYYY-MM 形式で入力してください');
      return;
    }
    const requestId = integrationReconciliationDetailsRequestId.current + 1;
    integrationReconciliationDetailsRequestId.current = requestId;
    setIntegrationReconciliationDetailsLoading(true);
    setIntegrationReconciliationDetailsError(null);
    try {
      const details = await api<IntegrationReconciliationDetails>(
        `/integrations/reconciliation/details?periodKey=${encodeURIComponent(periodKey)}`,
      );
      if (integrationReconciliationDetailsRequestId.current !== requestId) {
        return;
      }
      if (details.periodKey !== periodKey) {
        setIntegrationReconciliationDetails(null);
        setIntegrationReconciliationDetailsError(
          '連携照合詳細の対象月がリクエストと一致しません',
        );
        setMessage('連携照合詳細の対象月がリクエストと一致しません');
        return;
      }
      setIntegrationReconciliationDetails(details);
      setMessage('連携照合詳細を取得しました');
    } catch (err) {
      if (integrationReconciliationDetailsRequestId.current !== requestId) {
        return;
      }
      logError('loadIntegrationReconciliationDetails failed', err);
      setIntegrationReconciliationDetails(null);
      setIntegrationReconciliationDetailsError(
        '連携照合詳細の取得に失敗しました',
      );
      setMessage('連携照合詳細の取得に失敗しました');
    } finally {
      if (integrationReconciliationDetailsRequestId.current === requestId) {
        setIntegrationReconciliationDetailsLoading(false);
      }
    }
  }, [integrationReconciliationPeriodKey, logError]);

  const loadAccountingMappingRulesWithQuery = useCallback(
    async (options: {
      mappingKey: string;
      isActive: string;
      limit: number;
      offset: number;
      suppressMessage?: boolean;
    }) => {
      const query = new URLSearchParams();
      const mappingKey = options.mappingKey.trim();
      const isActive = options.isActive.trim();
      if (mappingKey) {
        query.set('mappingKey', mappingKey);
      }
      if (isActive) {
        query.set('isActive', isActive);
      }
      query.set('limit', String(options.limit));
      query.set('offset', String(options.offset));
      setAccountingMappingRuleLoading(true);
      try {
        const result = await api<{ items: AccountingMappingRuleItem[] }>(
          `/integrations/accounting/mapping-rules?${query.toString()}`,
        );
        setAccountingMappingRuleItems(result.items || []);
        if (!options.suppressMessage) {
          setMessage('会計マッピングルールを取得しました');
        }
      } catch (err) {
        logError('loadAccountingMappingRules failed', err);
        setAccountingMappingRuleItems([]);
        if (!options.suppressMessage) {
          setMessage('会計マッピングルールの取得に失敗しました');
        }
      } finally {
        setAccountingMappingRuleLoading(false);
      }
    },
    [logError],
  );

  const loadAccountingMappingRules = useCallback(async () => {
    await loadAccountingMappingRulesWithQuery({
      mappingKey: accountingMappingRuleFilterMappingKey,
      isActive: accountingMappingRuleFilterIsActive,
      limit: accountingMappingRuleLimit,
      offset: accountingMappingRuleOffset,
    });
  }, [
    accountingMappingRuleFilterIsActive,
    accountingMappingRuleFilterMappingKey,
    accountingMappingRuleLimit,
    accountingMappingRuleOffset,
    loadAccountingMappingRulesWithQuery,
  ]);

  const normalizeNullableMappingField = useCallback(
    (value: string) => value.trim() || null,
    [],
  );

  const resetAccountingMappingRuleForm = useCallback(() => {
    setAccountingMappingRuleForm(createDefaultAccountingMappingRuleForm());
    setEditingAccountingMappingRuleId(null);
  }, []);

  const submitAccountingMappingRule = useCallback(async () => {
    const payload = {
      mappingKey: accountingMappingRuleForm.mappingKey.trim(),
      debitAccountCode: accountingMappingRuleForm.debitAccountCode.trim(),
      debitAccountName: normalizeNullableMappingField(
        accountingMappingRuleForm.debitAccountName,
      ),
      debitSubaccountCode: normalizeNullableMappingField(
        accountingMappingRuleForm.debitSubaccountCode,
      ),
      requireDebitSubaccountCode:
        accountingMappingRuleForm.requireDebitSubaccountCode,
      creditAccountCode: accountingMappingRuleForm.creditAccountCode.trim(),
      creditAccountName: normalizeNullableMappingField(
        accountingMappingRuleForm.creditAccountName,
      ),
      creditSubaccountCode: normalizeNullableMappingField(
        accountingMappingRuleForm.creditSubaccountCode,
      ),
      requireCreditSubaccountCode:
        accountingMappingRuleForm.requireCreditSubaccountCode,
      departmentCode: normalizeNullableMappingField(
        accountingMappingRuleForm.departmentCode,
      ),
      requireDepartmentCode: accountingMappingRuleForm.requireDepartmentCode,
      taxCode: accountingMappingRuleForm.taxCode.trim(),
      isActive: accountingMappingRuleForm.isActive,
    };
    if (
      !payload.mappingKey ||
      !payload.debitAccountCode ||
      !payload.creditAccountCode ||
      !payload.taxCode
    ) {
      setMessage(
        'mappingKey / debitAccountCode / creditAccountCode / taxCode を入力してください',
      );
      return;
    }
    if (payload.requireDebitSubaccountCode && !payload.debitSubaccountCode) {
      setMessage('借方枝番必須を有効にする場合は借方枝番を入力してください');
      return;
    }
    if (payload.requireCreditSubaccountCode && !payload.creditSubaccountCode) {
      setMessage('貸方枝番必須を有効にする場合は貸方枝番を入力してください');
      return;
    }
    if (payload.requireDepartmentCode && !payload.departmentCode) {
      setMessage(
        '部門コード必須を有効にする場合は部門コードを入力してください',
      );
      return;
    }
    try {
      if (editingAccountingMappingRuleId) {
        await api(
          `/integrations/accounting/mapping-rules/${editingAccountingMappingRuleId}`,
          {
            method: 'PATCH',
            body: JSON.stringify(payload),
          },
        );
        setMessage('会計マッピングルールを更新しました');
      } else {
        await api('/integrations/accounting/mapping-rules', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage('会計マッピングルールを作成しました');
      }
      await loadAccountingMappingRules();
      resetAccountingMappingRuleForm();
    } catch (err) {
      logError('submitAccountingMappingRule failed', err);
      setMessage('会計マッピングルールの保存に失敗しました');
    }
  }, [
    accountingMappingRuleForm,
    editingAccountingMappingRuleId,
    loadAccountingMappingRules,
    logError,
    normalizeNullableMappingField,
    resetAccountingMappingRuleForm,
  ]);

  const startEditAccountingMappingRule = useCallback(
    (item: AccountingMappingRuleItem) => {
      setEditingAccountingMappingRuleId(item.id);
      setAccountingMappingRuleForm({
        mappingKey: item.mappingKey,
        debitAccountCode: item.debitAccountCode,
        debitAccountName: item.debitAccountName || '',
        debitSubaccountCode: item.debitSubaccountCode || '',
        requireDebitSubaccountCode: Boolean(item.requireDebitSubaccountCode),
        creditAccountCode: item.creditAccountCode,
        creditAccountName: item.creditAccountName || '',
        creditSubaccountCode: item.creditSubaccountCode || '',
        requireCreditSubaccountCode: Boolean(item.requireCreditSubaccountCode),
        departmentCode: item.departmentCode || '',
        requireDepartmentCode: Boolean(item.requireDepartmentCode),
        taxCode: item.taxCode,
        isActive: item.isActive,
      });
    },
    [],
  );

  const reapplyAccountingMappingRules = useCallback(async () => {
    const periodKey = accountingMappingRuleReapplyForm.periodKey.trim();
    if (periodKey && !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) {
      setMessage('periodKey は YYYY-MM 形式で入力してください');
      return;
    }
    setAccountingMappingRuleReapplying(true);
    try {
      const result = await api<AccountingMappingRuleReapplyResult>(
        '/integrations/accounting/mapping-rules/reapply',
        {
          method: 'POST',
          body: JSON.stringify({
            periodKey: periodKey || undefined,
            mappingKey:
              accountingMappingRuleReapplyForm.mappingKey.trim() || undefined,
            limit: accountingMappingRuleReapplyForm.limit,
            offset: accountingMappingRuleReapplyForm.offset,
          }),
        },
      );
      setAccountingMappingRuleReapplyResult(result);
      setMessage('会計マッピングルールを再適用しました');
    } catch (err) {
      logError('reapplyAccountingMappingRules failed', err);
      setAccountingMappingRuleReapplyResult(null);
      setMessage('会計マッピングルールの再適用に失敗しました');
    } finally {
      setAccountingMappingRuleReapplying(false);
    }
  }, [accountingMappingRuleReapplyForm, logError]);

  useEffect(() => {
    loadAlertSettings();
    loadApprovalRules();
    loadActionPolicies();
    loadChatAckTemplates();
    loadTemplateSettings();
    loadPdfTemplates();
    loadIntegrationSettings();
    loadReportSubscriptions();
    loadAccountingMappingRulesWithQuery({
      mappingKey: '',
      isActive: '',
      limit: DEFAULT_ACCOUNTING_MAPPING_RULE_LIMIT,
      offset: DEFAULT_ACCOUNTING_MAPPING_RULE_OFFSET,
      suppressMessage: true,
    });
  }, [
    loadAlertSettings,
    loadApprovalRules,
    loadActionPolicies,
    loadChatAckTemplates,
    loadTemplateSettings,
    loadPdfTemplates,
    loadIntegrationSettings,
    loadReportSubscriptions,
    loadAccountingMappingRulesWithQuery,
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
    const editableEffectiveFrom = parseDateTime(item.effectiveFrom);
    setEditingRuleId(item.id);
    setRuleForm({
      flowType: item.flowType,
      isActive: item.isActive ?? true,
      effectiveFrom:
        editableEffectiveFrom && editableEffectiveFrom.getTime() > Date.now()
          ? (item.effectiveFrom ?? '')
          : '',
      conditionsJson: item.conditions
        ? JSON.stringify(item.conditions, null, 2)
        : '',
      stepsJson: item.steps ? JSON.stringify(item.steps, null, 2) : '[]',
    });
  };

  const submitApprovalRule = async () => {
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
        setMessage(
          '承認ルールの新版を作成しました。旧版は履歴として保持されます',
        );
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
        const errorMessage =
          err instanceof Error ? err.message : String(err ?? '');
        if (errorMessage.includes('stale_rule_version')) {
          setMessage(
            '最新版が更新されたため新版作成に失敗しました。再読込してください',
          );
        } else {
          setMessage('新版作成に失敗しました。新規作成モードに戻しました');
        }
        resetRuleForm();
        return;
      }
      setMessage('保存に失敗しました');
    }
  };

  const settingsMetrics = useMemo<WorkflowMetric[]>(
    () => [
      {
        id: 'categories',
        label: '設定カテゴリ',
        value: '6分類',
        helper: '組織・労務・権限・帳票・連携・認証を分割表示',
      },
      {
        id: 'policy',
        label: '承認・権限',
        value: `${
          ruleItems.length +
          actionPolicyItems.length +
          chatAckTemplateItems.length
        }件`,
        helper: `承認ルール ${ruleItems.length} / ActionPolicy ${actionPolicyItems.length} / ack ${chatAckTemplateItems.length}`,
        tone:
          ruleItems.length +
            actionPolicyItems.length +
            chatAckTemplateItems.length >
          0
            ? 'success'
            : 'default',
      },
      {
        id: 'delivery',
        label: '通知・配信',
        value: `${alertItems.length + reportItems.length}件`,
        helper: `アラート ${alertItems.length} / レポート購読 ${reportItems.length}`,
        tone:
          alertItems.length + reportItems.length > 0 ? 'success' : 'default',
      },
      {
        id: 'integration',
        label: '連携・会計',
        value: `${
          integrationItems.length +
          integrationExportJobItems.length +
          accountingMappingRuleItems.length
        }件`,
        helper: `連携 ${integrationItems.length} / ジョブ ${integrationExportJobItems.length} / 会計ルール ${accountingMappingRuleItems.length}`,
        tone:
          integrationItems.length +
            integrationExportJobItems.length +
            accountingMappingRuleItems.length >
          0
            ? 'success'
            : 'default',
      },
      {
        id: 'system-admin',
        label: '認証移行権限',
        value: hasSystemAdminRole ? '操作可' : '閲覧のみ',
        helper: hasSystemAdminRole
          ? 'system_admin として認証方式移行を操作可能'
          : 'system_admin ロールがないため操作不可',
        tone: hasSystemAdminRole ? 'success' : 'warning',
      },
    ],
    [
      accountingMappingRuleItems.length,
      actionPolicyItems.length,
      alertItems.length,
      chatAckTemplateItems.length,
      hasSystemAdminRole,
      integrationExportJobItems.length,
      integrationItems.length,
      reportItems.length,
      ruleItems.length,
    ],
  );

  return (
    <div>
      <WorkflowPageHeader
        title="Settings"
        description="組織、権限、通知、帳票、外部連携、認証移行の設定をカテゴリ別に整理し、管理者が影響範囲と操作権限を確認してから設定変更できるようにします。"
      />
      <WorkflowMetricGrid
        ariaLabel="設定管理サマリー"
        items={settingsMetrics}
      />
      {message && <p>{message}</p>}
      <div className="list" style={{ display: 'grid', gap: 12 }}>
        <WorkflowPanel
          title="コミュニケーション・組織"
          description="チャット、ルーム、グループ、SCIM の設定をまとめて確認します。"
        >
          <div style={settingsPanelContentStyle}>
            <ChatSettingsCard />
            <ChatRoomSettingsCard />
            <GroupManagementCard />
            <ScimSettingsCard />
          </div>
        </WorkflowPanel>

        <WorkflowPanel
          title="労務・単価・通知"
          description="単価、勤怠/工数、アラート通知の運用設定を管理します。"
        >
          <div style={settingsPanelContentStyle}>
            <RateCardSettingsCard />
            <WorklogSettingsCard />
            <AlertSettingsCard
              wizard={{
                steps: alertWizardSteps,
                value: alertWizardStep,
                onValueChange: setAlertWizardStep,
                canSubmit: canSubmitAlertForm,
                isDirty: alertDraft.isDirty,
                autosave: {
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
                },
                labels: {
                  back: '戻る',
                  next: '次へ',
                  submit: editingAlertId ? '更新' : '作成',
                  cancel: editingAlertId ? 'キャンセル' : 'クリア',
                  optional: '任意',
                  autosavePrefix: '下書き',
                },
                onSubmit: submitAlertSetting,
                onCancel: () => {
                  resetAlertForm();
                  void alertDraft.clearDraft();
                },
              }}
              onReload={loadAlertSettings}
              items={alertItems}
              onToggle={toggleAlert}
              onEdit={startEditAlert}
            />
          </div>
        </WorkflowPanel>

        <AdminSettingsPolicyPanel
          settingsPanelContentStyle={settingsPanelContentStyle}
          approvalRuleMonitoring={approvalRuleMonitoring}
          approvalRuleSeries={approvalRuleSeries}
          editingRule={editingRule}
          editingRuleId={editingRuleId}
          ruleForm={ruleForm}
          setRuleForm={setRuleForm}
          submitApprovalRule={submitApprovalRule}
          resetRuleForm={resetRuleForm}
          loadApprovalRules={loadApprovalRules}
          ruleItems={ruleItems}
          toggleApprovalRuleActive={toggleApprovalRuleActive}
          startEditRule={startEditRule}
          approvalRuleAuditOpen={approvalRuleAuditOpen}
          approvalRuleAuditLoading={approvalRuleAuditLoading}
          approvalRuleAuditLogs={approvalRuleAuditLogs}
          approvalRuleAuditSelected={approvalRuleAuditSelected}
          setApprovalRuleAuditOpen={setApprovalRuleAuditOpen}
          setApprovalRuleAuditSelected={setApprovalRuleAuditSelected}
          loadApprovalRuleAuditLogs={loadApprovalRuleAuditLogs}
          actionPolicyForm={actionPolicyForm}
          setActionPolicyForm={setActionPolicyForm}
          submitActionPolicy={submitActionPolicy}
          resetActionPolicyForm={resetActionPolicyForm}
          editingActionPolicyId={editingActionPolicyId}
          loadActionPolicies={loadActionPolicies}
          actionPolicyItems={actionPolicyItems}
          actionPolicyAuditOpen={actionPolicyAuditOpen}
          actionPolicyAuditLoading={actionPolicyAuditLoading}
          actionPolicyAuditLogs={actionPolicyAuditLogs}
          actionPolicyAuditSelected={actionPolicyAuditSelected}
          setActionPolicyAuditOpen={setActionPolicyAuditOpen}
          setActionPolicyAuditSelected={setActionPolicyAuditSelected}
          loadActionPolicyAuditLogs={loadActionPolicyAuditLogs}
          startEditActionPolicy={startEditActionPolicy}
          chatAckTemplateForm={chatAckTemplateForm}
          setChatAckTemplateForm={setChatAckTemplateForm}
          submitChatAckTemplate={submitChatAckTemplate}
          resetChatAckTemplateForm={resetChatAckTemplateForm}
          editingChatAckTemplateId={editingChatAckTemplateId}
          chatAckTemplateItems={chatAckTemplateItems}
          loadChatAckTemplates={loadChatAckTemplates}
          startEditChatAckTemplate={startEditChatAckTemplate}
        />

        <WorkflowPanel
          title="帳票・配信"
          description="テンプレート設定とレポート購読をまとめて確認します。"
        >
          <div style={settingsPanelContentStyle}>
            <TemplateSettingsCard
              templateForm={templateForm}
              setTemplateForm={setTemplateForm}
              templateKinds={templateKinds}
              templatesForKind={templatesForKind}
              editingTemplateId={editingTemplateId}
              onSubmit={submitTemplateSetting}
              onReset={resetTemplateForm}
              onReload={loadTemplateSettings}
              items={templateItems}
              templateNameMap={templateNameMap}
              onEdit={startEditTemplate}
              onSetDefault={setTemplateDefault}
            />

            <ReportSubscriptionsCard
              reportForm={reportForm}
              setReportForm={setReportForm}
              reportFormats={reportFormats}
              reportDryRun={reportDryRun}
              setReportDryRun={setReportDryRun}
              editingReportId={editingReportId}
              onSubmit={submitReportSubscription}
              onReset={resetReportForm}
              onReload={loadReportSubscriptions}
              onRunAll={runAllReportSubscriptions}
              onShowDeliveries={showReportDeliveries}
              items={reportItems}
              onEdit={startEditReportSubscription}
              onToggle={toggleReportSubscription}
              onRun={runReportSubscription}
              reportDeliveryFilterId={reportDeliveryFilterId}
              setReportDeliveryFilterId={setReportDeliveryFilterId}
              deliveries={reportDeliveries}
              formatDateTime={formatDateTime}
            />
          </div>
        </WorkflowPanel>

        <WorkflowPanel
          title="外部連携・会計連携"
          description="HR/CRM連携、照合、会計マッピング、連携ジョブを確認します。"
        >
          <div style={settingsPanelContentStyle}>
            <IntegrationSettingsCard
              integrationForm={integrationForm}
              setIntegrationForm={setIntegrationForm}
              integrationTypes={integrationTypes}
              integrationStatuses={integrationStatuses}
              editingIntegrationId={editingIntegrationId}
              onSubmit={submitIntegrationSetting}
              onReset={resetIntegrationForm}
              onReload={loadIntegrationSettings}
              onShowRuns={loadIntegrationRuns}
              integrationRunFilterId={integrationRunFilterId}
              setIntegrationRunFilterId={setIntegrationRunFilterId}
              items={integrationItems}
              onEdit={startEditIntegration}
              onRun={runIntegrationSetting}
              runs={integrationRuns}
              metrics={integrationRunMetrics}
              formatDateTime={formatDateTime}
            />

            <IntegrationReconciliationCard
              periodKey={integrationReconciliationPeriodKey}
              setPeriodKey={updateIntegrationReconciliationPeriodKey}
              summary={integrationReconciliationSummary}
              details={integrationReconciliationDetails}
              detailsLoading={integrationReconciliationDetailsLoading}
              detailsError={integrationReconciliationDetailsError}
              onLoad={loadIntegrationReconciliationSummary}
              onLoadDetails={loadIntegrationReconciliationDetails}
              formatDateTime={formatDateTime}
            />

            <AccountingMappingRulesCard
              mappingKeyFilter={accountingMappingRuleFilterMappingKey}
              setMappingKeyFilter={setAccountingMappingRuleFilterMappingKey}
              isActiveFilter={accountingMappingRuleFilterIsActive}
              setIsActiveFilter={setAccountingMappingRuleFilterIsActive}
              limit={accountingMappingRuleLimit}
              setLimit={setAccountingMappingRuleLimit}
              offset={accountingMappingRuleOffset}
              setOffset={setAccountingMappingRuleOffset}
              loading={accountingMappingRuleLoading}
              items={accountingMappingRuleItems}
              form={accountingMappingRuleForm}
              setForm={setAccountingMappingRuleForm}
              editingId={editingAccountingMappingRuleId}
              onSubmit={submitAccountingMappingRule}
              onReset={resetAccountingMappingRuleForm}
              onLoad={loadAccountingMappingRules}
              onEdit={startEditAccountingMappingRule}
              reapplyPeriodKey={accountingMappingRuleReapplyForm.periodKey}
              setReapplyPeriodKey={(value) =>
                setAccountingMappingRuleReapplyForm((current) => ({
                  ...current,
                  periodKey:
                    typeof value === 'function'
                      ? value(current.periodKey)
                      : value,
                }))
              }
              reapplyMappingKey={accountingMappingRuleReapplyForm.mappingKey}
              setReapplyMappingKey={(value) =>
                setAccountingMappingRuleReapplyForm((current) => ({
                  ...current,
                  mappingKey:
                    typeof value === 'function'
                      ? value(current.mappingKey)
                      : value,
                }))
              }
              reapplyLimit={accountingMappingRuleReapplyForm.limit}
              setReapplyLimit={(value) =>
                setAccountingMappingRuleReapplyForm((current) => ({
                  ...current,
                  limit:
                    typeof value === 'function' ? value(current.limit) : value,
                }))
              }
              reapplyOffset={accountingMappingRuleReapplyForm.offset}
              setReapplyOffset={(value) =>
                setAccountingMappingRuleReapplyForm((current) => ({
                  ...current,
                  offset:
                    typeof value === 'function' ? value(current.offset) : value,
                }))
              }
              reapplying={accountingMappingRuleReapplying}
              onReapply={reapplyAccountingMappingRules}
              reapplyResult={accountingMappingRuleReapplyResult}
              formatDateTime={formatDateTime}
            />

            <IntegrationExportJobsCard
              kindFilter={integrationExportJobKindFilter}
              setKindFilter={setIntegrationExportJobKindFilter}
              statusFilter={integrationExportJobStatusFilter}
              setStatusFilter={setIntegrationExportJobStatusFilter}
              limit={integrationExportJobLimit}
              setLimit={setIntegrationExportJobLimit}
              offset={integrationExportJobOffset}
              setOffset={setIntegrationExportJobOffset}
              items={integrationExportJobItems}
              loading={integrationExportJobLoading}
              redispatchingId={integrationExportJobRedispatchingId}
              onLoad={loadIntegrationExportJobs}
              onRedispatch={redispatchIntegrationExportJob}
              formatDateTime={formatDateTime}
            />
          </div>
        </WorkflowPanel>

        <WorkflowPanel
          title="認証方式移行"
          description="system_admin のみが実行できる認証方式移行の操作状態を確認します。"
        >
          <div style={settingsPanelContentStyle}>
            {hasSystemAdminRole ? (
              <AuthIdentityMigrationCard formatDateTime={formatDateTime} />
            ) : (
              <div className="card" style={{ padding: 12 }}>
                <strong>認証方式移行</strong>
                <p style={{ marginTop: 8 }}>
                  この設定は system_admin
                  ロールを持つユーザーのみが操作できます。
                </p>
              </div>
            )}
          </div>
        </WorkflowPanel>
      </div>
    </div>
  );
};
