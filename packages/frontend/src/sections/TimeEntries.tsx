import React, { useEffect, useState } from 'react';
import { api, getAuthState } from '../api';

type TimeEntry = { id: string; projectId: string; workDate: string; minutes: number; status: string; workType?: string; location?: string; taskId?: string };
type FormState = {
  projectId: string;
  taskId: string;
  workDate: string;
  minutes: number;
  workType: string;
  location: string;
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
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<FormState>({ ...defaultForm, projectId: defaultProjectId });
  const [isSaving, setIsSaving] = useState(false);
  const isValid = Boolean(form.projectId.trim()) && Boolean(form.workDate) && form.minutes > 0;

  useEffect(() => {
    api<{ items: TimeEntry[] }>('/time-entries').then((res) => setItems(res.items)).catch(() => setItems([]));
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const add = async () => {
    if (!isValid) {
      setMessage('必須項目を入力してください');
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
      setMessage('保存しました');
      const updated = await api<{ items: TimeEntry[] }>('/time-entries');
      setItems(updated.items);
      setForm({ ...defaultForm, projectId: defaultProjectId });
    } catch (e) {
      setMessage('保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <h2>工数入力</h2>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input type="text" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} placeholder="Project ID" />
          <input type="text" value={form.taskId} onChange={(e) => setForm({ ...form, taskId: e.target.value })} placeholder="Task ID (任意)" />
          <input type="date" value={form.workDate} onChange={(e) => setForm({ ...form, workDate: e.target.value })} />
          <input
            type="number"
            min={1}
            max={1440}
            step={15}
            value={form.minutes}
            onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })}
            style={{ width: 100 }}
          />
          <input type="text" value={form.workType} onChange={(e) => setForm({ ...form, workType: e.target.value })} placeholder="作業種別" />
          <input type="text" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="場所" />
          <button className="button" onClick={add} disabled={!isValid || isSaving}>追加</button>
        </div>
      </div>
      <ul className="list">
        {items.map((e) => (
          <li key={e.id}>
            <span className="badge">{e.status}</span> {e.workDate.slice(0, 10)} / {e.projectId} / {e.minutes} min
            {e.workType && <> / {e.workType}</>}
            {e.location && <> / {e.location}</>}
          </li>
        ))}
        {items.length === 0 && <li>データなし</li>}
      </ul>
      {message && <p>{message}</p>}
    </div>
  );
};
