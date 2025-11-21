import React, { useEffect, useState } from 'react';
import { api } from '../api';

type TimeEntry = { id: string; projectId: string; workDate: string; minutes: number; status: string };

export const TimeEntries: React.FC = () => {
  const [items, setItems] = useState<TimeEntry[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api<{ items: TimeEntry[] }>('/time-entries').then((res) => setItems(res.items)).catch(() => setItems([]));
  }, []);

  const add = async () => {
    try {
      await api('/time-entries', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'demo-project', userId: 'demo-user', workDate: new Date().toISOString(), minutes: 60 }),
      });
      setMessage('保存しました');
      const updated = await api<{ items: TimeEntry[] }>('/time-entries');
      setItems(updated.items);
    } catch (e) {
      setMessage('保存に失敗しました');
    }
  };

  return (
    <div>
      <h2>工数入力</h2>
      <ul className="list">
        {items.map((e) => (
          <li key={e.id}>
            <span className="badge">{e.status}</span> {e.workDate.slice(0,10)} / {e.projectId} / {e.minutes} min
          </li>
        ))}
        {items.length === 0 && <li>データなし</li>}
      </ul>
      <button className="button" onClick={add}>追加</button>
      {message && <p>{message}</p>}
    </div>
  );
};
