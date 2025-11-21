import React, { useState } from 'react';
import { api } from '../api';
import { InvoiceDetail } from './InvoiceDetail';

interface Invoice {
  id: string;
  invoiceNo?: string;
  projectId: string;
  totalAmount: number;
  status: string;
}

const initialForm = { projectId: 'demo-project', totalAmount: 100000 };

export const Invoices: React.FC = () => {
  const [items, setItems] = useState<Invoice[]>([]);
  const [form, setForm] = useState(initialForm);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [message, setMessage] = useState('');

  const create = async () => {
    try {
      const res = await api<Invoice>(`/projects/${form.projectId}/invoices`, {
        method: 'POST',
        body: JSON.stringify({ totalAmount: form.totalAmount, currency: 'JPY', lines: [] }),
      });
      setMessage('作成しました');
      setItems((prev) => [...prev, res]);
    } catch (e) {
      setMessage('作成に失敗');
    }
  };

  const send = async (id: string) => {
    try {
      await api(`/invoices/${id}/send`, { method: 'POST' });
      setMessage('送信しました');
    } catch (e) {
      setMessage('送信失敗');
    }
  };

  return (
    <div>
      <h2>請求</h2>
      <div className="row" style={{ gap: 8 }}>
        <input
          type="text"
          value={form.projectId}
          onChange={(e) => setForm({ ...form, projectId: e.target.value })}
          placeholder="projectId"
        />
        <input
          type="number"
          value={form.totalAmount}
          onChange={(e) => setForm({ ...form, totalAmount: Number(e.target.value) })}
          placeholder="金額"
        />
        <button className="button" onClick={create}>作成</button>
      </div>
      {message && <p>{message}</p>}
      <ul className="list">
        {items.map((d) => (
          <li key={d.id}>
            <span className="badge">{d.status}</span> {d.invoiceNo || '(draft)'} / {d.projectId} / ¥{(d.totalAmount || 0).toLocaleString()}
            <div>
              <button className="button secondary" style={{ marginRight: 8 }} onClick={() => setSelected(d)}>詳細</button>
              <button className="button" onClick={() => send(d.id)}>送信 (Stub)</button>
            </div>
          </li>
        ))}
        {items.length === 0 && <li>データなし</li>}
      </ul>
      {selected && (
        <div className="card">
          <InvoiceDetail {...selected} onSend={() => send(selected.id)} />
          <button className="button secondary" onClick={() => setSelected(null)}>閉じる</button>
        </div>
      )}
    </div>
  );
};
