import React, { useEffect, useState } from 'react';
import { api } from '../api';

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
  const [items, setItems] = useState<TimeEntry[]>([]);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<FormState>(defaultForm);

  useEffect(() => {
    api<{ items: TimeEntry[] }>('/time-entries').then((res) => setItems(res.items)).catch(() => setItems([]));
  }, []);

  const add = async () => {
    try {
      await api('/time-entries', { method: 'POST', body: JSON.stringify({ ...form, userId: 'demo-user' }) });
      setMessage('保存しました');
      const updated = await api<{ items: TimeEntry[] }>('/time-entries');
      setItems(updated.items);
      setForm(defaultForm);
    } catch (e) {
      setMessage('保存に失敗しました');
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
          <input type="number" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })} style={{ width: 100 }} />
          <input type="text" value={form.workType} onChange={(e) => setForm({ ...form, workType: e.target.value })} placeholder="作業種別" />
          <input type="text" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="場所" />
          <button className="button" onClick={add}>追加</button>
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
