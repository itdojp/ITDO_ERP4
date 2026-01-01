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

const buildInitialForm = (projectId?: string) => ({
  projectId: projectId || 'demo-project',
  totalAmount: 100000,
});

export const Invoices: React.FC = () => {
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
  const auth = getAuthState();
  const [form, setForm] = useState(() =>
    buildInitialForm(auth?.projectIds?.[0]),
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
