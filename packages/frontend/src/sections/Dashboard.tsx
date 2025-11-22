import React, { useEffect, useState } from 'react';
import { api } from '../api';

type Alert = { id: string; type: string; targetRef?: string; status: string; triggeredAt?: string; sentChannels?: string[] };

export const Dashboard: React.FC = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    api<{ items: Alert[] }>('/alerts').then((data) => setAlerts(data.items)).catch(() => setAlerts([]));
  }, []);

  return (
    <div>
      <h2>Dashboard</h2>
      <p className="badge">Alerts (最新5件)</p>
      <div className="list" style={{ display: 'grid', gap: 8 }}>
        {alerts.slice(0, 5).map((a) => (
          <div key={a.id} className="card" style={{ padding: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{a.type}</strong> / {a.targetRef || 'N/A'}
              </div>
              <span className="badge">{a.status}</span>
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
              送信: {(a.sentChannels || []).join(', ') || '未送信'} / {a.triggeredAt?.slice(0, 16) || ''}
            </div>
          </div>
        ))}
        {alerts.length === 0 && <div className="card">アラートなし</div>}
      </div>
    </div>
  );
};
