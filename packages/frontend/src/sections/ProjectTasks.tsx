import React, { useCallback, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';
import { useProjects } from '../hooks/useProjects';

type ProjectTask = {
  id: string;
  projectId: string;
  name: string;
  status?: string | null;
  parentTaskId?: string | null;
  assigneeId?: string | null;
};

const buildInitialForm = (projectId?: string) => ({
  projectId: projectId || 'demo-project',
  name: '',
  status: '',
});

export const ProjectTasks: React.FC = () => {
  const auth = getAuthState();
  const [form, setForm] = useState(() =>
    buildInitialForm(auth?.projectIds?.[0]),
  );
  const [items, setItems] = useState<ProjectTask[]>([]);
  const [editing, setEditing] = useState<ProjectTask | null>(null);
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
      const res = await api<{ items: ProjectTask[] }>(
        `/projects/${form.projectId}/tasks`,
      );
      setItems(res.items || []);
      setMessage('読み込みました');
    } catch (err) {
      setItems([]);
      setMessage('読み込みに失敗');
    }
  };

  const resetForm = useCallback(() => {
    setForm((prev) => ({ ...buildInitialForm(prev.projectId) }));
    setEditing(null);
  }, []);

  const save = async () => {
    if (!form.projectId) {
      setMessage('案件を選択してください');
      return;
    }
    const name = form.name.trim();
    if (!name) {
      setMessage('タスク名は必須です');
      return;
    }
    const status = form.status.trim();
    try {
      if (editing) {
        const updated = await api<ProjectTask>(
          `/projects/${form.projectId}/tasks/${editing.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              name,
              status: status || undefined,
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
      const created = await api<ProjectTask>(
        `/projects/${form.projectId}/tasks`,
        {
          method: 'POST',
          body: JSON.stringify({
            name,
            status: status || undefined,
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

  const startEdit = (item: ProjectTask) => {
    setEditing(item);
    setForm((prev) => ({
      ...prev,
      projectId: item.projectId,
      name: item.name,
      status: item.status || '',
    }));
  };

  const remove = async (item: ProjectTask) => {
    const reason = window.prompt('削除理由を入力してください');
    if (!reason) return;
    try {
      await api(`/projects/${item.projectId}/tasks/${item.id}/delete`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      setItems((prev) => prev.filter((task) => task.id !== item.id));
      setMessage('削除しました');
      if (editing?.id === item.id) {
        resetForm();
      }
    } catch (err) {
      setMessage('削除に失敗');
    }
  };

  return (
    <div>
      <h2>タスク</h2>
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
            aria-label="タスク名"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="タスク名"
          />
          <input
            aria-label="ステータス"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            placeholder="ステータス（任意）"
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
            <span className="badge">{item.status || 'open'}</span> {item.name} /{' '}
            {renderProject(item.projectId)}
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
    </div>
  );
};
