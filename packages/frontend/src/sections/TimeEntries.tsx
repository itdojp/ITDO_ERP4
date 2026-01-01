import React, { useCallback, useEffect, useState } from 'react';
import { api, getAuthState } from '../api';

type TimeEntry = {
  id: string;
  projectId: string;
  workDate: string;
  minutes: number;
  status: string;
  workType?: string;
  location?: string;
  taskId?: string;
};
type FormState = {
  projectId: string;
  taskId: string;
  workDate: string;
  minutes: number;
  workType: string;
  location: string;
};

type MessageState = { text: string; type: 'success' | 'error' } | null;

type ProjectOption = {
  id: string;
  code: string;
  name: string;
};

const defaultForm: FormState = {
  projectId: 'demo-project',
  taskId: '',
  workDate: new Date().toISOString().slice(0, 10),
  minutes: 60,
  workType: '通常',
  location: 'office',
};

export const TimeEntries: React.FC = () => {
  const auth = getAuthState();
  const defaultProjectId = auth?.projectIds?.[0] || defaultForm.projectId;
  const [items, setItems] = useState<TimeEntry[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectMessage, setProjectMessage] = useState('');
  const [message, setMessage] = useState<MessageState>(null);
  const [form, setForm] = useState<FormState>({
    ...defaultForm,
    projectId: defaultProjectId,
  });
  const [isSaving, setIsSaving] = useState(false);
  const minutesValue = Number.isFinite(form.minutes) ? form.minutes : 0;
  const minutesError =
    minutesValue <= 0
      ? '工数は1分以上で入力してください'
      : minutesValue > 1440
        ? '工数は1440分以内で入力してください'
        : minutesValue % 15 !== 0
          ? '工数は15分単位で入力してください'
          : '';
  const baseValid = Boolean(form.projectId.trim()) && Boolean(form.workDate);
  const isValid = baseValid && !minutesError;
  const validationHint = !baseValid
    ? '案件と日付は必須です'
    : minutesError;

  const loadProjects = useCallback(async () => {
    try {
      const res = await api<{ items: ProjectOption[] }>('/projects');
      setProjects(res.items || []);
      setProjectMessage('');
    } catch (err) {
      console.error('Failed to load projects.', err);
      setProjects([]);
      setProjectMessage('案件一覧の取得に失敗しました');
    }
  }, []);

  useEffect(() => {
    api<{ items: TimeEntry[] }>('/time-entries')
      .then((res) => setItems(res.items))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (projects.length === 0) return;
    setForm((prev) => {
      if (projects.some((project) => project.id === prev.projectId)) {
        return prev;
      }
      return { ...prev, projectId: projects[0].id };
    });
  }, [projects]);

  useEffect(() => {
    if (!message || message.type !== 'success') return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const add = async () => {
    if (!isValid) {
      setMessage(null);
      return;
    }
    try {
      setIsSaving(true);
      const userId = getAuthState()?.userId || 'demo-user';
      await api('/time-entries', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          projectId: form.projectId.trim(),
          taskId: form.taskId.trim() || undefined,
          workType: form.workType.trim() || undefined,
          location: form.location.trim() || undefined,
          userId,
        }),
      });
      setMessage({ text: '保存しました', type: 'success' });
      const updated = await api<{ items: TimeEntry[] }>('/time-entries');
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
      <h2>工数入力</h2>
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
            value={form.taskId}
            onChange={(e) => setForm({ ...form, taskId: e.target.value })}
            placeholder="Task ID (任意)"
          />
          <input
            type="date"
            value={form.workDate}
            onChange={(e) => setForm({ ...form, workDate: e.target.value })}
          />
          <input
            type="number"
            min={1}
            max={1440}
            step={15}
            value={form.minutes}
            onChange={(e) =>
              setForm({ ...form, minutes: Number(e.target.value) })
            }
            style={{ width: 100 }}
          />
          <input
            type="text"
            value={form.workType}
            onChange={(e) => setForm({ ...form, workType: e.target.value })}
            placeholder="作業種別"
          />
          <input
            type="text"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            placeholder="場所"
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
      <ul className="list">
        {items.map((e) => (
          <li key={e.id}>
            <span className="badge">{e.status}</span> {e.workDate.slice(0, 10)}{' '}
            / {e.projectId} / {e.minutes} min
            {e.workType && <> / {e.workType}</>}
            {e.location && <> / {e.location}</>}
          </li>
        ))}
        {items.length === 0 && <li>データなし</li>}
      </ul>
      {message && (
        <p style={{ color: message.type === 'error' ? '#dc2626' : undefined }}>
          {message.text}
        </p>
      )}
    </div>
  );
};
