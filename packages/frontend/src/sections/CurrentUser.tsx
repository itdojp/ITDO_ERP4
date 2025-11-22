import React, { useEffect, useState } from 'react';
import { api } from '../api';

type MeResponse = { user: { userId: string; roles: string[]; ownerProjects?: string[] | string } };

export const CurrentUser: React.FC = () => {
  const [me, setMe] = useState<MeResponse['user'] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<MeResponse>('/me')
      .then((res) => setMe(res.user))
      .catch(() => setError('取得に失敗'));
  }, []);

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <strong>現在のユーザー</strong>
        {error && <span style={{ color: '#dc2626', marginLeft: 8 }}>{error}</span>}
      </div>
      {me ? (
        <div style={{ fontSize: 14 }}>
          <div>ID: {me.userId}</div>
          <div>Roles: {me.roles.join(', ')}</div>
          <div>OwnerProjects: {Array.isArray(me.ownerProjects) ? me.ownerProjects.join(', ') : me.ownerProjects}</div>
        </div>
      ) : (
        !error && <div style={{ fontSize: 14 }}>読み込み中...</div>
      )}
    </div>
  );
}
