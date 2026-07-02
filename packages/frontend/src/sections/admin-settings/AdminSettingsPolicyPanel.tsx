import type React from 'react';
import { PolicyFormBuilder } from '../../ui';
import { WorkflowPanel } from '../workflowUx';
import { AuditHistoryPanel } from './AuditHistoryPanel';
import {
  actionPolicyFormSchema,
  createDefaultChatAckTemplateForm,
  createDefaultRuleForm,
  flowTypes,
  formatDateTime,
  formatJson,
  getApprovalRuleSeriesKey,
  normalizeActionPolicyForm,
  parseDateTime,
  type ActionPolicy,
  type ActionPolicyForm,
  type ApprovalRule,
  type AuditLogItem,
  type ChatAckTemplate,
} from './adminSettingsModel';

type RuleForm = ReturnType<typeof createDefaultRuleForm>;
type ChatAckTemplateForm = ReturnType<typeof createDefaultChatAckTemplateForm>;

type ApprovalRuleMonitoring = {
  now: Date;
  groups: Record<
    string,
    {
      effective: ApprovalRule[];
      future: ApprovalRule[];
      inactive: ApprovalRule[];
      fallback: ApprovalRule | null;
    }
  >;
};

type ApprovalRuleSeries = {
  countsBySeries: Map<string, number>;
  latestRuleIds: Set<string>;
  seriesCountByFlowType: Map<string, number>;
  sortedRuleItems: ApprovalRule[];
};

type AsyncVoid = void | Promise<void>;

type ApprovalRulesPanelState = {
  monitoring: ApprovalRuleMonitoring;
  series: ApprovalRuleSeries;
  editingRule: ApprovalRule | null;
  editingRuleId: string | null;
  ruleForm: RuleForm;
  setRuleForm: React.Dispatch<React.SetStateAction<RuleForm>>;
  submitApprovalRule: () => AsyncVoid;
  resetRuleForm: () => void;
  loadApprovalRules: () => AsyncVoid;
  ruleItems: ApprovalRule[];
  toggleApprovalRuleActive: (
    id: string,
    current: boolean | null | undefined,
  ) => AsyncVoid;
  startEditRule: (item: ApprovalRule) => void;
  auditOpen: Record<string, boolean>;
  auditLoading: Record<string, boolean>;
  auditLogs: Record<string, AuditLogItem[]>;
  auditSelected: Record<string, string>;
  setAuditOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setAuditSelected: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  loadAuditLogs: (rule: ApprovalRule) => AsyncVoid;
};

type ActionPoliciesPanelState = {
  form: ActionPolicyForm;
  setForm: React.Dispatch<React.SetStateAction<ActionPolicyForm>>;
  submit: (formValue?: ActionPolicyForm) => AsyncVoid;
  reset: () => void;
  editingId: string | null;
  reload: () => AsyncVoid;
  items: ActionPolicy[];
  auditOpen: Record<string, boolean>;
  auditLoading: Record<string, boolean>;
  auditLogs: Record<string, AuditLogItem[]>;
  auditSelected: Record<string, string>;
  setAuditOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setAuditSelected: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  loadAuditLogs: (policyId: string) => AsyncVoid;
  startEdit: (item: ActionPolicy) => void;
};

type ChatAckTemplatesPanelState = {
  form: ChatAckTemplateForm;
  setForm: React.Dispatch<React.SetStateAction<ChatAckTemplateForm>>;
  submit: () => AsyncVoid;
  reset: () => void;
  editingId: string | null;
  items: ChatAckTemplate[];
  reload: () => AsyncVoid;
  startEdit: (item: ChatAckTemplate) => void;
};

export type AdminSettingsPolicyPanelProps = {
  settingsPanelContentStyle: React.CSSProperties;
  approvalRules: ApprovalRulesPanelState;
  actionPolicies: ActionPoliciesPanelState;
  chatAckTemplates: ChatAckTemplatesPanelState;
};

