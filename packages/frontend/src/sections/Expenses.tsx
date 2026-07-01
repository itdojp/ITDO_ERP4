import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';
import { AnnotationsCard } from '../components/AnnotationsCard';
import { useProjects } from '../hooks/useProjects';
import {
  Alert,
  Button,
  Card,
  CrudList,
  DataTable,
  Dialog,
  Drawer,
  EmptyState,
  FilterBar,
  Input,
  Select,
  StatusBadge,
  Toast,
  erpStatusDictionary,
} from '../ui';
import type { DataTableColumn, DataTableRow } from '../ui';
import { enqueueOfflineItem, isOfflineError } from '../utils/offlineQueue';

type Expense = {
  id: string;
  projectId: string;
  userId: string;
  category: string;
  amount: number;
  currency: string;
  incurredOn: string;
  status: string;
  settlementStatus?: 'paid' | 'unpaid' | string;
  paidAt?: string | null;
  paidBy?: string | null;
  receiptUrl?: string | null;
  isShared?: boolean | null;
};

type FormState = {
  projectId: string;
  category: string;
  amount: number;
  currency: string;
  incurredOn: string;
  isShared: boolean;
  receiptUrl: string;
};

type MessageState = { text: string; type: 'success' | 'error' } | null;

type ListFilterState = {
  status: string;
  settlementStatus: 'all' | 'unpaid' | 'paid';
  receipt: 'all' | 'with' | 'without';
  paidFrom: string;
  paidTo: string;
};

const defaultForm: FormState = {
  projectId: 'demo-project',
  category: '交通費',
  amount: 1000,
  currency: 'JPY',
  incurredOn: new Date().toISOString().slice(0, 10),
  isShared: false,
  receiptUrl: '',
};

const defaultListFilter: ListFilterState = {
  status: 'all',
  settlementStatus: 'all',
  receipt: 'all',
  paidFrom: '',
  paidTo: '',
};

const settlementLabels: Record<string, string> = {
  paid: '支払済み',
  unpaid: '未払い',
};

function formatCurrencyAmount(amount: number, currency: string) {
  return `${amount.toLocaleString('ja-JP')} ${currency}`;
}

function formatSettlementStatus(value?: string | null) {
  if (!value) return '未払い';
  return settlementLabels[value] || value;
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return value.slice(0, 10);
}

function getSafeReceiptUrl(value?: string | null) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : '';
  } catch {
    return '';
  }
}

