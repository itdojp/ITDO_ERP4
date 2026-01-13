import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';
import { InvoiceDetail } from './InvoiceDetail';
import { useProjects } from '../hooks/useProjects';

interface Invoice {
  id: string;
  invoiceNo?: string;
  projectId: string;
  totalAmount: number;
  status: string;
  lines?: { description: string; quantity: number; unitPrice: number }[];
}

type InvoiceFromTimeEntriesResponse = {
  invoice: Invoice;
  meta?: { timeEntryCount?: number };
};

const buildInitialForm = (projectId?: string) => ({
  projectId: projectId || 'demo-project',
  totalAmount: 100000,
});

function formatDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const Invoices: React.FC = () => {
  const auth = getAuthState();
  const [form, setForm] = useState(() =>
    buildInitialForm(auth?.projectIds?.[0]),
  );
  const [timeFrom, setTimeFrom] = useState(() => {
    const now = new Date();
    return formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  const [timeTo, setTimeTo] = useState(() => formatDateInput(new Date()));
  const [timeUnitPrice, setTimeUnitPrice] = useState(10000);
  const [items, setItems] = useState<Invoice[]>([]);
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
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [message, setMessage] = useState('');

  const create = async () => {
    try {
      const res = await api<Invoice>(`/projects/${form.projectId}/invoices`, {
        method: 'POST',
        body: JSON.stringify({
          totalAmount: form.totalAmount,
          currency: 'JPY',
          lines: [
            { description: '作業費', quantity: 1, unitPrice: form.totalAmount },
          ],
        }),
      });
      setMessage('作成しました');
      setItems((prev) => [...prev, res]);
    } catch (e) {
      setMessage('作成に失敗');
    }
  };

  const load = async () => {
    try {
      const res = await api<{ items: Invoice[] }>(
        `/projects/${form.projectId}/invoices`,
      );
      setItems(res.items);
      setMessage('読み込みました');
    } catch (e) {
      setMessage('読み込みに失敗');
    }
  };

  const createFromTimeEntries = async () => {
    try {
      const res = await api<InvoiceFromTimeEntriesResponse>(
        `/projects/${form.projectId}/invoices/from-time-entries`,
        {
          method: 'POST',
          body: JSON.stringify({
            from: timeFrom,
            to: timeTo,
            unitPrice: timeUnitPrice,
            currency: 'JPY',
          }),
        },
      );
      setMessage(
        `工数${res.meta?.timeEntryCount ?? 0}件からドラフトを作成しました`,
      );
      setItems((prev) => [res.invoice, ...prev]);
    } catch (e) {
      setMessage('工数からの作成に失敗');
    }
  };

  const releaseTimeEntries = async (id: string) => {
    try {
      const res = await api<{ released: number }>(
        `/invoices/${id}/release-time-entries`,
        { method: 'POST' },
      );
      setMessage(`工数リンクを解除しました (${res.released}件)`);
    } catch (e) {
      setMessage('工数リンクの解除に失敗');
    }
  };

  const send = async (id: string) => {
    try {
      await api(`/invoices/${id}/send`, { method: 'POST' });
      setMessage('送信しました');
    } catch (e) {
      setMessage('送信失敗');
    }
  };

  const buildApproval = (status: string) => {
    if (status === 'pending_exec')
      return { step: 2, total: 2, status: 'pending_exec' };
    if (status === 'pending_qa')
      return { step: 1, total: 2, status: 'pending_qa' };
    if (status === 'approved' || status === 'sent' || status === 'paid')
      return { step: 2, total: 2, status: 'approved' };
    return { step: 0, total: 2, status: 'draft' };
  };

  const renderProject = (projectId: string) => {
    const project = projectMap.get(projectId);
    return project ? `${project.code} / ${project.name}` : projectId;
  };

  return (
    <div>
      <h2>請求</h2>
      <div className="row" style={{ gap: 8 }}>
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
          type="number"
          value={form.totalAmount}
          onChange={(e) =>
            setForm({ ...form, totalAmount: Number(e.target.value) })
          }
          placeholder="金額"
        />
        <button className="button" onClick={create}>
          作成
        </button>
        <button className="button secondary" onClick={load}>
          読み込み
        </button>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>工数から請求ドラフト作成</h3>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="row" style={{ gap: 6, alignItems: 'center' }}>
            <span>期間</span>
            <input
              aria-label="工数集計開始日"
              type="date"
              value={timeFrom}
              onChange={(e) => setTimeFrom(e.target.value)}
            />
            <span>〜</span>
            <input
              aria-label="工数集計終了日"
              type="date"
              value={timeTo}
              onChange={(e) => setTimeTo(e.target.value)}
            />
          </label>
          <label className="row" style={{ gap: 6, alignItems: 'center' }}>
            <span>単価(円/時)</span>
            <input
              aria-label="請求単価"
              type="number"
              value={timeUnitPrice}
              onChange={(e) => setTimeUnitPrice(Number(e.target.value))}
              min={1}
            />
          </label>
          <button className="button" onClick={createFromTimeEntries}>
            工数から作成
          </button>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: '#6b7280' }}>
          注意: 対象工数は請求に紐づけられ、解除するまで編集/付け替えできません。
        </p>
      </div>
      {projectMessage && <p style={{ color: '#dc2626' }}>{projectMessage}</p>}
      {message && <p>{message}</p>}
      <ul className="list">
        {items.map((d) => (
          <li key={d.id}>
            <span className="badge">{d.status}</span> {d.invoiceNo || '(draft)'}{' '}
            / {renderProject(d.projectId)} / ¥
            {(d.totalAmount || 0).toLocaleString()}
            <div>
              <button
                className="button secondary"
                style={{ marginRight: 8 }}
                onClick={() => setSelected(d)}
              >
                詳細
              </button>
              <button className="button" onClick={() => send(d.id)}>
                送信 (Stub)
              </button>
            </div>
          </li>
        ))}
        {items.length === 0 && <li>データなし</li>}
      </ul>
      {selected && (
        <div className="card">
          <InvoiceDetail
            {...selected}
            approval={buildApproval(selected.status)}
            onSend={() => send(selected.id)}
          />
          {selected.status === 'draft' && (
            <button
              className="button secondary"
              style={{ marginTop: 8 }}
              onClick={() => releaseTimeEntries(selected.id)}
            >
              工数リンク解除
            </button>
          )}
          <button
            className="button secondary"
            onClick={() => setSelected(null)}
          >
            閉じる
          </button>
        </div>
      )}
    </div>
  );
};
