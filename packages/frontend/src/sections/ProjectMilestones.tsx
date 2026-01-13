import React, { useCallback, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';
import { useProjects } from '../hooks/useProjects';

type Milestone = {
  id: string;
  projectId: string;
  name: string;
  amount: unknown;
  billUpon: string;
  dueDate?: string | null;
  taxRate?: unknown | null;
};

type DeliveryDueItem = {
  milestoneId: string;
  projectId: string;
  projectCode?: string | null;
  projectName?: string | null;
  name?: string | null;
  amount: unknown;
  dueDate?: string | null;
  invoiceCount: number;
};

const buildInitialForm = (projectId?: string) => ({
  projectId: projectId || 'demo-project',
  name: '',
  amount: 100000,
  billUpon: 'date',
  dueDate: '',
  taxRate: '',
});

export const ProjectMilestones: React.FC = () => {
  const auth = getAuthState();
  const [form, setForm] = useState(() =>
    buildInitialForm(auth?.projectIds?.[0]),
  );
  const [items, setItems] = useState<Milestone[]>([]);
  const [editing, setEditing] = useState<Milestone | null>(null);
  const [message, setMessage] = useState('');

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

  const renderProject = (projectId: string) => {
    const project = projectMap.get(projectId);
    return project ? `${project.code} / ${project.name}` : projectId;
  };

  const load = async () => {
    try {
      const res = await api<{ items: Milestone[] }>(
        `/projects/${form.projectId}/milestones`,
      );
      setItems(res.items || []);
      setMessage('読み込みました');
    } catch (err) {
      setMessage('読み込みに失敗');
    }
  };

  const resetForm = () => {
    setForm((prev) => ({
      ...buildInitialForm(prev.projectId),
    }));
    setEditing(null);
  };

  const save = async () => {
    if (!form.projectId) {
      setMessage('案件を選択してください');
      return;
    }
    if (!form.name.trim()) {
      setMessage('名称は必須です');
      return;
    }
    try {
      if (editing) {
        const updated = await api<Milestone>(
          `/projects/${form.projectId}/milestones/${editing.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              name: form.name,
              amount: form.amount,
              billUpon: form.billUpon,
              dueDate: form.dueDate || undefined,
              taxRate: form.taxRate ? Number(form.taxRate) : undefined,
            }),
          },
        );
        setItems((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item)),
        );
        setMessage('更新しました');
        resetForm();
        return;
      }

      const created = await api<Milestone>(
        `/projects/${form.projectId}/milestones`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: form.name,
            amount: form.amount,
            billUpon: form.billUpon,
            dueDate: form.dueDate || undefined,
            taxRate: form.taxRate ? Number(form.taxRate) : undefined,
          }),
        },
      );
      setItems((prev) => [created, ...prev]);
      setMessage('作成しました');
      resetForm();
    } catch (err) {
      setMessage('保存に失敗');
    }
  };

  const startEdit = (item: Milestone) => {
    setEditing(item);
    setForm((prev) => ({
      ...prev,
      projectId: item.projectId,
      name: item.name,
      amount: Number(item.amount),
      billUpon: item.billUpon || 'date',
      dueDate: item.dueDate ? item.dueDate.slice(0, 10) : '',
      taxRate: item.taxRate != null ? String(item.taxRate) : '',
    }));
  };

  const remove = async (item: Milestone) => {
    const reason = window.prompt('削除理由を入力してください');
    if (!reason) return;
    try {
      await api(`/projects/${item.projectId}/milestones/${item.id}/delete`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      setItems((prev) => prev.filter((m) => m.id !== item.id));
      setMessage('削除しました');
      if (editing?.id === item.id) {
        resetForm();
      }
    } catch (err) {
      setMessage('削除に失敗');
    }
  };

  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [deliveryDueItems, setDeliveryDueItems] = useState<DeliveryDueItem[]>(
    [],
  );
  const [deliveryDueMessage, setDeliveryDueMessage] = useState('');

  const loadDeliveryDue = async () => {
    try {
      const params = new URLSearchParams();
      if (dueFrom) params.set('from', dueFrom);
      if (dueTo) params.set('to', dueTo);
      if (form.projectId) params.set('projectId', form.projectId);
      const qs = params.toString();
      const res = await api<{ items: DeliveryDueItem[] }>(
        `/reports/delivery-due${qs ? `?${qs}` : ''}`,
      );
      setDeliveryDueItems(res.items || []);
      setDeliveryDueMessage('取得しました');
    } catch (err) {
      setDeliveryDueItems([]);
      setDeliveryDueMessage('取得に失敗');
    }
  };

  return (
    <div>
      <h2>マイルストーン</h2>
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
        <button className="button secondary" onClick={load}>
          読み込み
        </button>
      </div>
      {projectMessage && <p style={{ color: '#dc2626' }}>{projectMessage}</p>}
      {message && <p>{message}</p>}

      <div className="card" style={{ marginTop: 12, padding: 12 }}>
        <strong>{editing ? '編集' : '新規作成'}</strong>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <input
            aria-label="名称"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="名称"
          />
          <input
            aria-label="金額"
            type="number"
            value={form.amount}
            onChange={(e) =>
              setForm({ ...form, amount: Number(e.target.value) })
            }
            placeholder="金額"
          />
          <select
            aria-label="請求タイミング"
            value={form.billUpon}
            onChange={(e) => setForm({ ...form, billUpon: e.target.value })}
          >
            <option value="date">日付</option>
            <option value="acceptance">検収</option>
            <option value="time">工数</option>
          </select>
          <input
            aria-label="納期"
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
          />
          <input
            aria-label="税率"
            type="number"
            value={form.taxRate}
            onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
            placeholder="税率(例:0.1)"
            step="0.01"
          />
          <button className="button" onClick={save}>
            {editing ? '更新' : '作成'}
          </button>
          {editing && (
            <button className="button secondary" onClick={resetForm}>
              キャンセル
            </button>
          )}
        </div>
      </div>

      <ul className="list" style={{ marginTop: 12 }}>
        {items.map((item) => (
          <li key={item.id}>
            <span className="badge">{item.billUpon}</span> {item.name} /{' '}
            {renderProject(item.projectId)} / {String(item.amount)} / due:{' '}
            {item.dueDate ? item.dueDate.slice(0, 10) : '-'}
            <div style={{ marginTop: 6 }}>
              <button
                className="button secondary"
                style={{ marginRight: 8 }}
                onClick={() => startEdit(item)}
              >
                編集
              </button>
              <button className="button secondary" onClick={() => remove(item)}>
                削除
              </button>
            </div>
          </li>
        ))}
        {items.length === 0 && <li>データなし</li>}
      </ul>

      <div className="card" style={{ marginTop: 12, padding: 12 }}>
        <strong>未請求（納期範囲）レポート</strong>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <input
            aria-label="from"
            type="date"
            value={dueFrom}
            onChange={(e) => setDueFrom(e.target.value)}
          />
          <input
            aria-label="to"
            type="date"
            value={dueTo}
            onChange={(e) => setDueTo(e.target.value)}
          />
          <button className="button secondary" onClick={loadDeliveryDue}>
            取得
          </button>
        </div>
        {deliveryDueMessage && <p>{deliveryDueMessage}</p>}
        <ul className="list">
          {deliveryDueItems.map((item) => (
            <li key={item.milestoneId}>
              {item.projectCode || item.projectId} / {item.name || ''} / due:{' '}
              {item.dueDate ? item.dueDate.slice(0, 10) : '-'} / amount:{' '}
              {String(item.amount)} / invoices:{item.invoiceCount}
            </li>
          ))}
          {deliveryDueItems.length === 0 && <li>該当なし</li>}
        </ul>
      </div>
    </div>
  );
};
