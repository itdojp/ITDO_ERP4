import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { api, apiResponse, getAuthState } from '../api';

type BreakGlassRequest = {
  id: string;
  targetType: string;
  projectId?: string | null;
  roomId?: string | null;
  requesterUserId: string;
  viewerUserId: string;
  reasonCode: string;
  reasonText?: string;
  targetFrom?: string | null;
  targetUntil?: string | null;
  ttlHours: number;
  status: string;
  approved1By?: string | null;
  approved1Role?: string | null;
  approved1At?: string | null;
  approved2By?: string | null;
  approved2Role?: string | null;
  approved2At?: string | null;
  rejectedBy?: string | null;
  rejectedRole?: string | null;
  rejectedAt?: string | null;
  rejectedReason?: string | null;
  grantedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ChatMessage = {
  id: string;
  projectId: string;
  userId: string;
  body: string;
  createdAt: string;
};

const reasonCodes = [
  { value: 'harassment', label: 'harassment（ハラスメント）' },
  { value: 'fraud', label: 'fraud（不正）' },
  {
    value: 'security_incident',
    label: 'security_incident（セキュリティ事故）',
  },
  { value: 'legal', label: 'legal（法令/監査対応）' },
  { value: 'other', label: 'other（その他）' },
];

function formatDateTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export const ChatBreakGlass: React.FC = () => {
  const auth = getAuthState();
  const roles = auth?.roles || [];
  const isMgmtOrExec = roles.includes('mgmt') || roles.includes('exec');
  const isAdmin = roles.includes('admin');

  const disabledReason = useMemo(() => {
    if (!isMgmtOrExec) return 'mgmt/exec ロールが必要です';
    if (isAdmin) return 'admin ロールは break-glass を利用できません';
    return '';
  }, [isAdmin, isMgmtOrExec]);

  const [form, setForm] = useState(() => ({
    projectId: auth?.projectIds?.[0] || '',
    roomId: '',
    viewerUserId: auth?.userId || '',
    reasonCode: 'security_incident',
    reasonText: '',
    targetFrom: '',
    targetUntil: '',
    ttlHours: '24',
  }));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const [requests, setRequests] = useState<BreakGlassRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [selectedRequestId, setSelectedRequestId] = useState<string>('');
  const [accessItems, setAccessItems] = useState<ChatMessage[]>([]);
  const [accessMessage, setAccessMessage] = useState('');
  const [isAccessLoading, setIsAccessLoading] = useState(false);

  const loadRequests = useCallback(async () => {
    if (disabledReason) return;
    try {
      setIsLoading(true);
      setError('');
      const res = await api<{ items: BreakGlassRequest[] }>(
        '/chat-break-glass/requests?limit=50',
      );
      setRequests(Array.isArray(res.items) ? res.items : []);
    } catch (err) {
      console.error('break-glass request一覧の取得に失敗しました', err);
      setError('取得に失敗しました');
      setRequests([]);
    } finally {
      setIsLoading(false);
    }
  }, [disabledReason]);

  const createRequest = async () => {
    if (disabledReason) return;
    const projectId = form.projectId.trim();
    const roomId = form.roomId.trim();
    if (!projectId && !roomId) {
      setError('projectId または roomId を入力してください');
      return;
    }
    if (!form.reasonText.trim()) {
      setError('reasonText を入力してください');
      return;
    }
    const ttlHours = Number(form.ttlHours);
    if (!Number.isFinite(ttlHours) || ttlHours < 1 || ttlHours > 168) {
      setError('ttlHours は 1〜168 を指定してください');
      return;
    }
    try {
      setIsCreating(true);
      setError('');
      setMessage('');
      await api('/chat-break-glass/requests', {
        method: 'POST',
        body: JSON.stringify({
          projectId: projectId || undefined,
          roomId: roomId || undefined,
          viewerUserId: form.viewerUserId.trim() || undefined,
          reasonCode: form.reasonCode,
          reasonText: form.reasonText.trim(),
          targetFrom: form.targetFrom.trim() || undefined,
          targetUntil: form.targetUntil.trim() || undefined,
          ttlHours,
        }),
      });
      setMessage('申請しました');
      await loadRequests();
    } catch (err) {
      console.error('break-glass申請に失敗しました', err);
      setError('申請に失敗しました');
    } finally {
      setIsCreating(false);
    }
  };

  const approveRequest = async (id: string) => {
    if (disabledReason) return;
    try {
      setError('');
      setMessage('');
      const res = await apiResponse(
        `/chat-break-glass/requests/${id}/approve`,
        {
          method: 'POST',
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${res.status} ${text}`);
      }
      setMessage('承認しました');
      await loadRequests();
    } catch (err) {
      console.error('break-glass承認に失敗しました', err);
      setError('承認に失敗しました');
    }
  };

  const rejectRequest = async (id: string) => {
    if (disabledReason) return;
    const reason = window.prompt('却下理由を入力してください');
    if (!reason) return;
    try {
      setError('');
      setMessage('');
      const res = await apiResponse(`/chat-break-glass/requests/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${res.status} ${text}`);
      }
      setMessage('却下しました');
      await loadRequests();
    } catch (err) {
      console.error('break-glass却下に失敗しました', err);
      setError('却下に失敗しました');
    }
  };

  const accessMessages = async (id: string) => {
    if (disabledReason) return;
    try {
      setSelectedRequestId(id);
      setIsAccessLoading(true);
      setAccessMessage('');
      const res = await api<{ items: ChatMessage[] }>(
        `/chat-break-glass/requests/${id}/messages?limit=50`,
      );
      setAccessItems(Array.isArray(res.items) ? res.items : []);
      setAccessMessage('取得しました');
    } catch (err) {
      console.error('break-glass閲覧に失敗しました', err);
      setAccessItems([]);
      setAccessMessage('閲覧に失敗しました');
    } finally {
      setIsAccessLoading(false);
    }
  };

  useEffect(() => {
    if (disabledReason) return;
    loadRequests().catch(() => undefined);
  }, [disabledReason, loadRequests]);

  return (
    <div>
      <h2>Chat break-glass（監査閲覧）</h2>
      {disabledReason ? (
        <p style={{ color: '#6b7280' }}>{disabledReason}</p>
      ) : (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button
              className="button secondary"
              onClick={loadRequests}
              disabled={isLoading}
            >
              {isLoading ? '読み込み中...' : '再読込'}
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600 }}>申請</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input
                aria-label="breakglass-projectId"
                type="text"
                value={form.projectId}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, projectId: e.target.value }))
                }
                placeholder="projectId（任意。project対象の場合）"
                style={{ minWidth: 320 }}
              />
              <input
                aria-label="breakglass-roomId"
                type="text"
                value={form.roomId}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, roomId: e.target.value }))
                }
                placeholder="roomId（任意。room対象は後続）"
                style={{ minWidth: 320 }}
              />
            </div>
            <div
              className="row"
              style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}
            >
              <input
                aria-label="breakglass-viewerUserId"
                type="text"
                value={form.viewerUserId}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, viewerUserId: e.target.value }))
                }
                placeholder="viewerUserId（空なら自分）"
                style={{ minWidth: 320 }}
              />
              <select
                aria-label="breakglass-reasonCode"
                value={form.reasonCode}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, reasonCode: e.target.value }))
                }
              >
                {reasonCodes.map((code) => (
                  <option key={code.value} value={code.value}>
                    {code.label}
                  </option>
                ))}
              </select>
              <input
                aria-label="breakglass-ttlHours"
                type="number"
                min={1}
                max={168}
                value={form.ttlHours}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, ttlHours: e.target.value }))
                }
                placeholder="ttlHours"
                style={{ width: 120 }}
              />
            </div>
            <div
              className="row"
              style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}
            >
              <input
                aria-label="breakglass-targetFrom"
                type="text"
                value={form.targetFrom}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, targetFrom: e.target.value }))
                }
                placeholder="targetFrom（ISO日時・任意）"
                style={{ minWidth: 240 }}
              />
              <input
                aria-label="breakglass-targetUntil"
                type="text"
                value={form.targetUntil}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, targetUntil: e.target.value }))
                }
                placeholder="targetUntil（ISO日時・任意）"
                style={{ minWidth: 240 }}
              />
            </div>
            <textarea
              aria-label="breakglass-reasonText"
              value={form.reasonText}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, reasonText: e.target.value }))
              }
              placeholder="reasonText（必須）"
              style={{ width: '100%', minHeight: 80, marginTop: 8 }}
            />
            <div style={{ marginTop: 8 }}>
              <button
                className="button"
                onClick={createRequest}
                disabled={isCreating}
              >
                {isCreating ? '申請中...' : '申請'}
              </button>
            </div>
          </div>

          {(message || error) && (
            <p style={{ color: error ? '#dc2626' : '#16a34a' }}>
              {error || message}
            </p>
          )}

          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600 }}>一覧</div>
            <ul className="list">
              {requests.map((req) => (
                <li key={req.id}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="badge">{req.status}</span>
                    <span className="badge">{req.reasonCode}</span>
                    {req.projectId && (
                      <span className="badge">{req.projectId}</span>
                    )}
                    {req.roomId && <span className="badge">{req.roomId}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                    申請者: {req.requesterUserId} / 閲覧者: {req.viewerUserId} /
                    作成: {formatDateTime(req.createdAt)}
                    {req.expiresAt
                      ? ` / 期限: ${formatDateTime(req.expiresAt)}`
                      : ''}
                  </div>
                  <div
                    className="row"
                    style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}
                  >
                    <button
                      className="button secondary"
                      onClick={() => approveRequest(req.id)}
                      disabled={req.status !== 'requested'}
                    >
                      承認
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => rejectRequest(req.id)}
                      disabled={req.status !== 'requested'}
                    >
                      却下
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => accessMessages(req.id)}
                      disabled={req.status !== 'approved'}
                    >
                      閲覧
                    </button>
                  </div>
                </li>
              ))}
              {requests.length === 0 && <li>申請なし</li>}
            </ul>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600 }}>閲覧（MVP: project対象のみ）</div>
            {selectedRequestId && (
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                requestId: {selectedRequestId}
              </div>
            )}
            {accessMessage && (
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                {accessMessage}
              </div>
            )}
            {isAccessLoading && <div>読み込み中...</div>}
            {accessItems.length > 0 && (
              <ul className="list">
                {accessItems.map((item) => (
                  <li key={item.id}>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      {item.userId} / {formatDateTime(item.createdAt)}
                    </div>
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                      {item.body}
                    </ReactMarkdown>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
};