export const Expenses: React.FC = () => {
  const auth = getAuthState();
  const defaultProjectId = auth?.projectIds?.[0] || defaultForm.projectId;
  const [form, setForm] = useState<FormState>({
    ...defaultForm,
    projectId: defaultProjectId,
  });
  const [items, setItems] = useState<Expense[]>([]);
  const handleProjectSelect = useCallback(
    (projectId: string) => {
      setForm((prev) => ({ ...prev, projectId }));
    },
    [setForm],
  );
  const { projects, projectMessage } = useProjects({
    selectedProjectId: form.projectId,
    onSelect: handleProjectSelect,
  });
  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const [annotationTarget, setAnnotationTarget] = useState<{
    kind: 'expense';
    id: string;
    projectId: string;
    title: string;
  } | null>(null);
  const [message, setMessage] = useState<MessageState>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSettlementUpdating, setIsSettlementUpdating] = useState(false);
  const [listFilter, setListFilter] =
    useState<ListFilterState>(defaultListFilter);
  const [markPaidTarget, setMarkPaidTarget] = useState<Expense | null>(null);
  const [markPaidDate, setMarkPaidDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [markPaidReason, setMarkPaidReason] = useState('');
  const [unmarkPaidTarget, setUnmarkPaidTarget] = useState<Expense | null>(
    null,
  );
  const [unmarkPaidReason, setUnmarkPaidReason] = useState('');
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const canManageSettlement = Boolean(
    auth?.roles?.some((role) => role === 'admin' || role === 'mgmt'),
  );
  const amountValue = Number.isFinite(form.amount) ? form.amount : 0;
  const amountError =
    amountValue <= 0
      ? '金額は1以上で入力してください'
      : amountValue > 10000000
        ? '金額が大きすぎます'
        : '';
  const currencyValue = form.currency.trim();
  const currencyError =
    currencyValue && !/^[A-Z]{3}$/.test(currencyValue)
      ? '通貨は3文字の英大文字で入力してください'
      : '';
  const baseValid =
    Boolean(form.projectId.trim()) &&
    Boolean(form.category.trim()) &&
    Boolean(form.incurredOn) &&
    Boolean(currencyValue);
  const isValid = baseValid && !amountError && !currencyError;
  const validationHint = !baseValid
    ? '案件 / 区分 / 日付 / 通貨は必須です'
    : amountError || currencyError;

  const parseDateSafe = (value?: string | null) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  };

  const loadItems = useCallback(async () => {
    try {
      const res = await api<{ items: Expense[] }>('/expenses');
      setItems(res.items);
    } catch {
      setItems([]);
    }
  }, [setItems]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!message || message.type !== 'success') return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const renderProject = useCallback(
    (projectId: string) => {
      const project = projectMap.get(projectId);
      return project ? `${project.code} / ${project.name}` : projectId;
    },
    [projectMap],
  );

  const missingReceiptCount = useMemo(
    () => items.filter((item) => !item.receiptUrl).length,
    [items],
  );
  const statusOptions = useMemo(
    () =>
      Array.from(new Set(items.map((item) => item.status)))
        .filter(Boolean)
        .sort(),
    [items],
  );
  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (showMissingOnly && item.receiptUrl) return false;
        if (listFilter.status !== 'all' && item.status !== listFilter.status) {
          return false;
        }
        if (
          listFilter.settlementStatus !== 'all' &&
          item.settlementStatus !== listFilter.settlementStatus
        ) {
          return false;
        }
        if (listFilter.receipt === 'with' && !item.receiptUrl) return false;
        if (listFilter.receipt === 'without' && item.receiptUrl) return false;
        if (listFilter.paidFrom || listFilter.paidTo) {
          const paidAt = parseDateSafe(item.paidAt);
          if (!paidAt) return false;
          if (listFilter.paidFrom) {
            const from = parseDateSafe(listFilter.paidFrom);
            if (from && paidAt < from) return false;
          }
          if (listFilter.paidTo) {
            const to = parseDateSafe(listFilter.paidTo);
            if (to) {
              const nextDay = new Date(to);
              nextDay.setDate(nextDay.getDate() + 1);
              if (paidAt >= nextDay) return false;
            }
          }
        }
        return true;
      }),
    [items, listFilter, showMissingOnly],
  );
  const paidCount = useMemo(
    () => items.filter((item) => item.settlementStatus === 'paid').length,
    [items],
  );
  const unpaidCount = Math.max(items.length - paidCount, 0);
  const activeFilterCount = [
    showMissingOnly,
    listFilter.status !== 'all',
    listFilter.settlementStatus !== 'all',
    listFilter.receipt !== 'all',
    Boolean(listFilter.paidFrom),
    Boolean(listFilter.paidTo),
  ].filter(Boolean).length;
  const hasActiveFilters = activeFilterCount > 0;

  const clearFilters = useCallback(() => {
    setShowMissingOnly(false);
    setListFilter(defaultListFilter);
  }, [setListFilter, setShowMissingOnly]);

  const tableRows = useMemo<DataTableRow[]>(
    () =>
      visibleItems.map((item) => ({
        id: item.id,
        incurredOn: formatDate(item.incurredOn),
        project: renderProject(item.projectId),
        category: item.category,
        amount: formatCurrencyAmount(item.amount, item.currency),
        status: item.status,
        settlementStatus: item.settlementStatus || 'unpaid',
        settlementLabel: formatSettlementStatus(item.settlementStatus),
        sharing: item.isShared ? '共通' : '個別',
        receipt: item.receiptUrl ? '登録あり' : '未登録',
        paidAt: item.paidAt ? formatDate(item.paidAt) : '-',
        isShared: Boolean(item.isShared),
      })),
    [visibleItems, renderProject],
  );
  const visibleItemMap = useMemo(
    () => new Map(visibleItems.map((item) => [item.id, item])),
    [visibleItems],
  );

  const tableColumns = useMemo<DataTableColumn[]>(
    () => [
      { key: 'incurredOn', header: '日付' },
      { key: 'project', header: '案件' },
      { key: 'category', header: '区分' },
      {
        key: 'sharing',
        header: '共有',
        cell: (row) => (
          <span
            className="badge"
            style={
              row.isShared
                ? { background: '#dbeafe', color: '#1d4ed8' }
                : { background: '#f3f4f6', color: '#374151' }
            }
          >
            {String(row.sharing || '')}
          </span>
        ),
      },
      { key: 'amount', header: '金額', align: 'right' },
      {
        key: 'status',
        header: '承認状態',
        cell: (row) => (
          <StatusBadge
            status={String(row.status || '')}
            dictionary={erpStatusDictionary}
            size="sm"
          />
        ),
      },
      {
        key: 'settlementLabel',
        header: '精算',
        cell: (row) => (
          <span
            className="badge"
            style={
              row.settlementStatus === 'paid'
                ? { background: '#dcfce7', color: '#166534' }
                : { background: '#fef3c7', color: '#92400e' }
            }
          >
            {String(row.settlementLabel || '')}
          </span>
        ),
      },
      {
        key: 'receipt',
        header: '領収書',
        cell: (row) => {
          const target = visibleItemMap.get(row.id);
          const safeReceiptUrl = getSafeReceiptUrl(target?.receiptUrl);
          if (safeReceiptUrl) {
            return (
              <a
                href={safeReceiptUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                領収書
              </a>
            );
          }
          if (target?.receiptUrl) {
            return (
              <span
                className="badge"
                style={{ background: '#ffedd5', color: '#9a3412' }}
              >
                URL無効
              </span>
            );
          }
          return (
            <span
              className="badge"
              style={{ background: '#fee2e2', color: '#991b1b' }}
            >
              領収書未登録
            </span>
          );
        },
      },
      { key: 'paidAt', header: '支払日' },
      {
        key: 'actions',
        header: '操作',
        width: '176px',
        cell: (row) => {
          const target = visibleItemMap.get(row.id);
          if (!target) return null;
          return (
            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                minWidth: 144,
              }}
            >
              <Button
                variant="secondary"
                style={{ whiteSpace: 'nowrap' }}
                aria-label={`注釈（経費）: ${formatDate(target.incurredOn)} ${target.category} ${target.amount} ${target.currency}`}
                onClick={() =>
                  setAnnotationTarget({
                    kind: 'expense',
                    id: target.id,
                    projectId: target.projectId,
                    title: `経費: ${formatDate(target.incurredOn)} / ${target.category}`,
                  })
                }
              >
                注釈
              </Button>
              {canManageSettlement &&
                target.status === 'approved' &&
                target.settlementStatus !== 'paid' && (
                  <Button
                    variant="secondary"
                    style={{ whiteSpace: 'nowrap' }}
                    onClick={() => {
                      setMarkPaidTarget(target);
                      setMarkPaidDate(new Date().toISOString().slice(0, 10));
                      setMarkPaidReason('');
                    }}
                  >
                    支払済みにする
                  </Button>
                )}
              {canManageSettlement && target.settlementStatus === 'paid' && (
                <Button
                  variant="secondary"
                  style={{ whiteSpace: 'nowrap' }}
                  onClick={() => {
                    setUnmarkPaidTarget(target);
                    setUnmarkPaidReason('');
                  }}
                >
                  支払取消
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [
      canManageSettlement,
      setAnnotationTarget,
      setMarkPaidDate,
      setMarkPaidReason,
      setMarkPaidTarget,
      setUnmarkPaidReason,
      setUnmarkPaidTarget,
      visibleItemMap,
    ],
  );

  const listContent = useMemo(() => {
    if (tableRows.length > 0) {
      return <DataTable columns={tableColumns} rows={tableRows} />;
    }
    return (
      <EmptyState
        title={
          items.length === 0
            ? '経費データがありません'
            : '条件に一致する経費がありません'
        }
        description={
          items.length === 0
            ? '上のフォームから経費を追加してください。'
            : '条件をクリアするか、フィルタを変更してください。'
        }
        action={
          hasActiveFilters ? (
            <Button variant="ghost" onClick={clearFilters}>
              条件をクリア
            </Button>
          ) : undefined
        }
      />
    );
  }, [tableRows, tableColumns, items.length, hasActiveFilters, clearFilters]);

  const add = async () => {
    if (!isValid) {
      setMessage(null);
      return;
    }
    const userId = getAuthState()?.userId || 'demo-user';
    const payload = {
      projectId: form.projectId.trim(),
      userId,
      category: form.category.trim(),
      amount: form.amount,
      currency: form.currency.trim() || 'JPY',
      incurredOn: form.incurredOn,
      isShared: form.isShared,
      receiptUrl: form.receiptUrl.trim() || undefined,
    };
    const request = {
      path: '/expenses',
      method: 'POST',
      body: payload,
    };
    try {
      setIsSaving(true);
      await api(request.path, {
        method: request.method,
        body: JSON.stringify(request.body),
      });
      setMessage({ text: '経費を保存しました', type: 'success' });
      try {
        await loadItems();
      } catch {
        setMessage({
          text: '保存しましたが一覧の更新に失敗しました',
          type: 'error',
        });
      }
      setForm({ ...defaultForm, projectId: defaultProjectId });
    } catch (e) {
      if (isOfflineError(e)) {
        await enqueueOfflineItem({
          kind: 'expense',
          label: `経費 ${form.incurredOn} ${form.amount}${form.currency}`,
          requests: [request],
        });
        setMessage({
          text: 'オフラインのため送信待ちに保存しました',
          type: 'success',
        });
        setForm({ ...defaultForm, projectId: defaultProjectId });
      } else {
        setMessage({ text: '保存に失敗しました', type: 'error' });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const applyMarkPaid = async () => {
    if (!markPaidTarget) return;
    try {
      setIsSettlementUpdating(true);
      const body: Record<string, string> = {};
      if (markPaidDate) body.paidAt = markPaidDate;
      if (markPaidReason.trim()) body.reasonText = markPaidReason.trim();
      const updated = await api<Expense>(
        `/expenses/${encodeURIComponent(markPaidTarget.id)}/mark-paid`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      );
      setItems((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
      setMarkPaidTarget(null);
      setMarkPaidDate(new Date().toISOString().slice(0, 10));
      setMarkPaidReason('');
      setMessage({ text: '支払済みに更新しました', type: 'success' });
    } catch {
      setMessage({ text: '支払済み更新に失敗しました', type: 'error' });
    } finally {
      setIsSettlementUpdating(false);
    }
  };

  const applyUnmarkPaid = async () => {
    if (!unmarkPaidTarget || !unmarkPaidReason.trim()) return;
    try {
      setIsSettlementUpdating(true);
      const updated = await api<Expense>(
        `/expenses/${encodeURIComponent(unmarkPaidTarget.id)}/unmark-paid`,
        {
          method: 'POST',
          body: JSON.stringify({ reasonText: unmarkPaidReason.trim() }),
        },
      );
      setItems((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
      setUnmarkPaidTarget(null);
      setUnmarkPaidReason('');
      setMessage({ text: '支払済みを取り消しました', type: 'success' });
    } catch {
      setMessage({ text: '支払取消に失敗しました', type: 'error' });
    } finally {
      setIsSettlementUpdating(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h2 style={{ marginBottom: 4 }}>経費入力</h2>
      <p style={{ marginTop: -12, color: '#475569' }}>
        経費の登録、領収書未登録の確認、支払状況の更新をこの画面で行います。
      </p>

      <Card padding="small">
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>経費を登録</h3>
            <p style={{ margin: '4px 0 0', color: '#64748b' }}>
              案件、区分、金額、日付を入力してください。領収書URLは後から追加できます。
            </p>
          </div>
          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              alignItems: 'end',
            }}
          >
            <Select
              label="案件"
              aria-label="案件選択"
              value={form.projectId}
              onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            >
              <option value="">案件を選択</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} / {project.name}
                </option>
              ))}
            </Select>
            <Input
              label="区分"
              aria-label="経費区分"
              type="text"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="交通費 / 宿泊費 など"
            />
            <Input
              label="金額"
              aria-label="経費金額"
              type="number"
              min={1}
              max={10000000}
              value={form.amount}
              onChange={(e) =>
                setForm({ ...form, amount: Number(e.target.value) })
              }
            />
            <Input
              label="通貨"
              aria-label="通貨"
              type="text"
              value={form.currency}
              onChange={(e) => {
                const value = e.target.value.toUpperCase().slice(0, 3);
                setForm({ ...form, currency: value });
              }}
              placeholder="JPY"
              maxLength={3}
              pattern="[A-Z]{3}"
            />
            <Input
              label="経費日付"
              aria-label="経費日付"
              type="date"
              value={form.incurredOn}
              onChange={(e) => setForm({ ...form, incurredOn: e.target.value })}
            />
            <label
              className="badge"
              style={{ cursor: 'pointer', width: 'fit-content' }}
            >
              <input
                type="checkbox"
                checked={form.isShared}
                onChange={(e) =>
                  setForm({ ...form, isShared: e.target.checked })
                }
                style={{ marginRight: 6 }}
              />
              共通経費
            </label>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              alignItems: 'end',
            }}
          >
            <div style={{ flex: '1 1 320px' }}>
              <Input
                label="領収書URL"
                aria-label="領収書URL"
                type="url"
                value={form.receiptUrl}
                onChange={(e) =>
                  setForm({ ...form, receiptUrl: e.target.value })
                }
                placeholder="https://example.com/receipt.pdf"
              />
            </div>
            <Button onClick={add} disabled={!isValid || isSaving}>
              {isSaving ? '保存中...' : '追加'}
            </Button>
          </div>
          {validationHint && <Alert variant="error">{validationHint}</Alert>}
          {projectMessage && <Alert variant="error">{projectMessage}</Alert>}
        </div>
      </Card>

      <div
        aria-live="polite"
        style={{
          display: 'grid',
          gap: 8,
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        }}
      >
        <Card padding="small">
          <strong>表示中</strong>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {visibleItems.length} / {items.length}件
          </div>
        </Card>
        <Card padding="small">
          <strong>領収書未登録</strong>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {missingReceiptCount}件
          </div>
        </Card>
        <Card padding="small">
          <strong>未払い</strong>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{unpaidCount}件</div>
        </Card>
        <Card padding="small">
          <strong>支払済み</strong>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{paidCount}件</div>
        </Card>
      </div>

      <CrudList
        title="経費一覧"
        description="領収書未登録、精算状態、支払日で絞り込み、必要な経費をすぐ確認できます。"
        filters={
          <FilterBar
            actions={
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  variant="secondary"
                  onClick={() => setShowMissingOnly((prev) => !prev)}
                >
                  {showMissingOnly ? '全件表示' : '未登録のみ表示'}
                </Button>
                <Button variant="secondary" onClick={() => void loadItems()}>
                  再読み込み
                </Button>
                {hasActiveFilters && (
                  <Button variant="ghost" onClick={clearFilters}>
                    条件クリア
                  </Button>
                )}
              </div>
            }
          >
            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                alignItems: 'end',
              }}
            >
              <Select
                label="状態"
                aria-label="経費状態フィルタ"
                value={listFilter.status}
                onChange={(e) =>
                  setListFilter((prev) => ({ ...prev, status: e.target.value }))
                }
              >
                <option value="all">すべて</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </Select>
              <Select
                label="精算"
                aria-label="経費精算フィルタ"
                value={listFilter.settlementStatus}
                onChange={(e) =>
                  setListFilter((prev) => ({
                    ...prev,
                    settlementStatus: e.target
                      .value as ListFilterState['settlementStatus'],
                  }))
                }
              >
                <option value="all">すべて</option>
                <option value="unpaid">未払い</option>
                <option value="paid">支払済み</option>
              </Select>
              <Select
                label="領収書"
                aria-label="経費領収書フィルタ"
                value={listFilter.receipt}
                onChange={(e) =>
                  setListFilter((prev) => ({
                    ...prev,
                    receipt: e.target.value as ListFilterState['receipt'],
                  }))
                }
              >
                <option value="all">すべて</option>
                <option value="with">登録あり</option>
                <option value="without">未登録</option>
              </Select>
              <Input
                label="支払日(開始)"
                aria-label="支払日開始"
                type="date"
                value={listFilter.paidFrom}
                onChange={(e) =>
                  setListFilter((prev) => ({
                    ...prev,
                    paidFrom: e.target.value,
                  }))
                }
              />
              <Input
                label="支払日(終了)"
                aria-label="支払日終了"
                type="date"
                value={listFilter.paidTo}
                onChange={(e) =>
                  setListFilter((prev) => ({ ...prev, paidTo: e.target.value }))
                }
              />
            </div>
          </FilterBar>
        }
        table={listContent}
      />

      {message && (
        <Toast
          variant={message.type}
          title={message.type === 'error' ? 'エラー' : '完了'}
          description={message.text}
          dismissible
          onClose={() => setMessage(null)}
        />
      )}
      <Drawer
        open={Boolean(annotationTarget)}
        onClose={() => setAnnotationTarget(null)}
        title={annotationTarget?.title || '注釈'}
        size="lg"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              variant="secondary"
              onClick={() => setAnnotationTarget(null)}
            >
              閉じる
            </Button>
          </div>
        }
      >
        {annotationTarget && (
          <AnnotationsCard
            targetKind={annotationTarget.kind}
            targetId={annotationTarget.id}
            projectId={annotationTarget.projectId}
            title={annotationTarget.title}
          />
        )}
      </Drawer>
      <Dialog
        open={Boolean(markPaidTarget)}
        onClose={() => setMarkPaidTarget(null)}
        title="経費を支払済みに更新"
        size="small"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              variant="secondary"
              onClick={() => setMarkPaidTarget(null)}
              disabled={isSettlementUpdating}
            >
              キャンセル
            </Button>
            <Button
              onClick={() => void applyMarkPaid()}
              disabled={isSettlementUpdating}
            >
              支払済みにする
            </Button>
          </div>
        }
      >
        <div style={{ display: 'grid', gap: 8 }}>
          <p style={{ margin: 0 }}>
            {markPaidTarget
              ? `対象: ${markPaidTarget.incurredOn.slice(0, 10)} / ${markPaidTarget.category} / ${markPaidTarget.amount} ${markPaidTarget.currency}`
              : ''}
          </p>
          <label>
            支払日
            <input
              aria-label="支払日入力"
              type="date"
              value={markPaidDate}
              onChange={(e) => setMarkPaidDate(e.target.value)}
            />
          </label>
          <label>
            理由（任意）
            <input
              aria-label="支払更新理由"
              type="text"
              value={markPaidReason}
              onChange={(e) => setMarkPaidReason(e.target.value)}
              placeholder="任意"
            />
          </label>
        </div>
      </Dialog>
      <Dialog
        open={Boolean(unmarkPaidTarget)}
        onClose={() => setUnmarkPaidTarget(null)}
        title="経費の支払済みを取り消し"
        size="small"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              variant="secondary"
              onClick={() => setUnmarkPaidTarget(null)}
              disabled={isSettlementUpdating}
            >
              キャンセル
            </Button>
            <Button
              onClick={() => void applyUnmarkPaid()}
              disabled={isSettlementUpdating || !unmarkPaidReason.trim()}
            >
              支払取消
            </Button>
          </div>
        }
      >
        <div style={{ display: 'grid', gap: 8 }}>
          <p style={{ margin: 0 }}>
            {unmarkPaidTarget
              ? `対象: ${unmarkPaidTarget.incurredOn.slice(0, 10)} / ${unmarkPaidTarget.category} / ${unmarkPaidTarget.amount} ${unmarkPaidTarget.currency}`
              : ''}
          </p>
          <label>
            取消理由（必須）
            <input
              aria-label="支払取消理由"
              type="text"
              value={unmarkPaidReason}
              onChange={(e) => setUnmarkPaidReason(e.target.value)}
              placeholder="取消理由を入力してください"
            />
          </label>
        </div>
      </Dialog>
    </div>
  );
};