export function AdminSettingsPolicyPanel({
  settingsPanelContentStyle,
  approvalRules,
  actionPolicies,
  chatAckTemplates,
}: AdminSettingsPolicyPanelProps) {
  const {
    monitoring: approvalRuleMonitoring,
    series: approvalRuleSeries,
    editingRule,
    editingRuleId,
    ruleForm,
    setRuleForm,
    submitApprovalRule,
    resetRuleForm,
    loadApprovalRules,
    ruleItems,
    toggleApprovalRuleActive,
    startEditRule,
    auditOpen: approvalRuleAuditOpen,
    auditLoading: approvalRuleAuditLoading,
    auditLogs: approvalRuleAuditLogs,
    auditSelected: approvalRuleAuditSelected,
    setAuditOpen: setApprovalRuleAuditOpen,
    setAuditSelected: setApprovalRuleAuditSelected,
    loadAuditLogs: loadApprovalRuleAuditLogs,
  } = approvalRules;
  const {
    form: actionPolicyForm,
    setForm: setActionPolicyForm,
    submit: submitActionPolicy,
    reset: resetActionPolicyForm,
    editingId: editingActionPolicyId,
    reload: loadActionPolicies,
    items: actionPolicyItems,
    auditOpen: actionPolicyAuditOpen,
    auditLoading: actionPolicyAuditLoading,
    auditLogs: actionPolicyAuditLogs,
    auditSelected: actionPolicyAuditSelected,
    setAuditOpen: setActionPolicyAuditOpen,
    setAuditSelected: setActionPolicyAuditSelected,
    loadAuditLogs: loadActionPolicyAuditLogs,
    startEdit: startEditActionPolicy,
  } = actionPolicies;
  const {
    form: chatAckTemplateForm,
    setForm: setChatAckTemplateForm,
    submit: submitChatAckTemplate,
    reset: resetChatAckTemplateForm,
    editingId: editingChatAckTemplateId,
    items: chatAckTemplateItems,
    reload: loadChatAckTemplates,
    startEdit: startEditChatAckTemplate,
  } = chatAckTemplates;

  return (
    <WorkflowPanel
      title="承認・権限ポリシー"
      description="承認ルール、ActionPolicy、合意形成テンプレートを同じ文脈で確認します。"
    >
      <div style={settingsPanelContentStyle}>
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
                        series:
                        {approvalRuleSeries.seriesCountByFlowType.get(
                          flowType,
                        ) ?? 0}{' '}
                        effective:{group?.effective.length ?? 0} / future:
                        {group?.future.length ?? 0} / inactive:
                        {group?.inactive.length ?? 0}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: '#475569',
                        marginTop: 4,
                      }}
                    >
                      fallback:{' '}
                      {fallback
                        ? `series=${fallback.ruleKey ?? fallback.id} v${fallback.version ?? 1} id=${fallback.id} effectiveFrom=${formatDateTime(
                            fallback.effectiveFrom,
                          )}`
                        : '-'}
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
          {editingRule && (
            <div
              className="card"
              style={{ marginTop: 8, padding: 10, fontSize: 12 }}
            >
              系列 `{editingRule.ruleKey ?? editingRule.id}` の v
              {editingRule.version ?? 1} から新版を作成します。`flowType`
              は同一系列で固定され、旧版は履歴として残ります。
            </div>
          )}
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <label>
              flowType
              <select
                value={ruleForm.flowType}
                disabled={Boolean(editingRuleId)}
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
              effectiveFrom (任意, ISO date-time)
              <input
                type="text"
                value={ruleForm.effectiveFrom}
                onChange={(e) =>
                  setRuleForm({
                    ...ruleForm,
                    effectiveFrom: e.target.value,
                  })
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
                  setRuleForm({
                    ...ruleForm,
                    conditionsJson: e.target.value,
                  })
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
            <button
              className="button"
              data-testid="approval-rule-submit"
              onClick={submitApprovalRule}
            >
              {editingRuleId ? '新版作成' : '作成'}
            </button>
            <button
              className="button secondary"
              data-testid="approval-rule-reset"
              onClick={resetRuleForm}
            >
              {editingRuleId ? '新版作成をやめる' : 'クリア'}
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
            {approvalRuleSeries.sortedRuleItems.map((rule) => {
              const isActive = rule.isActive ?? true;
              const effectiveFrom = parseDateTime(rule.effectiveFrom ?? null);
              const effectiveTo = parseDateTime(rule.effectiveTo ?? null);
              const now = approvalRuleMonitoring.now;
              const statusLabel =
                effectiveTo && effectiveTo.getTime() <= now.getTime()
                  ? 'superseded'
                  : !isActive
                    ? 'inactive'
                    : effectiveFrom && effectiveFrom.getTime() > now.getTime()
                      ? 'future'
                      : 'effective';
              const seriesKey = getApprovalRuleSeriesKey(rule);
              const seriesRuleCount =
                approvalRuleSeries.countsBySeries.get(seriesKey) ?? 1;
              const isLatest = approvalRuleSeries.latestRuleIds.has(rule.id);
              const isHistoryOpen = approvalRuleAuditOpen[seriesKey] ?? false;
              const isHistoryLoading =
                approvalRuleAuditLoading[seriesKey] ?? false;
              const auditLogs = approvalRuleAuditLogs[seriesKey] || [];
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
                      <strong>{rule.flowType}</strong>
                      {` / series:${rule.ruleKey ?? rule.id} / v${rule.version ?? 1} / id=${rule.id}`}
                    </div>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <span className="badge">{statusLabel}</span>
                      <span className="badge">
                        latest: {isLatest ? 'true' : 'false'}
                      </span>
                      <span className="badge">
                        series versions: {seriesRuleCount}
                      </span>
                      <span className="badge">
                        isActive: {isActive ? 'true' : 'false'}
                      </span>
                      <span className="badge">
                        effectiveFrom: {formatDateTime(rule.effectiveFrom)}
                      </span>
                      <span className="badge">
                        effectiveTo: {formatDateTime(rule.effectiveTo)}
                      </span>
                      <span className="badge">
                        supersedesRuleId: {rule.supersedesRuleId ?? '-'}
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
                      disabled={!isLatest}
                      title={
                        isLatest
                          ? '最新版の有効化状態を変更します'
                          : '最新版のみ状態変更できます'
                      }
                      onClick={() =>
                        toggleApprovalRuleActive(rule.id, rule.isActive)
                      }
                    >
                      {isActive ? '無効化' : '有効化'}
                    </button>
                    <button
                      className="button secondary"
                      disabled={!isLatest}
                      title={
                        isLatest
                          ? 'この版を元に新版を作成します'
                          : '最新版のみ新版作成の起点にできます'
                      }
                      onClick={() => startEditRule(rule)}
                    >
                      新版作成
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => {
                        const nextOpen = !isHistoryOpen;
                        setApprovalRuleAuditOpen((prev) => ({
                          ...prev,
                          [seriesKey]: nextOpen,
                        }));
                        if (
                          nextOpen &&
                          approvalRuleAuditLogs[seriesKey] === undefined
                        ) {
                          loadApprovalRuleAuditLogs(rule);
                        }
                      }}
                    >
                      {isHistoryOpen ? '系列履歴を閉じる' : '系列履歴を見る'}
                    </button>
                    {isHistoryOpen && (
                      <button
                        className="button secondary"
                        onClick={() => loadApprovalRuleAuditLogs(rule)}
                      >
                        系列履歴を再読込
                      </button>
                    )}
                    {!isLatest && (
                      <span style={{ fontSize: 12, color: '#64748b' }}>
                        この版は履歴です。操作は最新版から行ってください。
                      </span>
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
                          selectedLogId={approvalRuleAuditSelected[seriesKey]}
                          onSelectLog={(logId) => {
                            setApprovalRuleAuditSelected((prev) => ({
                              ...prev,
                              [seriesKey]: logId,
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
      </div>
    </WorkflowPanel>
  );
}
