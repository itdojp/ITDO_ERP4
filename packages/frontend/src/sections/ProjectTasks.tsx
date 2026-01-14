import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  projectId: projectId ?? '',
  name: '',
  status: '',
  parentTaskId: '',
});

const errorDetail = (err: unknown) => {
  if (err instanceof Error && err.message) {
    return ` (${err.message})`;
  }
  return '';
};

const notifyTasksChanged = (projectId: string) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('erp4:project-tasks-changed', { detail: { projectId } }),
  );
};

export const ProjectTasks: React.FC = () => {
  const auth = getAuthState();
  const [form, setForm] = useState(() =>
    buildInitialForm(auth?.projectIds?.[0]),
  );
  const [items, setItems] = useState<ProjectTask[]>([]);
  const [editing, setEditing] = useState<ProjectTask | null>(null);
  const [message, setMessage] = useState('');

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
  const taskMap = useMemo(
    () => new Map(items.map((task) => [task.id, task])),
    [items],
  );

  const renderProject = (projectId: string) => {
    const project = projectMap.get(projectId);
    return project ? `${project.code} / ${project.name}` : projectId;
  };

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!form.projectId) {
        setItems([]);
        if (!options?.silent) {
          setMessage('案件を選択してください');
        }
        return;
      }
      try {
        const res = await api<{ items: ProjectTask[] }>(
          `/projects/${form.projectId}/tasks`,
        );
        setItems(res.items || []);
        setMessage('読み込みました');
      } catch (err) {
        setItems([]);
        setMessage(`読み込みに失敗しました${errorDetail(err)}`);
      }
    },
    [form.projectId],
  );

  const resetForm = useCallback(() => {
    setForm((prev) => ({ ...buildInitialForm(prev.projectId) }));
    setEditing(null);
  }, []);

  useEffect(() => {
    void load({ silent: true });
  }, [load]);

  useEffect(() => {
    if (!editing) return;
    if (editing.projectId === form.projectId) return;
    setEditing(null);
    setForm((prev) => ({ ...prev, name: '', status: '', parentTaskId: '' }));
  }, [editing, form.projectId]);

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
    const parentTaskId = form.parentTaskId.trim();
    try {
      if (editing) {
        const updated = await api<ProjectTask>(
          `/projects/${form.projectId}/tasks/${editing.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              name,
              status: status || undefined,
              parentTaskId,
            }),
          },
        );
        setItems((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item)),
        );
        setMessage('更新しました');
        notifyTasksChanged(form.projectId);
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
            ...(parentTaskId ? { parentTaskId } : {}),
          }),
        },
      );
      setItems((prev) => [created, ...prev]);
      setMessage('作成しました');
      notifyTasksChanged(form.projectId);
      resetForm();
    } catch (err) {
      setMessage(`保存に失敗しました${errorDetail(err)}`);
    }
  };

  const startEdit = (item: ProjectTask) => {
    setEditing(item);
    setForm((prev) => ({
      ...prev,
      projectId: item.projectId,
      name: item.name,
      status: item.status || '',
      parentTaskId: item.parentTaskId || '',
    }));
  };

  const remove = async (item: ProjectTask) => {
    const reason = window.prompt('削除理由を入力してください');
    if (reason === null) {
      return;
    }
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setMessage('削除理由は必須です');
      return;
    }
    try {
      await api(`/projects/${item.projectId}/tasks/${item.id}/delete`, {
        method: 'POST',
        body: JSON.stringify({ reason: trimmedReason }),
      });
      setItems((prev) => prev.filter((task) => task.id !== item.id));
      setMessage('削除しました');
      notifyTasksChanged(item.projectId);
      if (editing?.id === item.id) {
        resetForm();
      }
    } catch (err) {
      setMessage(`削除に失敗しました${errorDetail(err)}`);
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
        <button className="button secondary" onClick={() => load()}>
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
          <select
            aria-label="親タスク選択"
            value={form.parentTaskId}
            onChange={(e) => setForm({ ...form, parentTaskId: e.target.value })}
          >
            <option value="">親なし</option>
            {items
              .filter((task) => task.id !== editing?.id)
              .map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
          </select>
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
        {items.map((item) => {
          const parent = item.parentTaskId
            ? taskMap.get(item.parentTaskId)
            : null;
          const parentLabel = item.parentTaskId
            ? parent?.name || item.parentTaskId
            : null;
          return (
            <li key={item.id}>
              <span className="badge">{item.status || 'open'}</span> {item.name}{' '}
              / {renderProject(item.projectId)}
              {parentLabel && ` / 親: ${parentLabel}`}
              <div style={{ marginTop: 6 }}>
                <button
                  className="button secondary"
                  style={{ marginRight: 8 }}
                  onClick={() => startEdit(item)}
                >
                  編集
                </button>
                <button
                  className="button secondary"
                  onClick={() => remove(item)}
                >
                  削除
                </button>
              </div>
            </li>
          );
        })}
        {items.length === 0 && <li>データなし</li>}
      </ul>
    </div>
  );
};
