import React, { useEffect, useState } from 'react';
import { api } from '../api';

type Alert = { id: string; type: string; message?: string; status: string; triggeredAt?: string };

export const Dashboard: React.FC = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    api<{ items: Alert[] }>('/alerts').then((data) => setAlerts(data.items)).catch(() => setAlerts([]));
  }, []);

  return (
    <div>
      <h2>Dashboard</h2>
      <p className="badge">Alerts</p>
      <ul className="list">
        {alerts.map((a) => (
          <li key={a.id} className="alert">
            <strong>{a.type}</strong>: {a.message || ''} ({a.status})
          </li>
        ))}
        {alerts.length === 0 && <li>アラートなし</li>}
      </ul>
    </div>
  );
};
