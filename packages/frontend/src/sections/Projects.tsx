import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type Project = {
  id: string;
  code: string;
  name: string;
  status: string;
  customerId?: string | null;
};

type Customer = {
  id: string;
  code: string;
  name: string;
};

const emptyProject = {
  code: '',
  name: '',
  status: 'draft',
  customerId: '',
};

const statusOptions = [
  { value: 'draft', label: '起案中' },
  { value: 'active', label: '進行中' },
  { value: 'on_hold', label: '保留' },
  { value: 'closed', label: '完了' },
];

const errorDetail = (err: unknown) => {
  if (err instanceof Error && err.message) {
    return ` (${err.message})`;
  }
  return '';
};

export const Projects: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState(emptyProject);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const customerMap = useMemo(() => {
    return new Map(customers.map((item) => [item.id, item]));
  }, [customers]);

  const projectPayload = useMemo(() => {
    return {
      code: form.code.trim(),
      name: form.name.trim(),
      status: form.status || 'draft',
      customerId: form.customerId || undefined,
    };
  }, [form]);

  const loadProjects = useCallback(async () => {
    try {
      const res = await api<{ items: Project[] }>('/projects');
      setProjects(res.items || []);
    } catch (err) {
      console.error('Failed to load projects.', err);
      setProjects([]);
      setMessage(`案件一覧の取得に失敗しました${errorDetail(err)}`);
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    try {
      const res = await api<{ items: Customer[] }>('/customers');
      setCustomers(res.items || []);
    } catch (err) {
      console.error('Failed to load customers.', err);
      setCustomers([]);
      setMessage(`顧客一覧の取得に失敗しました${errorDetail(err)}`);
    }
  }, []);

  const saveProject = async () => {
    if (!projectPayload.code || !projectPayload.name) {
      setMessage('コードと名称は必須です');
      return;
    }
    try {
      if (editingProjectId) {
        await api(`/projects/${editingProjectId}`, {
          method: 'PATCH',
          body: JSON.stringify(projectPayload),
        });
        setMessage('案件を更新しました');
      } else {
        await api('/projects', {
          method: 'POST',
          body: JSON.stringify(projectPayload),
        });
        setMessage('案件を追加しました');
      }
      setForm(emptyProject);
      setEditingProjectId(null);
      loadProjects();
    } catch (err) {
      console.error('Failed to save project.', err);
      setMessage(`案件の保存に失敗しました${errorDetail(err)}`);
    }
  };

  const editProject = (item: Project) => {
    setEditingProjectId(item.id);
    setForm({
      code: item.code || '',
      name: item.name || '',
      status: item.status || 'draft',
      customerId: item.customerId || '',
    });
  };

  const resetProject = () => {
    setForm(emptyProject);
    setEditingProjectId(null);
  };

  useEffect(() => {
    loadProjects();
    loadCustomers();
  }, [loadProjects, loadCustomers]);

  return (
    <div>
      <h2>案件</h2>
      <div className="row">
        <input
          type="text"
          placeholder="コード"
          aria-label="案件コード"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
        />
        <input
          type="text"
          placeholder="名称"
          aria-label="案件名称"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <select
          aria-label="案件ステータス"
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <select
          aria-label="顧客選択"
          value={form.customerId}
          onChange={(e) => setForm({ ...form, customerId: e.target.value })}
        >
          <option value="">顧客未設定</option>
          {customers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} / {item.name}
            </option>
          ))}
        </select>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="button" onClick={saveProject}>
          {editingProjectId ? '更新' : '追加'}
        </button>
        <button className="button secondary" onClick={resetProject}>
          クリア
        </button>
        <button className="button secondary" onClick={loadProjects}>
          再読込
        </button>
      </div>
      {message && <p>{message}</p>}
      <ul className="list">
        {projects.map((item) => {
          const customer = item.customerId
            ? customerMap.get(item.customerId)
            : undefined;
          return (
            <li key={item.id}>
              <span className="badge">{item.status}</span> {item.code} /{' '}
              {item.name}
              {customer && ` / ${customer.code} ${customer.name}`}
              <button
                className="button secondary"
                style={{ marginLeft: 8 }}
                onClick={() => editProject(item)}
              >
                編集
              </button>
            </li>
          );
        })}
        {projects.length === 0 && <li>データなし</li>}
      </ul>
    </div>
  );
};
