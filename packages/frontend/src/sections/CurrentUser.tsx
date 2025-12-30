import React, { useEffect, useMemo, useState } from 'react';
import { api, AuthState, getAuthState, setAuthState } from '../api';

type MeResponse = {
  user: { userId: string; roles: string[]; ownerProjects?: string[] | string };
};

export const CurrentUser: React.FC = () => {
  const [me, setMe] = useState<MeResponse['user'] | null>(null);
  const [error, setError] = useState('');
  const [auth, setAuth] = useState<AuthState | null>(() => getAuthState());
  const [form, setForm] = useState(() => ({
    userId: auth?.userId || 'demo-user',
    roles: auth?.roles?.join(',') || 'admin,mgmt',
    projectIds: auth?.projectIds?.join(',') || '',
    groupIds: auth?.groupIds?.join(',') || '',
  }));
  const authKey = useMemo(() => JSON.stringify(auth), [auth]);

  useEffect(() => {
    if (!auth) {
      setMe(null);
      return;
    }
    api<MeResponse>('/me')
      .then((res) => {
        setMe(res.user);
        setError('');
      })
      .catch(() => setError('取得に失敗'));
  }, [authKey]);

  const login = () => {
    const roles = form.roles
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    const projectIds = form.projectIds
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const groupIds = form.groupIds
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);
    const next: AuthState = {
      userId: form.userId.trim() || 'demo-user',
      roles: roles.length ? roles : ['user'],
      projectIds: projectIds.length ? projectIds : undefined,
      groupIds: groupIds.length ? groupIds : undefined,
    };
    setAuthState(next);
    setAuth(next);
  };

  const logout = () => {
    setAuthState(null);
    setAuth(null);
    setMe(null);
    setError('');
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <strong>現在のユーザー</strong>
        {error && (
          <span style={{ color: '#dc2626', marginLeft: 8 }}>{error}</span>
        )}
      </div>
      {!auth && (
        <div style={{ fontSize: 14, marginTop: 8 }}>
          <div>未ログイン</div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <input
              type="text"
              value={form.userId}
              onChange={(e) => setForm({ ...form, userId: e.target.value })}
              placeholder="userId"
            />
            <input
              type="text"
              value={form.roles}
              onChange={(e) => setForm({ ...form, roles: e.target.value })}
              placeholder="roles (admin,mgmt)"
            />
            <button className="button" onClick={login}>
              簡易ログイン
            </button>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <input
              type="text"
              value={form.projectIds}
              onChange={(e) => setForm({ ...form, projectIds: e.target.value })}
              placeholder="projectIds (optional)"
            />
            <input
              type="text"
              value={form.groupIds}
              onChange={(e) => setForm({ ...form, groupIds: e.target.value })}
              placeholder="groupIds (optional)"
            />
          </div>
        </div>
      )}
      {auth && (
        <div style={{ fontSize: 14 }}>
          {me ? (
            <>
              <div>ID: {me.userId}</div>
              <div>Roles: {me.roles.join(', ')}</div>
              <div>
                OwnerProjects:{' '}
                {Array.isArray(me.ownerProjects)
                  ? me.ownerProjects.join(', ')
                  : me.ownerProjects}
              </div>
              <div>Groups: {(auth.groupIds || []).join(', ') || '-'}</div>
            </>
          ) : (
            !error && <div>読み込み中...</div>
          )}
          <button
            className="button secondary"
            style={{ marginTop: 8 }}
            onClick={logout}
          >
            ログアウト
          </button>
        </div>
      )}
    </div>
  );
};
