import React, { useEffect, useState } from 'react';
import { api } from '../api';

type Alert = {
  id: string;
  type: string;
  targetRef?: string;
  status: string;
  triggeredAt?: string;
  sentChannels?: string[];
};

export const Dashboard: React.FC = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [showAll, setShowAll] = useState(false);
  const hasMore = alerts.length > 5;
  const visibleAlerts = showAll ? alerts : alerts.slice(0, 5);

  useEffect(() => {
    api<{ items: Alert[] }>('/alerts')
      .then((data) => setAlerts(data.items))
      .catch(() => setAlerts([]));
  }, []);

  return (
    <div>
      <h2>Dashboard</h2>
      <div className="row" style={{ alignItems: 'center' }}>
        <p className="badge">
          Alerts{' '}
          {showAll
            ? `(全${alerts.length}件)`
            : `(最新${Math.min(alerts.length, 5)}件)`}
        </p>
        {hasMore && (
          <button
            className="button secondary"
            style={{ marginLeft: 'auto' }}
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? '最新のみ' : 'すべて表示'}
          </button>
        )}
      </div>
      <div className="list" style={{ display: 'grid', gap: 8 }}>
        {visibleAlerts.map((a) => (
          <div key={a.id} className="card" style={{ padding: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{a.type}</strong> / {a.targetRef || 'N/A'}
              </div>
              <span className="badge">{a.status}</span>
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
              送信: {(a.sentChannels || []).join(', ') || '未送信'} /{' '}
              {a.triggeredAt?.slice(0, 16) || ''}
            </div>
          </div>
        ))}
        {alerts.length === 0 && <div className="card">アラートなし</div>}
      </div>
    </div>
  );
};
