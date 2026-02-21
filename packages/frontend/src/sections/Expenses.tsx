import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';
import { AnnotationsCard } from '../components/AnnotationsCard';
import { useProjects } from '../hooks/useProjects';
import { Button, Dialog, Drawer } from '../ui';
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
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!message || message.type !== 'success') return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const renderProject = (projectId: string) => {
    const project = projectMap.get(projectId);
    return project ? `${project.code} / ${project.name}` : projectId;
  };

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
            if (to && paidAt > to) return false;
          }
        }
        return true;
      }),
    [items, listFilter, showMissingOnly],
  );

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
    <div>
      <h2>経費入力</h2>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <select
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
          </select>
          <input
            type="text"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="区分"
          />
          <input
            type="number"
            min={1}
            max={10000000}
            value={form.amount}
            onChange={(e) =>
              setForm({ ...form, amount: Number(e.target.value) })
            }
            style={{ width: 120 }}
          />
          <input
            type="text"
            value={form.currency}
            onChange={(e) => {
              const value = e.target.value.toUpperCase().slice(0, 3);
              setForm({ ...form, currency: value });
            }}
            placeholder="通貨"
            style={{ width: 80 }}
            maxLength={3}
            pattern="[A-Z]{3}"
          />
          <input
            type="date"
            value={form.incurredOn}
            onChange={(e) => setForm({ ...form, incurredOn: e.target.value })}
          />
          <label className="badge" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.isShared}
              onChange={(e) => setForm({ ...form, isShared: e.target.checked })}
              style={{ marginRight: 6 }}
            />
            共通経費
          </label>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <input
            type="url"
            value={form.receiptUrl}
            onChange={(e) => setForm({ ...form, receiptUrl: e.target.value })}
            placeholder="領収書URL (任意)"
            style={{ flex: 1 }}
          />
          <button
            className="button"
            onClick={add}
            disabled={!isValid || isSaving}
          >
            追加
          </button>
        </div>
        {validationHint && (
          <p style={{ color: '#dc2626', margin: '8px 0 0' }}>
            {validationHint}
          </p>
        )}
        {projectMessage && (
          <p style={{ color: '#dc2626', margin: '8px 0 0' }}>
            {projectMessage}
          </p>
        )}
      </div>
      <div
        className="row"
        style={{ marginBottom: 8, gap: 8, flexWrap: 'wrap' }}
      >
        <span className="badge">領収書未登録: {missingReceiptCount}件</span>
        <button
          className="button secondary"
          onClick={() => setShowMissingOnly((prev) => !prev)}
        >
          {showMissingOnly ? '全件表示' : '未登録のみ表示'}
        </button>
        <button className="button secondary" onClick={() => void loadItems()}>
          再読み込み
        </button>
      </div>
      <div
        className="row"
        style={{ marginBottom: 8, gap: 8, flexWrap: 'wrap', alignItems: 'end' }}
      >
        <label>
          状態
          <select
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
          </select>
        </label>
        <label>
          精算
          <select
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
          </select>
        </label>
        <label>
          領収書
          <select
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
          </select>
        </label>
        <label>
          支払日(開始)
          <input
            aria-label="支払日開始"
            type="date"
            value={listFilter.paidFrom}
            onChange={(e) =>
              setListFilter((prev) => ({ ...prev, paidFrom: e.target.value }))
            }
          />
        </label>
        <label>
          支払日(終了)
          <input
            aria-label="支払日終了"
            type="date"
            value={listFilter.paidTo}
            onChange={(e) =>
              setListFilter((prev) => ({ ...prev, paidTo: e.target.value }))
            }
          />
        </label>
        <button
          className="button secondary"
          onClick={() => setListFilter(defaultListFilter)}
        >
          条件クリア
        </button>
      </div>
      <ul className="list">
        {visibleItems.map((item) => (
          <li key={item.id}>
            <span className="badge">{item.status}</span>{' '}
            <span className="badge">
              {item.settlementStatus === 'paid' ? '支払済み' : '未払い'}
            </span>{' '}
            {item.incurredOn.slice(0, 10)} / {renderProject(item.projectId)} /{' '}
            {item.category} / {item.amount} {item.currency}
            {item.isShared && <> / 共通</>}
            {item.paidAt ? <> / 支払日: {item.paidAt.slice(0, 10)}</> : null}
            {item.receiptUrl ? (
              <>
                {' '}
                /{' '}
                <a
                  href={item.receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  領収書
                </a>
              </>
            ) : (
              <>
                {' '}
                /{' '}
                <span
                  className="badge"
                  style={{ background: '#fee2e2', color: '#991b1b' }}
                >
                  領収書未登録
                </span>
              </>
            )}
            <div style={{ marginTop: 6 }}>
              <button
                className="button secondary"
                aria-label={`注釈（経費）: ${item.incurredOn.slice(0, 10)} ${item.category} ${item.amount} ${item.currency}`}
                onClick={() =>
                  setAnnotationTarget({
                    kind: 'expense',
                    id: item.id,
                    projectId: item.projectId,
                    title: `経費: ${item.incurredOn.slice(0, 10)} / ${item.category}`,
                  })
                }
              >
                注釈
              </button>
              {canManageSettlement &&
                item.status === 'approved' &&
                item.settlementStatus !== 'paid' && (
                  <button
                    className="button secondary"
                    style={{ marginLeft: 8 }}
                    onClick={() => {
                      setMarkPaidTarget(item);
                      setMarkPaidDate(new Date().toISOString().slice(0, 10));
                      setMarkPaidReason('');
                    }}
                  >
                    支払済みにする
                  </button>
                )}
              {canManageSettlement && item.settlementStatus === 'paid' && (
                <button
                  className="button secondary"
                  style={{ marginLeft: 8 }}
                  onClick={() => {
                    setUnmarkPaidTarget(item);
                    setUnmarkPaidReason('');
                  }}
                >
                  支払取消
                </button>
              )}
            </div>
          </li>
        ))}
        {visibleItems.length === 0 && <li>データなし</li>}
      </ul>
      {message && (
        <p style={{ color: message.type === 'error' ? '#dc2626' : undefined }}>
          {message.text}
        </p>
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
