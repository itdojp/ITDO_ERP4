import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

type ChatSetting = {
  id: string;
  allowUserPrivateGroupCreation?: boolean | null;
  allowDmCreation?: boolean | null;
  ackMaxRequiredUsers?: number | null;
  ackMaxRequiredGroups?: number | null;
  ackMaxRequiredRoles?: number | null;
};

export const ChatSettingsCard: React.FC = () => {
  const [allowUserPrivateGroupCreation, setAllowUserPrivateGroupCreation] =
    useState(true);
  const [allowDmCreation, setAllowDmCreation] = useState(true);
  const [ackMaxRequiredUsers, setAckMaxRequiredUsers] = useState(50);
  const [ackMaxRequiredGroups, setAckMaxRequiredGroups] = useState(20);
  const [ackMaxRequiredRoles, setAckMaxRequiredRoles] = useState(20);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setMessage('');
    try {
      const res = await api<ChatSetting>('/chat-settings');
      setAllowUserPrivateGroupCreation(
        res.allowUserPrivateGroupCreation !== false,
      );
      setAllowDmCreation(res.allowDmCreation !== false);
      setAckMaxRequiredUsers(
        typeof res.ackMaxRequiredUsers === 'number'
          ? res.ackMaxRequiredUsers
          : 50,
      );
      setAckMaxRequiredGroups(
        typeof res.ackMaxRequiredGroups === 'number'
          ? res.ackMaxRequiredGroups
          : 20,
      );
      setAckMaxRequiredRoles(
        typeof res.ackMaxRequiredRoles === 'number'
          ? res.ackMaxRequiredRoles
          : 20,
      );
    } catch (err) {
      console.error('Failed to load chat settings.', err);
      setMessage('チャット設定の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const save = useCallback(async () => {
    setIsLoading(true);
    setMessage('');
    try {
      await api<ChatSetting>('/chat-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowUserPrivateGroupCreation,
          allowDmCreation,
          ackMaxRequiredUsers,
          ackMaxRequiredGroups,
          ackMaxRequiredRoles,
        }),
      });
      setMessage('保存しました');
    } catch (err) {
      console.error('Failed to update chat settings.', err);
      setMessage('保存に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [
    allowDmCreation,
    allowUserPrivateGroupCreation,
    ackMaxRequiredUsers,
    ackMaxRequiredGroups,
    ackMaxRequiredRoles,
  ]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  return (
    <div className="card" style={{ padding: 12 }}>
      <strong>チャット設定</strong>
      <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
        private_group / DM の作成可否（MVP）
      </div>
      {message && <div style={{ marginTop: 8 }}>{message}</div>}
      <div className="row" style={{ marginTop: 8, gap: 12, flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={allowUserPrivateGroupCreation}
            onChange={(e) => setAllowUserPrivateGroupCreation(e.target.checked)}
            disabled={isLoading}
          />
          user/hr の private_group 作成を許可
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={allowDmCreation}
            onChange={(e) => setAllowDmCreation(e.target.checked)}
            disabled={isLoading}
          />
          DM 作成を許可
        </label>
        <label className="row" style={{ gap: 6 }}>
          ack required 最大対象者数
          <input
            type="number"
            min={1}
            max={200}
            value={ackMaxRequiredUsers}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next)) return;
              setAckMaxRequiredUsers(next);
            }}
            disabled={isLoading}
            style={{ width: 90 }}
          />
        </label>
        <label className="row" style={{ gap: 6 }}>
          最大グループ数
          <input
            type="number"
            min={1}
            max={200}
            value={ackMaxRequiredGroups}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next)) return;
              setAckMaxRequiredGroups(next);
            }}
            disabled={isLoading}
            style={{ width: 80 }}
          />
        </label>
        <label className="row" style={{ gap: 6 }}>
          最大ロール数
          <input
            type="number"
            min={1}
            max={200}
            value={ackMaxRequiredRoles}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next)) return;
              setAckMaxRequiredRoles(next);
            }}
            disabled={isLoading}
            style={{ width: 80 }}
          />
        </label>
        <button className="button" onClick={save} disabled={isLoading}>
          保存
        </button>
        <button
          className="button secondary"
          onClick={load}
          disabled={isLoading}
        >
          再読込
        </button>
      </div>
    </div>
  );
};
