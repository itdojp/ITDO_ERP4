import { useCallback, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import {
  compareApprovalRulesForSeries,
  createDefaultActionPolicyForm,
  createDefaultChatAckTemplateForm,
  createDefaultRuleForm,
  flowTypes,
  getApprovalRuleSeriesKey,
  parseDateTime,
  type ActionPolicy,
  type ActionPolicyForm,
  type ApprovalRule,
  type AuditLogItem,
  type ChatAckTemplate,
} from './adminSettingsModel';
import {
  parseAdminSettingsJson,
  type AdminSettingsErrorLogger,
  type AdminSettingsMessageSink,
} from './adminSettingsResourceUtils';

type UseAdminSettingsPolicyResourcesOptions = {
  setMessage: AdminSettingsMessageSink;
  logError: AdminSettingsErrorLogger;
};

function parseOptionalNumber(
  raw: string,
  min: number,
): number | undefined | null {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < min) return null;
  return Math.floor(parsed);
}

export function useAdminSettingsPolicyResources({
  setMessage,
  logError,
}: UseAdminSettingsPolicyResourcesOptions) {
  const [ruleItems, setRuleItems] = useState<ApprovalRule[]>([]);
  const [actionPolicyItems, setActionPolicyItems] = useState<ActionPolicy[]>(
    [],
  );
  const [chatAckTemplateItems, setChatAckTemplateItems] = useState<
    ChatAckTemplate[]
  >([]);
  const [ruleForm, setRuleForm] = useState(createDefaultRuleForm);
  const [actionPolicyForm, setActionPolicyForm] = useState(
    createDefaultActionPolicyForm,
  );
  const [chatAckTemplateForm, setChatAckTemplateForm] = useState(
    createDefaultChatAckTemplateForm,
  );
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingActionPolicyId, setEditingActionPolicyId] = useState<
    string | null
  >(null);
  const [editingChatAckTemplateId, setEditingChatAckTemplateId] = useState<
    string | null
  >(null);
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
  const approvalRuleSubmitInFlightRef = useRef(false);
  const actionPolicySubmitInFlightRef = useRef(false);
  const chatAckTemplateSubmitInFlightRef = useRef(false);

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

  const loadApprovalRules = useCallback(async () => {
    try {
      const res = await api<{ items: ApprovalRule[] }>('/approval-rules');
      setRuleItems(res.items || []);
    } catch (err) {
      logError('loadApprovalRules failed', err);
      setRuleItems([]);
    }
  }, [logError]);

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

  const loadApprovalRuleAuditLogs = useCallback(
    async (rule: ApprovalRule) => {
      const key = getApprovalRuleSeriesKey(rule);
      const seriesRules = ruleItems.filter(
        (item) => getApprovalRuleSeriesKey(item) === key,
      );
      setApprovalRuleAuditLoading((current) => ({ ...current, [key]: true }));
      try {
        const responses = await Promise.all(
          seriesRules.map(async (seriesRule) => {
            const query = new URLSearchParams({
              targetTable: 'approval_rules',
              targetId: seriesRule.id,
              limit: '50',
            });
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
        setApprovalRuleAuditLogs((current) => ({
          ...current,
          [key]: mergedLogs,
        }));
        setApprovalRuleAuditOpen((current) => ({ ...current, [key]: true }));
        setApprovalRuleAuditSelected((current) => ({
          ...current,
          [key]: mergedLogs[0]?.id || '',
        }));
      } catch (err) {
        logError('loadApprovalRuleAuditLogs failed', err);
        setApprovalRuleAuditLogs((current) => ({ ...current, [key]: [] }));
        setApprovalRuleAuditOpen((current) => ({ ...current, [key]: true }));
        setApprovalRuleAuditSelected((current) => ({ ...current, [key]: '' }));
      } finally {
        setApprovalRuleAuditLoading((current) => ({
          ...current,
          [key]: false,
        }));
      }
    },
    [logError, ruleItems],
  );

  const loadActionPolicyAuditLogs = useCallback(
    async (policyId: string) => {
      setActionPolicyAuditLoading((current) => ({
        ...current,
        [policyId]: true,
      }));
      try {
        const query = new URLSearchParams({
          targetTable: 'action_policies',
          targetId: policyId,
          limit: '20',
        });
        const res = await api<{ items: AuditLogItem[] }>(
          `/audit-logs?${query.toString()}`,
        );
        setActionPolicyAuditLogs((current) => ({
          ...current,
          [policyId]: res.items || [],
        }));
        setActionPolicyAuditOpen((current) => ({
          ...current,
          [policyId]: true,
        }));
        setActionPolicyAuditSelected((current) => ({
          ...current,
          [policyId]: (res.items || [])[0]?.id || '',
        }));
      } catch (err) {
        logError('loadActionPolicyAuditLogs failed', err);
        setActionPolicyAuditLogs((current) => ({ ...current, [policyId]: [] }));
        setActionPolicyAuditOpen((current) => ({
          ...current,
          [policyId]: true,
        }));
        setActionPolicyAuditSelected((current) => ({
          ...current,
          [policyId]: '',
        }));
      } finally {
        setActionPolicyAuditLoading((current) => ({
          ...current,
          [policyId]: false,
        }));
      }
    },
    [logError],
  );

  const resetRuleForm = useCallback(() => {
    setRuleForm(createDefaultRuleForm());
    setEditingRuleId(null);
  }, []);

  const resetActionPolicyForm = useCallback(() => {
    setActionPolicyForm(createDefaultActionPolicyForm());
    setEditingActionPolicyId(null);
  }, []);

  const resetChatAckTemplateForm = useCallback(() => {
    setChatAckTemplateForm(createDefaultChatAckTemplateForm());
    setEditingChatAckTemplateId(null);
  }, []);

  const toggleApprovalRuleActive = useCallback(
    async (id: string, current: boolean | null | undefined) => {
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
    },
    [loadApprovalRules, logError, setMessage],
  );

  const startEditRule = useCallback((item: ApprovalRule) => {
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
  }, []);

  const submitApprovalRule = useCallback(async () => {
    const effectiveFrom = ruleForm.effectiveFrom.trim();
    const conditions = parseAdminSettingsJson(
      'conditions',
      ruleForm.conditionsJson,
      setMessage,
    );
    if (conditions === null) return;
    const steps = parseAdminSettingsJson(
      'steps',
      ruleForm.stepsJson,
      setMessage,
    );
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
    if (approvalRuleSubmitInFlightRef.current) return;
    approvalRuleSubmitInFlightRef.current = true;
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
    } finally {
      approvalRuleSubmitInFlightRef.current = false;
    }
  }, [
    editingRuleId,
    loadApprovalRules,
    logError,
    resetRuleForm,
    ruleForm,
    setMessage,
  ]);

  const startEditActionPolicy = useCallback((item: ActionPolicy) => {
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
  }, []);

  const submitActionPolicy = useCallback(
    async (formValue: ActionPolicyForm = actionPolicyForm) => {
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
      const subjects = parseAdminSettingsJson(
        'subjects',
        formValue.subjectsJson,
        setMessage,
      );
      if (subjects === null) return;
      const stateConstraints = parseAdminSettingsJson(
        'stateConstraints',
        formValue.stateConstraintsJson,
        setMessage,
      );
      if (stateConstraints === null) return;
      const guards = parseAdminSettingsJson(
        'guards',
        formValue.guardsJson,
        setMessage,
      );
      if (guards === null) return;

      if (actionPolicySubmitInFlightRef.current) return;
      actionPolicySubmitInFlightRef.current = true;
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
      } finally {
        actionPolicySubmitInFlightRef.current = false;
      }
    },
    [
      actionPolicyForm,
      editingActionPolicyId,
      loadActionPolicies,
      logError,
      resetActionPolicyForm,
      setMessage,
    ],
  );

  const startEditChatAckTemplate = useCallback((item: ChatAckTemplate) => {
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
  }, []);

  const submitChatAckTemplate = useCallback(async () => {
    const flowType = chatAckTemplateForm.flowType.trim();
    const actionKey = chatAckTemplateForm.actionKey.trim();
    const messageBody = chatAckTemplateForm.messageBody.trim();
    if (!flowType || !actionKey || !messageBody) {
      setMessage('flowType / actionKey / messageBody を入力してください');
      return;
    }
    const requiredUserIds = parseAdminSettingsJson(
      'requiredUserIds',
      chatAckTemplateForm.requiredUserIdsJson,
      setMessage,
    );
    if (requiredUserIds === null) return;
    const requiredGroupIds = parseAdminSettingsJson(
      'requiredGroupIds',
      chatAckTemplateForm.requiredGroupIdsJson,
      setMessage,
    );
    if (requiredGroupIds === null) return;
    const requiredRoles = parseAdminSettingsJson(
      'requiredRoles',
      chatAckTemplateForm.requiredRolesJson,
      setMessage,
    );
    if (requiredRoles === null) return;
    const escalationUserIds = parseAdminSettingsJson(
      'escalationUserIds',
      chatAckTemplateForm.escalationUserIdsJson,
      setMessage,
    );
    if (escalationUserIds === null) return;
    const escalationGroupIds = parseAdminSettingsJson(
      'escalationGroupIds',
      chatAckTemplateForm.escalationGroupIdsJson,
      setMessage,
    );
    if (escalationGroupIds === null) return;
    const escalationRoles = parseAdminSettingsJson(
      'escalationRoles',
      chatAckTemplateForm.escalationRolesJson,
      setMessage,
    );
    if (escalationRoles === null) return;

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

    if (chatAckTemplateSubmitInFlightRef.current) return;
    chatAckTemplateSubmitInFlightRef.current = true;
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
    } finally {
      chatAckTemplateSubmitInFlightRef.current = false;
    }
  }, [
    chatAckTemplateForm,
    editingChatAckTemplateId,
    loadChatAckTemplates,
    logError,
    resetChatAckTemplateForm,
    setMessage,
  ]);

  const loadAllPolicyResources = useCallback(async () => {
    await Promise.all([
      loadApprovalRules(),
      loadActionPolicies(),
      loadChatAckTemplates(),
    ]);
  }, [loadActionPolicies, loadApprovalRules, loadChatAckTemplates]);

  return {
    approvalRules: {
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
    },
    actionPolicies: {
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
    },
    chatAckTemplates: {
      form: chatAckTemplateForm,
      setForm: setChatAckTemplateForm,
      submit: submitChatAckTemplate,
      reset: resetChatAckTemplateForm,
      editingId: editingChatAckTemplateId,
      items: chatAckTemplateItems,
      reload: loadChatAckTemplates,
      startEdit: startEditChatAckTemplate,
    },
    counts: {
      approvalRules: ruleItems.length,
      actionPolicies: actionPolicyItems.length,
      chatAckTemplates: chatAckTemplateItems.length,
    },
    loadAllPolicyResources,
  };
}
