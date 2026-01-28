import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';
import { AnnotationsCard } from '../components/AnnotationsCard';
import { useProjects } from '../hooks/useProjects';
import { Button, Dialog } from '../ui';
import { enqueueOfflineItem, isOfflineError } from '../utils/offlineQueue';

type Expense = {
  id: string;
  projectId: string;
  category: string;
  amount: number;
  currency: string;
  incurredOn: string;
  status: string;
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

const defaultForm: FormState = {
  projectId: 'demo-project',
  category: '交通費',
  amount: 1000,
  currency: 'JPY',
  incurredOn: new Date().toISOString().slice(0, 10),
  isShared: false,
  receiptUrl: '',
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
  const [showMissingOnly, setShowMissingOnly] = useState(false);
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

  useEffect(() => {
    api<{ items: Expense[] }>('/expenses')
      .then((res) => setItems(res.items))
      .catch(() => setItems([]));
  }, []);

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
  const visibleItems = showMissingOnly
    ? items.filter((item) => !item.receiptUrl)
    : items;

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
        const updated = await api<{ items: Expense[] }>('/expenses');
        setItems(updated.items);
      } catch (e) {
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
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="badge">領収書未登録: {missingReceiptCount}件</span>
        <button
          className="button secondary"
          onClick={() => setShowMissingOnly((prev) => !prev)}
        >
          {showMissingOnly ? '全件表示' : '未登録のみ表示'}
        </button>
      </div>
      <ul className="list">
        {visibleItems.map((item) => (
          <li key={item.id}>
            <span className="badge">{item.status}</span>{' '}
            {item.incurredOn.slice(0, 10)} / {renderProject(item.projectId)} /{' '}
            {item.category} / {item.amount} {item.currency}
            {item.isShared && <> / 共通</>}
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
      <Dialog
        open={Boolean(annotationTarget)}
        onClose={() => setAnnotationTarget(null)}
        title={annotationTarget?.title || '注釈'}
        size="large"
        footer={
          <Button variant="secondary" onClick={() => setAnnotationTarget(null)}>
            閉じる
          </Button>
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
      </Dialog>
    </div>
  );
};
