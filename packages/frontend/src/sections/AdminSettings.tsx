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
  alertChannels,
  alertTypes,
  createDefaultAlertForm,
  formatDateTime,
  integrationStatuses,
  integrationTypes,
  isValidHttpUrl,
  parseCsv,
  reportFormats,
  templateKinds,
  type AlertFormDraftPayload,
  type AlertSetting,
} from './admin-settings/adminSettingsModel';
import { AlertSettingsCard } from './admin-settings/AlertSettingsCard';
import { AdminSettingsPolicyPanel } from './admin-settings/AdminSettingsPolicyPanel';
import { IntegrationSettingsCard } from './admin-settings/IntegrationSettingsCard';
import { IntegrationReconciliationCard } from './admin-settings/IntegrationReconciliationCard';
import { IntegrationExportJobsCard } from './admin-settings/IntegrationExportJobsCard';
import { AccountingMappingRulesCard } from './admin-settings/AccountingMappingRulesCard';
import { AuthIdentityMigrationCard } from './admin-settings/AuthIdentityMigrationCard';
import { ReportSubscriptionsCard } from './admin-settings/ReportSubscriptionsCard';
import { TemplateSettingsCard } from './admin-settings/TemplateSettingsCard';
import { useAdminSettingsAccountingMappingRules } from './admin-settings/useAdminSettingsAccountingMappingRules';
import { useAdminSettingsIntegrationExportJobs } from './admin-settings/useAdminSettingsIntegrationExportJobs';
import { useAdminSettingsIntegrations } from './admin-settings/useAdminSettingsIntegrations';
import { useAdminSettingsPolicyResources } from './admin-settings/useAdminSettingsPolicyResources';
import { useAdminSettingsReconciliation } from './admin-settings/useAdminSettingsReconciliation';
import { useAdminSettingsReports } from './admin-settings/useAdminSettingsReports';
import { useAdminSettingsTemplates } from './admin-settings/useAdminSettingsTemplates';
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
  const [message, setMessage] = useState('');
  const logError = useCallback((label: string, err: unknown) => {
    console.error(`[AdminSettings] ${label}`, err);
  }, []);

  const [alertItems, setAlertItems] = useState<AlertSetting[]>([]);
  const [alertForm, setAlertForm] = useState(createDefaultAlertForm);
  const [alertWizardStep, setAlertWizardStep] = useState('basic');
  const [editingAlertId, setEditingAlertId] = useState<string | null>(null);
  const alertSubmitInFlightRef = useRef(false);

  const {
    approvalRules,
    actionPolicies,
    chatAckTemplates,
    counts: policyCounts,
    loadAllPolicyResources,
  } = useAdminSettingsPolicyResources({ setMessage, logError });

  const {
    items: templateItems,
    form: templateForm,
    setForm: setTemplateForm,
    editingId: editingTemplateId,
    templatesForKind,
    templateNameMap,
    load: loadTemplateSettings,
    loadPdfTemplates,
    submit: submitTemplateSetting,
    resetForm: resetTemplateForm,
    startEdit: startEditTemplate,
    setDefault: setTemplateDefault,
  } = useAdminSettingsTemplates({ setMessage, logError });

  const {
    items: reportItems,
    deliveries: reportDeliveries,
    form: reportForm,
    setForm: setReportForm,
    editingId: editingReportId,
    deliveryFilterId: reportDeliveryFilterId,
    setDeliveryFilterId: setReportDeliveryFilterId,
    dryRun: reportDryRun,
    setDryRun: setReportDryRun,
    load: loadReportSubscriptions,
    submit: submitReportSubscription,
    resetForm: resetReportForm,
    startEdit: startEditReportSubscription,
    toggle: toggleReportSubscription,
    run: runReportSubscription,
    runAll: runAllReportSubscriptions,
    showDeliveries: showReportDeliveries,
  } = useAdminSettingsReports({ setMessage, logError });

  const {
    items: integrationItems,
    runs: integrationRuns,
    metrics: integrationRunMetrics,
    runFilterId: integrationRunFilterId,
    setRunFilterId: setIntegrationRunFilterId,
    form: integrationForm,
    setForm: setIntegrationForm,
    editingId: editingIntegrationId,
    load: loadIntegrationSettings,
    loadRuns: loadIntegrationRuns,
    submit: submitIntegrationSetting,
    resetForm: resetIntegrationForm,
    startEdit: startEditIntegration,
    run: runIntegrationSetting,
  } = useAdminSettingsIntegrations({ setMessage, logError });

  const {
    items: integrationExportJobItems,
    kindFilter: integrationExportJobKindFilter,
    setKindFilter: setIntegrationExportJobKindFilter,
    statusFilter: integrationExportJobStatusFilter,
    setStatusFilter: setIntegrationExportJobStatusFilter,
    limit: integrationExportJobLimit,
    setLimit: setIntegrationExportJobLimit,
    offset: integrationExportJobOffset,
    setOffset: setIntegrationExportJobOffset,
    loading: integrationExportJobLoading,
    redispatchingId: integrationExportJobRedispatchingId,
    load: loadIntegrationExportJobs,
    redispatch: redispatchIntegrationExportJob,
  } = useAdminSettingsIntegrationExportJobs({ setMessage, logError });

  const {
    periodKey: integrationReconciliationPeriodKey,
    setPeriodKey: updateIntegrationReconciliationPeriodKey,
    summary: integrationReconciliationSummary,
    details: integrationReconciliationDetails,
    detailsLoading: integrationReconciliationDetailsLoading,
    detailsError: integrationReconciliationDetailsError,
    loadSummary: loadIntegrationReconciliationSummary,
    loadDetails: loadIntegrationReconciliationDetails,
  } = useAdminSettingsReconciliation({ setMessage, logError });

  const {
    items: accountingMappingRuleItems,
    mappingKeyFilter: accountingMappingRuleFilterMappingKey,
    setMappingKeyFilter: setAccountingMappingRuleFilterMappingKey,
    isActiveFilter: accountingMappingRuleFilterIsActive,
    setIsActiveFilter: setAccountingMappingRuleFilterIsActive,
    limit: accountingMappingRuleLimit,
    setLimit: setAccountingMappingRuleLimit,
    offset: accountingMappingRuleOffset,
    setOffset: setAccountingMappingRuleOffset,
    loading: accountingMappingRuleLoading,
    form: accountingMappingRuleForm,
    setForm: setAccountingMappingRuleForm,
    editingId: editingAccountingMappingRuleId,
    reapplyForm: accountingMappingRuleReapplyForm,
    setReapplyForm: setAccountingMappingRuleReapplyForm,
    reapplying: accountingMappingRuleReapplying,
    reapplyResult: accountingMappingRuleReapplyResult,
    loadInitial: loadInitialAccountingMappingRules,
    load: loadAccountingMappingRules,
    submit: submitAccountingMappingRule,
    resetForm: resetAccountingMappingRuleForm,
    startEdit: startEditAccountingMappingRule,
    reapply: reapplyAccountingMappingRules,
  } = useAdminSettingsAccountingMappingRules({ setMessage, logError });
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
  const loadAlertSettings = useCallback(async () => {
    try {
      const res = await api<{ items: AlertSetting[] }>('/alert-settings');
      setAlertItems(res.items || []);
    } catch (err) {
      logError('loadAlertSettings failed', err);
      setAlertItems([]);
    }
  }, [logError]);

  useEffect(() => {
    loadAlertSettings();
    void loadAllPolicyResources();
    loadTemplateSettings();
    loadPdfTemplates();
    loadIntegrationSettings();
    loadReportSubscriptions();
    void loadInitialAccountingMappingRules();
  }, [
    loadAlertSettings,
    loadAllPolicyResources,
    loadTemplateSettings,
    loadPdfTemplates,
    loadIntegrationSettings,
    loadReportSubscriptions,
    loadInitialAccountingMappingRules,
  ]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(timer);
  }, [message]);

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

  const resetAlertForm = () => {
    setAlertForm(createDefaultAlertForm());
    setEditingAlertId(null);
    setAlertWizardStep('basic');
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
    if (alertSubmitInFlightRef.current) return;
    alertSubmitInFlightRef.current = true;
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
    } finally {
      alertSubmitInFlightRef.current = false;
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
          policyCounts.approvalRules +
          policyCounts.actionPolicies +
          policyCounts.chatAckTemplates
        }件`,
        helper: `承認ルール ${policyCounts.approvalRules} / ActionPolicy ${policyCounts.actionPolicies} / ack ${policyCounts.chatAckTemplates}`,
        tone:
          policyCounts.approvalRules +
            policyCounts.actionPolicies +
            policyCounts.chatAckTemplates >
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
      alertItems.length,
      hasSystemAdminRole,
      integrationExportJobItems.length,
      integrationItems.length,
      policyCounts.actionPolicies,
      policyCounts.approvalRules,
      policyCounts.chatAckTemplates,
      reportItems.length,
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
          approvalRules={approvalRules}
          actionPolicies={actionPolicies}
          chatAckTemplates={chatAckTemplates}
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
