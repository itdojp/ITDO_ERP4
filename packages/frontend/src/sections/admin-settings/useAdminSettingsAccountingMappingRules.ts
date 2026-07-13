import { useCallback, useRef, useState } from 'react';
import { api } from '../../api';
import {
  DEFAULT_ACCOUNTING_MAPPING_RULE_LIMIT,
  DEFAULT_ACCOUNTING_MAPPING_RULE_OFFSET,
  createDefaultAccountingMappingRuleForm,
  createDefaultAccountingMappingRuleReapplyForm,
  type AccountingMappingRuleReapplyForm,
} from './adminSettingsModel';
import type {
  AccountingMappingRuleItem,
  AccountingMappingRuleReapplyResult,
} from './AccountingMappingRulesCard';
import {
  normalizeNullableText,
  type AdminSettingsErrorLogger,
  type AdminSettingsMessageSink,
} from './adminSettingsResourceUtils';

type UseAdminSettingsAccountingMappingRulesOptions = {
  setMessage: AdminSettingsMessageSink;
  logError: AdminSettingsErrorLogger;
};

type LoadAccountingMappingRulesOptions = {
  mappingKey: string;
  isActive: string;
  limit: number;
  offset: number;
  suppressMessage?: boolean;
};

export function useAdminSettingsAccountingMappingRules({
  setMessage,
  logError,
}: UseAdminSettingsAccountingMappingRulesOptions) {
  const [items, setItems] = useState<AccountingMappingRuleItem[]>([]);
  const [mappingKeyFilter, setMappingKeyFilter] = useState<string>('');
  const [isActiveFilter, setIsActiveFilter] = useState<string>('');
  const [limit, setLimit] = useState<number>(
    DEFAULT_ACCOUNTING_MAPPING_RULE_LIMIT,
  );
  const [offset, setOffset] = useState<number>(
    DEFAULT_ACCOUNTING_MAPPING_RULE_OFFSET,
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [form, setForm] = useState(createDefaultAccountingMappingRuleForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reapplyForm, setReapplyForm] =
    useState<AccountingMappingRuleReapplyForm>(
      createDefaultAccountingMappingRuleReapplyForm,
    );
  const [reapplying, setReapplying] = useState(false);
  const [reapplyResult, setReapplyResult] =
    useState<AccountingMappingRuleReapplyResult | null>(null);
  const submitInFlightRef = useRef(false);
  const reapplyInFlightRef = useRef(false);

  const loadWithQuery = useCallback(
    async (options: LoadAccountingMappingRulesOptions) => {
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
      setLoading(true);
      try {
        const result = await api<{ items: AccountingMappingRuleItem[] }>(
          `/integrations/accounting/mapping-rules?${query.toString()}`,
        );
        setItems(result.items || []);
        if (!options.suppressMessage) {
          setMessage('会計マッピングルールを取得しました');
        }
      } catch (err) {
        logError('loadAccountingMappingRules failed', err);
        setItems([]);
        if (!options.suppressMessage) {
          setMessage('会計マッピングルールの取得に失敗しました');
        }
      } finally {
        setLoading(false);
      }
    },
    [logError, setMessage],
  );

  const load = useCallback(async () => {
    await loadWithQuery({
      mappingKey: mappingKeyFilter,
      isActive: isActiveFilter,
      limit,
      offset,
    });
  }, [isActiveFilter, mappingKeyFilter, limit, offset, loadWithQuery]);

  const loadInitial = useCallback(
    async () =>
      loadWithQuery({
        mappingKey: '',
        isActive: '',
        limit: DEFAULT_ACCOUNTING_MAPPING_RULE_LIMIT,
        offset: DEFAULT_ACCOUNTING_MAPPING_RULE_OFFSET,
        suppressMessage: true,
      }),
    [loadWithQuery],
  );

  const resetForm = useCallback(() => {
    setForm(createDefaultAccountingMappingRuleForm());
    setEditingId(null);
  }, []);

  const submit = useCallback(async () => {
    const payload = {
      mappingKey: form.mappingKey.trim(),
      debitAccountCode: form.debitAccountCode.trim(),
      debitAccountName: normalizeNullableText(form.debitAccountName),
      debitSubaccountCode: normalizeNullableText(form.debitSubaccountCode),
      requireDebitSubaccountCode: form.requireDebitSubaccountCode,
      creditAccountCode: form.creditAccountCode.trim(),
      creditAccountName: normalizeNullableText(form.creditAccountName),
      creditSubaccountCode: normalizeNullableText(form.creditSubaccountCode),
      requireCreditSubaccountCode: form.requireCreditSubaccountCode,
      departmentCode: normalizeNullableText(form.departmentCode),
      requireDepartmentCode: form.requireDepartmentCode,
      taxCode: form.taxCode.trim(),
      isActive: form.isActive,
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
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    try {
      if (editingId) {
        await api(`/integrations/accounting/mapping-rules/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setMessage('会計マッピングルールを更新しました');
      } else {
        await api('/integrations/accounting/mapping-rules', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage('会計マッピングルールを作成しました');
      }
      await load();
      resetForm();
    } catch (err) {
      logError('submitAccountingMappingRule failed', err);
      setMessage('会計マッピングルールの保存に失敗しました');
    } finally {
      submitInFlightRef.current = false;
    }
  }, [editingId, form, load, logError, resetForm, setMessage]);

  const startEdit = useCallback((item: AccountingMappingRuleItem) => {
    setEditingId(item.id);
    setForm({
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
  }, []);

  const reapply = useCallback(async () => {
    const periodKey = reapplyForm.periodKey.trim();
    if (periodKey && !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) {
      setMessage('periodKey は YYYY-MM 形式で入力してください');
      return;
    }
    if (reapplyInFlightRef.current) return;
    reapplyInFlightRef.current = true;
    setReapplying(true);
    try {
      const result = await api<AccountingMappingRuleReapplyResult>(
        '/integrations/accounting/mapping-rules/reapply',
        {
          method: 'POST',
          body: JSON.stringify({
            periodKey: periodKey || undefined,
            mappingKey: reapplyForm.mappingKey.trim() || undefined,
            limit: reapplyForm.limit,
            offset: reapplyForm.offset,
          }),
        },
      );
      setReapplyResult(result);
      setMessage('会計マッピングルールを再適用しました');
    } catch (err) {
      logError('reapplyAccountingMappingRules failed', err);
      setReapplyResult(null);
      setMessage('会計マッピングルールの再適用に失敗しました');
    } finally {
      reapplyInFlightRef.current = false;
      setReapplying(false);
    }
  }, [reapplyForm, logError, setMessage]);

  return {
    items,
    mappingKeyFilter,
    setMappingKeyFilter,
    isActiveFilter,
    setIsActiveFilter,
    limit,
    setLimit,
    offset,
    setOffset,
    loading,
    form,
    setForm,
    editingId,
    reapplyForm,
    setReapplyForm,
    reapplying,
    reapplyResult,
    loadWithQuery,
    load,
    loadInitial,
    submit,
    resetForm,
    startEdit,
    reapply,
  };
}
