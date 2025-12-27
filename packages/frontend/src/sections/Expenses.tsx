import React, { useEffect, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';

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
  const [items, setItems] = useState<Expense[]>([]);
  const [message, setMessage] = useState<MessageState>(null);
  const [form, setForm] = useState<FormState>({ ...defaultForm, projectId: defaultProjectId });
  const [isSaving, setIsSaving] = useState(false);
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const amountValue = Number.isFinite(form.amount) ? form.amount : 0;
  const amountError =
    amountValue <= 0
      ? '金額は1以上で入力してください'
      : amountValue > 10000000
        ? '金額が大きすぎます'
        : '';
  const baseValid = Boolean(form.projectId.trim()) && Boolean(form.category.trim()) && Boolean(form.incurredOn);
  const isValid = baseValid && !amountError;
  const validationHint = !baseValid ? 'Project ID / 区分 / 日付は必須です' : amountError;

  useEffect(() => {
    api<{ items: Expense[] }>('/expenses').then((res) => setItems(res.items)).catch(() => setItems([]));
  }, []);

  useEffect(() => {
    if (!message || message.type !== 'success') return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

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
    try {
      setIsSaving(true);
      const userId = getAuthState()?.userId || 'demo-user';
      await api('/expenses', {
        method: 'POST',
        body: JSON.stringify({
          projectId: form.projectId.trim(),
          userId,
          category: form.category.trim(),
          amount: form.amount,
          currency: form.currency.trim() || 'JPY',
          incurredOn: form.incurredOn,
          isShared: form.isShared,
          receiptUrl: form.receiptUrl.trim() || undefined,
        }),
      });
      setMessage({ text: '経費を保存しました', type: 'success' });
      const updated = await api<{ items: Expense[] }>('/expenses');
      setItems(updated.items);
      setForm({ ...defaultForm, projectId: defaultProjectId });
    } catch (e) {
      setMessage({ text: '保存に失敗しました', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <h2>経費入力</h2>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input type="text" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} placeholder="Project ID" />
          <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="区分" />
          <input
            type="number"
            min={1}
            max={10000000}
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
            style={{ width: 120 }}
          />
          <input type="text" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} placeholder="通貨" style={{ width: 80 }} />
          <input type="date" value={form.incurredOn} onChange={(e) => setForm({ ...form, incurredOn: e.target.value })} />
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
            type="text"
            value={form.receiptUrl}
            onChange={(e) => setForm({ ...form, receiptUrl: e.target.value })}
            placeholder="領収書URL (任意)"
            style={{ flex: 1 }}
          />
          <button className="button" onClick={add} disabled={!isValid || isSaving}>追加</button>
        </div>
        {validationHint && <p style={{ color: '#dc2626', margin: '8px 0 0' }}>{validationHint}</p>}
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="badge">領収書未登録: {missingReceiptCount}件</span>
        <button className="button secondary" onClick={() => setShowMissingOnly((prev) => !prev)}>
          {showMissingOnly ? '全件表示' : '未登録のみ表示'}
        </button>
      </div>
      <ul className="list">
        {visibleItems.map((item) => (
          <li key={item.id}>
            <span className="badge">{item.status}</span> {item.incurredOn.slice(0, 10)} / {item.projectId} / {item.category} / {item.amount} {item.currency}
            {item.isShared && <> / 共通</>}
            {item.receiptUrl ? (
              <> / <a href={item.receiptUrl} target="_blank" rel="noreferrer">領収書</a></>
            ) : (
              <> / <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>領収書未登録</span></>
            )}
          </li>
        ))}
        {visibleItems.length === 0 && <li>データなし</li>}
      </ul>
      {message && <p style={{ color: message.type === 'error' ? '#dc2626' : undefined }}>{message.text}</p>}
    </div>
  );
};
