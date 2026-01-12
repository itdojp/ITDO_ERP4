import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

type ChatSetting = {
  id: string;
  allowUserPrivateGroupCreation?: boolean | null;
  allowDmCreation?: boolean | null;
};

export const ChatSettingsCard: React.FC = () => {
  const [allowUserPrivateGroupCreation, setAllowUserPrivateGroupCreation] =
    useState(true);
  const [allowDmCreation, setAllowDmCreation] = useState(true);
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
        }),
      });
      setMessage('保存しました');
    } catch (err) {
      console.error('Failed to update chat settings.', err);
      setMessage('保存に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [allowDmCreation, allowUserPrivateGroupCreation]);

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
