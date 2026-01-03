import React, { useEffect, useState } from 'react';
import { api, AuthState, getAuthState, setAuthState } from '../api';

type MeResponse = {
  user: { userId: string; roles: string[]; ownerProjects?: string[] | string };
};

const pushPublicKey = (import.meta.env.VITE_PUSH_PUBLIC_KEY || '').trim();

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

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
  const [pushSupported] = useState(
    typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window,
  );
  const [pushPermission, setPushPermission] =
    useState<NotificationPermission>('default');
  const [pushSubscription, setPushSubscription] =
    useState<PushSubscription | null>(null);
  const [pushMessage, setPushMessage] = useState('');
  const [pushError, setPushError] = useState('');
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
  }, [auth]);

  useEffect(() => {
    if (!auth || !pushSupported) {
      setPushSubscription(null);
      return;
    }
    const loadSubscription = async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        setPushSubscription(null);
        setPushPermission(Notification.permission);
        return;
      }
      const subscription = await registration.pushManager.getSubscription();
      setPushSubscription(subscription);
      setPushPermission(Notification.permission);
    };
    loadSubscription().catch(() => {
      setPushError('Push購読の取得に失敗しました');
    });
  }, [auth, pushSupported]);

  const ensureRegistration = async () => {
    if (!pushSupported) {
      setPushError('このブラウザはPush通知に対応していません');
      return null;
    }
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    try {
      return await navigator.serviceWorker.register('/sw.js');
    } catch (err) {
      setPushError('Service Workerの登録に失敗しました');
      return null;
    }
  };

  const subscribePush = async () => {
    setPushError('');
    setPushMessage('');
    try {
      if (!pushPublicKey) {
        setPushError('VITE_PUSH_PUBLIC_KEY が未設定です');
        return;
      }
      const registration = await ensureRegistration();
      if (!registration) return;
      const permission = await Notification.requestPermission();
      setPushPermission(permission);
      if (permission !== 'granted') {
        setPushError('通知が許可されていません');
        return;
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pushPublicKey),
      });
      const payload = subscription.toJSON();
      await api('/push-subscriptions', {
        method: 'POST',
        body: JSON.stringify({ ...payload, userAgent: navigator.userAgent }),
      });
      setPushMessage('Push購読を登録しました');
      setPushSubscription(subscription);
    } catch (err) {
      setPushError('Push購読の登録に失敗しました');
    }
  };

  const unsubscribePush = async () => {
    setPushError('');
    setPushMessage('');
    try {
      const registration = await ensureRegistration();
      if (!registration) return;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        setPushMessage('購読はありません');
        return;
      }
      await subscription.unsubscribe();
      await api('/push-subscriptions/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      setPushMessage('Push購読を解除しました');
      setPushSubscription(null);
    } catch (err) {
      setPushError('Push購読の解除に失敗しました');
    }
  };

  const sendPushTest = async () => {
    setPushError('');
    setPushMessage('');
    try {
      const registration = await ensureRegistration();
      if (!registration) return;
      const res = await api<{
        payload: { title: string; body: string; url: string };
      }>('/push-notifications/test', {
        method: 'POST',
        body: JSON.stringify({
          title: 'ERP4',
          body: 'テスト通知です',
          url: '/',
        }),
      });
      if (registration.active) {
        registration.active.postMessage({
          type: 'PUSH_TEST',
          payload: res.payload,
        });
      } else {
        await registration.showNotification(res.payload.title, {
          body: res.payload.body,
          data: { url: res.payload.url },
          icon: '/icon.svg',
        });
      }
      setPushMessage('テスト通知を送信しました');
    } catch (err) {
      setPushError('テスト通知の送信に失敗しました');
    }
  };

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
          <div style={{ marginTop: 12 }}>
            <strong>Push通知</strong>
            {!pushSupported && (
              <div style={{ marginTop: 6 }}>このブラウザは未対応です</div>
            )}
            {pushSupported && (
              <div style={{ marginTop: 6 }}>
                <div>Permission: {pushPermission}</div>
                <div>
                  Subscription: {pushSubscription ? '登録済み' : '未登録'}
                </div>
                {!pushPublicKey && (
                  <div style={{ color: '#b45309', marginTop: 4 }}>
                    VITE_PUSH_PUBLIC_KEY が未設定です
                  </div>
                )}
                <div className="row" style={{ gap: 8, marginTop: 6 }}>
                  <button className="button secondary" onClick={subscribePush}>
                    購読登録
                  </button>
                  <button className="button secondary" onClick={unsubscribePush}>
                    購読解除
                  </button>
                  <button className="button secondary" onClick={sendPushTest}>
                    テスト通知
                  </button>
                </div>
                {pushMessage && (
                  <div style={{ color: '#16a34a', marginTop: 6 }}>
                    {pushMessage}
                  </div>
                )}
                {pushError && (
                  <div style={{ color: '#dc2626', marginTop: 6 }}>
                    {pushError}
                  </div>
                )}
              </div>
            )}
          </div>
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
