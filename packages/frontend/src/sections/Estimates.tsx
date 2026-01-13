import React, { useCallback, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';
import { useProjects } from '../hooks/useProjects';
import { EstimateDetail } from './EstimateDetail';

interface Estimate {
  id: string;
  estimateNo?: string;
  projectId: string;
  totalAmount: unknown;
  currency: string;
  status: string;
  validUntil?: string | null;
  notes?: string | null;
  lines?: { description: string; quantity: unknown; unitPrice: unknown }[];
}

const buildInitialForm = (projectId?: string) => ({
  projectId: projectId ?? '',
  totalAmount: 100000,
  currency: 'JPY',
  validUntil: '',
  notes: '',
});

export const Estimates: React.FC = () => {
  const auth = getAuthState();
  const [form, setForm] = useState(() =>
    buildInitialForm(auth?.projectIds?.[0]),
  );
  const [items, setItems] = useState<Estimate[]>([]);
  const handleProjectSelect = useCallback((projectId: string) => {
    setForm((prev) => ({ ...prev, projectId }));
  }, []);
  const { projects, projectMessage } = useProjects({
    selectedProjectId: form.projectId,
    onSelect: handleProjectSelect,
  });
  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const [selected, setSelected] = useState<Estimate | null>(null);
  const [message, setMessage] = useState('');

  const updateItem = useCallback((updated: Estimate) => {
    setItems((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item)),
    );
    setSelected((prev) => (prev?.id === updated.id ? updated : prev));
  }, []);

  const create = async () => {
    if (!form.projectId) {
      setMessage('案件を選択してください');
      return;
    }
    try {
      const res = await api<{ number: string; estimate: Estimate }>(
        `/projects/${form.projectId}/estimates`,
        {
          method: 'POST',
          body: JSON.stringify({
            totalAmount: form.totalAmount,
            currency: form.currency,
            validUntil: form.validUntil || undefined,
            notes: form.notes || undefined,
            lines: [
              {
                description: '作業費',
                quantity: 1,
                unitPrice: form.totalAmount,
              },
            ],
          }),
        },
      );
      setMessage('作成しました');
      setItems((prev) => [...prev, res.estimate]);
    } catch (e) {
      setMessage('作成に失敗');
    }
  };

  const load = async () => {
    if (!form.projectId) {
      setMessage('案件を選択してください');
      return;
    }
    try {
      const res = await api<{ items: Estimate[] }>(
        `/projects/${form.projectId}/estimates`,
      );
      setItems(res.items);
      setMessage('読み込みました');
    } catch (e) {
      setMessage('読み込みに失敗');
    }
  };

  const submit = async (id: string) => {
    try {
      const updated = await api<Estimate>(`/estimates/${id}/submit`, {
        method: 'POST',
      });
      updateItem(updated);
      setMessage('承認依頼しました');
    } catch (e) {
      setMessage('承認依頼に失敗');
    }
  };

  const send = async (id: string) => {
    try {
      const updated = await api<Estimate>(`/estimates/${id}/send`, {
        method: 'POST',
      });
      updateItem(updated);
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
    if (status === 'approved' || status === 'sent')
      return { step: 2, total: 2, status: 'approved' };
    return { step: 0, total: 2, status: 'draft' };
  };

  const renderProject = (projectId: string) => {
    const project = projectMap.get(projectId);
    return project ? `${project.code} / ${project.name}` : projectId;
  };

  return (
    <div>
      <h2>見積</h2>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
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
        <select
          aria-label="通貨"
          value={form.currency}
          onChange={(e) => setForm({ ...form, currency: e.target.value })}
        >
          <option value="JPY">JPY</option>
          <option value="USD">USD</option>
        </select>
        <input
          aria-label="有効期限"
          type="date"
          value={form.validUntil}
          onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
        />
        <input
          aria-label="備考"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="備考"
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
            <span className="badge">{d.status}</span>{' '}
            {d.estimateNo || '(draft)'} / {renderProject(d.projectId)} /{' '}
            {String(d.totalAmount)} {d.currency}
            <div>
              <button
                className="button secondary"
                style={{ marginRight: 8 }}
                onClick={() => setSelected(d)}
              >
                詳細
              </button>
              <button
                className="button secondary"
                style={{ marginRight: 8 }}
                onClick={() => submit(d.id)}
                disabled={d.status !== 'draft'}
              >
                承認依頼
              </button>
              <button
                className="button"
                onClick={() => send(d.id)}
                disabled={d.status !== 'approved' && d.status !== 'sent'}
              >
                送信 (Stub)
              </button>
            </div>
          </li>
        ))}
        {items.length === 0 && <li>データなし</li>}
      </ul>
      {selected && (
        <div className="card">
          <EstimateDetail
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
