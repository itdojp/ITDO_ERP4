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
  planStart?: string | null;
  planEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
};

const buildInitialForm = (projectId?: string) => ({
  projectId: projectId ?? '',
  name: '',
  status: '',
  parentTaskId: '',
  predecessorIds: [] as string[],
  planStart: '',
  planEnd: '',
  actualStart: '',
  actualEnd: '',
  reasonText: '',
});

const errorDetail = (err: unknown) => {
  if (err instanceof Error && err.message) {
    return ` (${err.message})`;
  }
  return '';
};

const toDateInput = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
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
  const [editingOriginalParentTaskId, setEditingOriginalParentTaskId] =
    useState<string | null>(null);
  const [message, setMessage] = useState('');
  const isPrivileged = (auth?.roles ?? []).some((role) =>
    ['admin', 'mgmt'].includes(role),
  );

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

  const trimmedParentTaskId = form.parentTaskId.trim();
  const nextParentTaskId =
    trimmedParentTaskId.length > 0 ? trimmedParentTaskId : null;
  const parentChanged =
    editing !== null &&
    nextParentTaskId !== (editingOriginalParentTaskId ?? null);
  const trimmedReasonText = form.reasonText.trim();

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

  const loadDependencies = useCallback(
    async (projectId: string, taskId: string) => {
      try {
        const res = await api<{ predecessorIds?: string[] }>(
          `/projects/${projectId}/tasks/${taskId}/dependencies`,
        );
        setForm((prev) => ({
          ...prev,
          predecessorIds: Array.isArray(res.predecessorIds)
            ? res.predecessorIds
            : [],
        }));
      } catch (err) {
        setMessage(`依存関係の読み込みに失敗しました${errorDetail(err)}`);
      }
    },
    [],
  );

  const resetForm = useCallback(() => {
    setForm((prev) => ({ ...buildInitialForm(prev.projectId) }));
    setEditing(null);
    setEditingOriginalParentTaskId(null);
  }, []);

  useEffect(() => {
    void load({ silent: true });
  }, [load]);

  useEffect(() => {
    if (!editing) return;
    if (editing.projectId === form.projectId) return;
    setEditing(null);
    setEditingOriginalParentTaskId(null);
    setForm((prev) => ({
      ...prev,
      name: '',
      status: '',
      parentTaskId: '',
      predecessorIds: [],
      planStart: '',
      planEnd: '',
      actualStart: '',
      actualEnd: '',
      reasonText: '',
    }));
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
    const parentTaskId = trimmedParentTaskId;
    if (editing && parentChanged && !trimmedReasonText) {
      setMessage('親タスクを変更する場合は理由を入力してください');
      return;
    }
    const planStart = form.planStart.trim();
    const planEnd = form.planEnd.trim();
    const actualStart = form.actualStart.trim();
    const actualEnd = form.actualEnd.trim();
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
              planStart: planStart || null,
              planEnd: planEnd || null,
              actualStart: actualStart || null,
              actualEnd: actualEnd || null,
              ...(parentChanged ? { reasonText: trimmedReasonText } : {}),
            }),
          },
        );
        await api(
          `/projects/${form.projectId}/tasks/${editing.id}/dependencies`,
          {
            method: 'PUT',
            body: JSON.stringify({ predecessorIds: form.predecessorIds }),
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
            ...(planStart ? { planStart } : {}),
            ...(planEnd ? { planEnd } : {}),
            ...(actualStart ? { actualStart } : {}),
            ...(actualEnd ? { actualEnd } : {}),
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
    setEditingOriginalParentTaskId(item.parentTaskId ?? null);
    setForm((prev) => ({
      ...prev,
      projectId: item.projectId,
      name: item.name,
      status: item.status || '',
      parentTaskId: item.parentTaskId || '',
      predecessorIds: [],
      planStart: toDateInput(item.planStart),
      planEnd: toDateInput(item.planEnd),
      actualStart: toDateInput(item.actualStart),
      actualEnd: toDateInput(item.actualEnd),
      reasonText: '',
    }));
    void loadDependencies(item.projectId, item.id);
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
              .filter(
                (task) =>
                  task.id !== editing?.id && task.projectId === form.projectId,
              )
              .map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
          </select>
          <input
            aria-label="計画開始日"
            type="date"
            value={form.planStart}
            onChange={(e) => setForm({ ...form, planStart: e.target.value })}
          />
          <input
            aria-label="計画終了日"
            type="date"
            value={form.planEnd}
            onChange={(e) => setForm({ ...form, planEnd: e.target.value })}
          />
          <input
            aria-label="実績開始日"
            type="date"
            value={form.actualStart}
            onChange={(e) => setForm({ ...form, actualStart: e.target.value })}
          />
          <input
            aria-label="実績終了日"
            type="date"
            value={form.actualEnd}
            onChange={(e) => setForm({ ...form, actualEnd: e.target.value })}
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
        {editing && (
          <div style={{ marginTop: 8 }}>
            <select
              multiple
              aria-label="先行タスク選択"
              value={form.predecessorIds}
              onChange={(e) =>
                setForm({
                  ...form,
                  predecessorIds: Array.from(e.target.selectedOptions).map(
                    (opt) => opt.value,
                  ),
                })
              }
              style={{ minWidth: 240, minHeight: 120 }}
            >
              {items
                .filter(
                  (task) =>
                    task.id !== editing.id && task.projectId === form.projectId,
                )
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.name}
                  </option>
                ))}
            </select>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              先行タスク（複数選択可）
            </div>
          </div>
        )}
        {editing && (
          <div style={{ marginTop: 8 }}>
            <textarea
              placeholder={
                parentChanged
                  ? '親タスクの変更理由（必須）'
                  : '親タスクの変更理由（親変更時のみ必須）'
              }
              aria-label="親タスクの変更理由"
              value={form.reasonText}
              onChange={(e) => setForm({ ...form, reasonText: e.target.value })}
              style={{ width: '100%', minHeight: 60 }}
              disabled={!parentChanged}
            />
          </div>
        )}
      </div>

      <ul className="list" style={{ marginTop: 12 }}>
        {items.map((item) => {
          const parent = item.parentTaskId
            ? taskMap.get(item.parentTaskId)
            : null;
          const parentLabel = item.parentTaskId
            ? parent?.name || item.parentTaskId
            : null;
          const planStart = toDateInput(item.planStart);
          const planEnd = toDateInput(item.planEnd);
          const actualStart = toDateInput(item.actualStart);
          const actualEnd = toDateInput(item.actualEnd);
          const planLabel =
            planStart || planEnd
              ? `計画: ${planStart || '未設定'}〜${planEnd || '未設定'}`
              : null;
          const actualLabel =
            actualStart || actualEnd
              ? `実績: ${actualStart || '未設定'}〜${actualEnd || '未設定'}`
              : null;
          return (
            <li key={item.id}>
              <span className="badge">{item.status || 'open'}</span> {item.name}{' '}
              / {renderProject(item.projectId)}
              {parentLabel && ` / 親: ${parentLabel}`}
              {(planLabel || actualLabel) && (
                <div style={{ marginTop: 4, fontSize: 12 }}>
                  {planLabel && <div>{planLabel}</div>}
                  {actualLabel && <div>{actualLabel}</div>}
                </div>
              )}
              <div style={{ marginTop: 6 }}>
                <button
                  className="button secondary"
                  style={{ marginRight: 8 }}
                  onClick={() => startEdit(item)}
                >
                  編集
                </button>
                {isPrivileged && (
                  <button
                    className="button secondary"
                    onClick={() => remove(item)}
                  >
                    削除
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {items.length === 0 && <li>データなし</li>}
      </ul>
    </div>
  );
};
