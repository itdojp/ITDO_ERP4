import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, AuthState, getAuthState, setAuthState } from '../api';
import {
  listOfflineItems,
  processOfflineQueue,
  removeOfflineItem,
  type QueueItem,
} from '../utils/offlineQueue';

type MeResponse = {
  user: { userId: string; roles: string[]; ownerProjects?: string[] | string };
};

const pushPublicKey = (import.meta.env.VITE_PUSH_PUBLIC_KEY || '').trim();
const PUSH_TOPIC_KEY = 'erp4_push_topics';
const PUSH_CONSENT_KEY = 'erp4_push_consent';
const PUSH_TOPICS = [
  { id: 'alerts', label: 'アラート' },
  { id: 'approvals', label: '承認' },
  { id: 'reports', label: 'レポート' },
  { id: 'invoices', label: '請求/発注' },
];
const PUSH_TOPIC_SET = new Set(PUSH_TOPICS.map((topic) => topic.id));

function normalizePushTopics(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ['alerts'];
  const filtered = raw
    .map((item) => String(item))
    .filter((item) => PUSH_TOPIC_SET.has(item));
  return filtered.length ? filtered : ['alerts'];
}

let googleScriptPromise: Promise<void> | null = null;

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleIdentity = {
  accounts?: {
    id?: {
      initialize: (options: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
      }) => void;
      renderButton: (
        container: HTMLElement,
        options: Record<string, unknown>,
      ) => void;
    };
  };
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function loadGoogleIdentityScript() {
  if (typeof window === 'undefined') return Promise.resolve();
  const google = (window as { google?: GoogleIdentity }).google;
  if (google?.accounts?.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-google-identity="true"]',
    );
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      const readyState = (existing as unknown as { readyState?: string })
        .readyState;
      if (readyState === 'complete') {
        existing.dataset.loaded = 'true';
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('google_identity_load_failed')),
        { once: true },
      );
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error('google_identity_load_failed'));
    document.head.appendChild(script);
  });
  return googleScriptPromise;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payloadPart = parts[1];
  if (!payloadPart) return null;
  const raw = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
  const padded = raw.padEnd(raw.length + ((4 - (raw.length % 4)) % 4), '=');
  try {
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeJwtList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function resolveJwtUserId(
  payload: Record<string, unknown> | null,
): string | null {
  const sub = payload?.sub;
  if (typeof sub === 'string' && sub.trim()) return sub.trim();
  const email = payload?.email;
  if (typeof email === 'string' && email.trim()) return email.trim();
  return null;
}

export const CurrentUser: React.FC = () => {
  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
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
  const [pushTopics, setPushTopics] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(PUSH_TOPIC_KEY);
      if (!raw) return ['alerts'];
      const parsed = JSON.parse(raw);
      return normalizePushTopics(parsed);
    } catch {
      return ['alerts'];
    }
  });
  const [pushConsent, setPushConsent] = useState(() => {
    try {
      return window.localStorage.getItem(PUSH_CONSENT_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [googleError, setGoogleError] = useState('');
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueMessage, setQueueMessage] = useState('');
  const [queueError, setQueueError] = useState('');
  const [queueProcessing, setQueueProcessing] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const googleButtonRendered = useRef(false);
  const logPushError = (label: string, err: unknown) => {
    if (import.meta.env.DEV) {
      console.error(`[push] ${label}`, err);
    }
  };
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

  const loadQueueItems = useCallback(async () => {
    try {
      const items = await listOfflineItems();
      setQueueItems(items);
    } catch {
      setQueueItems([]);
    }
  }, []);

  const runQueue = useCallback(
    async (includeFailed?: boolean) => {
      setQueueError('');
      setQueueMessage('');
      if (!auth) {
        setQueueError('ログイン後に送信待ちを処理できます');
        return;
      }
      setQueueProcessing(true);
      try {
        const result = await processOfflineQueue({ includeFailed });
        if (result.stoppedBy === 'locked') {
          return;
        }
        if (result.stoppedBy === 'failed') {
          setQueueError('送信に失敗した項目があります');
        } else if (result.stoppedBy === 'offline') {
          setQueueMessage('オフラインのため送信を保留しました');
        } else {
          setQueueMessage('送信待ちを処理しました');
        }
      } catch {
        setQueueError('送信待ちの処理に失敗しました');
      } finally {
        setQueueProcessing(false);
        await loadQueueItems();
      }
    },
    [auth, loadQueueItems],
  );

  const runQueueItem = useCallback(
    async (id: string) => {
      setQueueError('');
      setQueueMessage('');
      if (!auth) {
        setQueueError('ログイン後に送信待ちを処理できます');
        return;
      }
      setQueueProcessing(true);
      try {
        const result = await processOfflineQueue({
          includeFailed: true,
          targetId: id,
        });
        if (result.stoppedBy === 'locked') {
          return;
        }
        if (result.stoppedBy === 'failed') {
          setQueueError('送信に失敗した項目があります');
        } else if (result.stoppedBy === 'offline') {
          setQueueMessage('オフラインのため送信を保留しました');
        } else {
          setQueueMessage('送信待ちを処理しました');
        }
      } catch {
        setQueueError('送信待ちの処理に失敗しました');
      } finally {
        setQueueProcessing(false);
        await loadQueueItems();
      }
    },
    [auth, loadQueueItems],
  );

  const discardQueueItem = useCallback(
    async (id: string) => {
      await removeOfflineItem(id);
      await loadQueueItems();
    },
    [loadQueueItems],
  );

  useEffect(() => {
    loadQueueItems();
    if (auth) {
      runQueue(false).catch(() => undefined);
    }
    const handleOnline = () => {
      setIsOnline(true);
      if (auth) {
        runQueue(false).catch(() => undefined);
      }
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [auth, loadQueueItems, runQueue]);

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
    loadSubscription().catch((err) => {
      logPushError('loadSubscription failed', err);
      setPushError('Push購読の取得に失敗しました');
    });
  }, [auth, pushSupported]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PUSH_TOPIC_KEY, JSON.stringify(pushTopics));
    } catch {
      // ignore
    }
  }, [pushTopics]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PUSH_CONSENT_KEY, String(pushConsent));
    } catch {
      // ignore
    }
  }, [pushConsent]);

  const applyTokenLogin = useCallback((token: string) => {
    const payload = decodeJwtPayload(token);
    if (!payload) {
      setGoogleError('トークンの解析に失敗しました');
      return;
    }
    const exp = payload.exp;
    if (typeof exp === 'number' && Date.now() >= exp * 1000) {
      setGoogleError('トークンの有効期限が切れています');
      return;
    }
    const userId = resolveJwtUserId(payload);
    if (!userId) {
      setGoogleError('ユーザーIDを特定できませんでした');
      return;
    }
    const roles = normalizeJwtList(payload?.roles);
    const groupIds = normalizeJwtList(payload?.group_ids);
    const projectIds = normalizeJwtList(payload?.project_ids);
    const next: AuthState = {
      userId,
      roles,
      groupIds: groupIds.length ? groupIds : undefined,
      projectIds: projectIds.length ? projectIds : undefined,
      token,
    };
    setAuthState(next);
    setAuth(next);
    setGoogleError('');
  }, []);

  useEffect(() => {
    if (!googleClientId || auth?.token) return;
    let cancelled = false;
    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled) return;
        const google = (window as { google?: GoogleIdentity }).google;
        if (!google?.accounts?.id) {
          setGoogleError('Googleログインの初期化に失敗しました');
          return;
        }
        const callback = (response: GoogleCredentialResponse) => {
          if (cancelled) return;
          if (!response?.credential) {
            setGoogleError('Googleログインに失敗しました');
            return;
          }
          applyTokenLogin(response.credential);
        };
        google.accounts.id.initialize({
          client_id: googleClientId,
          callback,
        });
        setGoogleReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setGoogleError('Googleログインの初期化に失敗しました');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applyTokenLogin, auth?.token, googleClientId]);

  useEffect(() => {
    if (!auth?.token) {
      googleButtonRendered.current = false;
    }
  }, [auth?.token]);

  useEffect(() => {
    if (!googleReady || auth?.token || googleButtonRendered.current) return;
    const google = (window as { google?: GoogleIdentity }).google;
    if (!google?.accounts?.id || !googleButtonRef.current) return;
    google.accounts.id.renderButton(googleButtonRef.current, {
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
    });
    googleButtonRendered.current = true;
  }, [auth?.token, googleReady]);

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

  const togglePushTopic = (id: string) => {
    setPushTopics((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const subscribePush = async () => {
    setPushError('');
    setPushMessage('');
    try {
      if (!pushConsent) {
        setPushError('通知の受信に同意してください');
        return;
      }
      const normalizedTopics = normalizePushTopics(pushTopics);
      if (normalizedTopics.length === 0) {
        setPushError('配信条件を1つ以上選択してください');
        return;
      }
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
        body: JSON.stringify({
          ...payload,
          userAgent: navigator.userAgent,
          topics: normalizedTopics,
        }),
      });
      setPushMessage('Push購読を登録しました');
      setPushSubscription(subscription);
    } catch (err) {
      logPushError('subscribe failed', err);
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
      logPushError('unsubscribe failed', err);
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
        stub?: boolean;
        payload: { title: string; body: string; url: string };
        delivered?: number;
        failed?: number;
      }>('/push-notifications/test', {
        method: 'POST',
        body: JSON.stringify({
          title: 'ERP4',
          body: 'テスト通知です',
          url: '/',
        }),
      });
      if (res.stub) {
        if (registration.active) {
          registration.active.postMessage({
            type: 'PUSH_TEST',
            payload: res.payload,
          });
        } else if (typeof registration.showNotification === 'function') {
          await registration.showNotification(res.payload.title, {
            body: res.payload.body,
            data: { url: res.payload.url },
            icon: '/icon.svg',
          });
        }
        setPushMessage('テスト通知をローカル表示しました');
      } else {
        setPushMessage(
          `テスト通知をPush配信しました（成功: ${res.delivered ?? 0}, 失敗: ${res.failed ?? 0}）`,
        );
      }
    } catch (err) {
      logPushError('test notification failed', err);
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
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('erp4:auth-updated'));
    }
  };

  const logout = () => {
    setAuthState(null);
    setAuth(null);
    setMe(null);
    setError('');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('erp4:auth-updated'));
    }
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
          {googleClientId && (
            <div style={{ marginTop: 8 }}>
              <div ref={googleButtonRef} />
              {googleError && (
                <div style={{ color: '#dc2626', marginTop: 4 }}>
                  {googleError}
                </div>
              )}
            </div>
          )}
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
            <strong>オフライン送信キュー</strong>
            <div style={{ marginTop: 6 }}>
              <div>
                状態: {isOnline ? 'オンライン' : 'オフライン'} / 件数:{' '}
                {queueItems.length}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 6 }}>
                <button
                  className="button secondary"
                  onClick={() => runQueue(true)}
                  disabled={queueProcessing || queueItems.length === 0}
                >
                  再送
                </button>
                <button
                  className="button secondary"
                  onClick={loadQueueItems}
                  disabled={queueProcessing}
                >
                  再読込
                </button>
              </div>
              {queueMessage && (
                <div style={{ color: '#16a34a', marginTop: 6 }}>
                  {queueMessage}
                </div>
              )}
              {queueError && (
                <div style={{ color: '#dc2626', marginTop: 6 }}>
                  {queueError}
                </div>
              )}
            </div>
            <div
              className="list"
              style={{ display: 'grid', gap: 8, marginTop: 8 }}
            >
              {queueItems.length === 0 && (
                <div className="card">送信待ちはありません</div>
              )}
              {queueItems.map((item) => (
                <div key={item.id} className="card" style={{ padding: 12 }}>
                  <div
                    className="row"
                    style={{ justifyContent: 'space-between' }}
                  >
                    <div>
                      <strong>{item.label}</strong>
                      {item.status === 'failed' && (
                        <span style={{ marginLeft: 8, color: '#dc2626' }}>
                          失敗
                        </span>
                      )}
                    </div>
                    <span className="badge">retry {item.retryCount}</span>
                  </div>
                  {item.lastError && (
                    <div
                      style={{ fontSize: 12, color: '#475569', marginTop: 4 }}
                    >
                      error: {item.lastError}
                    </div>
                  )}
                  <div className="row" style={{ marginTop: 6 }}>
                    <button
                      className="button secondary"
                      onClick={() => runQueueItem(item.id)}
                      disabled={queueProcessing}
                    >
                      再送
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => discardQueueItem(item.id)}
                      disabled={queueProcessing}
                    >
                      破棄
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
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
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: '#475569' }}>配信条件</div>
                  <div className="row" style={{ gap: 8, marginTop: 4 }}>
                    {PUSH_TOPICS.map((topic) => (
                      <label key={topic.id} className="badge">
                        <input
                          type="checkbox"
                          checked={pushTopics.includes(topic.id)}
                          onChange={() => togglePushTopic(topic.id)}
                          style={{ marginRight: 6 }}
                        />
                        {topic.label}
                      </label>
                    ))}
                  </div>
                  <label
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      marginTop: 6,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={pushConsent}
                      onChange={(e) => setPushConsent(e.target.checked)}
                    />
                    通知の受信に同意します
                  </label>
                  <div style={{ fontSize: 12, color: '#475569' }}>
                    配信条件は後から変更できます（再登録で反映）。
                  </div>
                </div>
                <div className="row" style={{ gap: 8, marginTop: 6 }}>
                  <button className="button secondary" onClick={subscribePush}>
                    購読登録
                  </button>
                  <button
                    className="button secondary"
                    onClick={unsubscribePush}
                  >
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
