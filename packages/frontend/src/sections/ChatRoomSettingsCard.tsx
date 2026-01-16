import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';

type ChatRoom = {
  id: string;
  type: string;
  name: string;
  isOfficial?: boolean | null;
  projectCode?: string | null;
  projectName?: string | null;
  groupId?: string | null;
  allowExternalUsers?: boolean | null;
  allowExternalIntegrations?: boolean | null;
};

function parseUserIds(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatRoomLabel(room: ChatRoom) {
  if (room.type === 'project') {
    if (room.projectCode && room.projectName) {
      return `${room.projectCode} / ${room.projectName}`;
    }
    if (room.projectCode) return room.projectCode;
  }
  if (room.type === 'department' && room.groupId) {
    return `${room.name} (${room.groupId})`;
  }
  return room.name;
}

export const ChatRoomSettingsCard: React.FC = () => {
  const auth = getAuthState();
  const roles = auth?.roles || [];
  const canManage = roles.includes('admin') || roles.includes('mgmt');

  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [roomId, setRoomId] = useState('');
  const [allowExternalUsers, setAllowExternalUsers] = useState(false);
  const [allowExternalIntegrations, setAllowExternalIntegrations] =
    useState(false);
  const [memberUserIds, setMemberUserIds] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === roomId) || null,
    [rooms, roomId],
  );

  const officialRooms = useMemo(() => {
    return rooms.filter((room) => room.isOfficial !== false);
  }, [rooms]);

  const load = useCallback(
    async (options?: { keepMessage?: boolean }) => {
      setIsLoading(true);
      if (!options?.keepMessage) {
        setMessage('');
      }
      try {
        const res = await api<{ items?: ChatRoom[] }>('/chat-rooms');
        const items = Array.isArray(res.items) ? res.items : [];
        const sorted = items
          .slice()
          .sort((a, b) =>
            `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`),
          );
        setRooms(sorted);
        if (!roomId && sorted.length) {
          const firstOfficial = sorted.find(
            (room) => room.isOfficial !== false,
          );
          setRoomId(firstOfficial?.id || sorted[0].id);
        }
      } catch (err) {
        console.error('Failed to load chat rooms.', err);
        setRooms([]);
        setMessage('ルーム一覧の取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    },
    [roomId],
  );

  const save = useCallback(async () => {
    if (!roomId) return;
    setIsLoading(true);
    setMessage('');
    try {
      await api(`/chat-rooms/${roomId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          allowExternalUsers,
          allowExternalIntegrations,
        }),
      });
      setMessage('保存しました');
      await load({ keepMessage: true });
    } catch (err) {
      console.error('Failed to update room settings.', err);
      setMessage('保存に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [allowExternalIntegrations, allowExternalUsers, load, roomId]);

  const addMembers = useCallback(async () => {
    if (!roomId) return;
    const userIds = parseUserIds(memberUserIds);
    if (!userIds.length) {
      setMessage('追加するユーザIDを入力してください');
      return;
    }
    setIsLoading(true);
    setMessage('');
    try {
      await api(`/chat-rooms/${roomId}/members`, {
        method: 'POST',
        body: JSON.stringify({ userIds }),
      });
      setMemberUserIds('');
      setMessage('メンバーを追加しました');
      await load({ keepMessage: true });
    } catch (err) {
      console.error('Failed to add room members.', err);
      setMessage('メンバー追加に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [load, memberUserIds, roomId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (!selectedRoom) return;
    setAllowExternalUsers(selectedRoom.allowExternalUsers === true);
    setAllowExternalIntegrations(
      selectedRoom.allowExternalIntegrations === true,
    );
  }, [selectedRoom]);

  if (!canManage) {
    return (
      <div className="card" style={{ padding: 12 }}>
        <strong>チャットルーム設定</strong>
        <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
          admin/mgmt のみ操作できます
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 12 }}>
      <strong>チャットルーム設定</strong>
      <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
        公式ルームの外部ユーザ許可/外部連携許可（MVP）
      </div>
      {message && <div style={{ marginTop: 8 }}>{message}</div>}
      <div className="row" style={{ marginTop: 8, gap: 12, flexWrap: 'wrap' }}>
        <label>
          ルーム
          <select
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            disabled={isLoading}
          >
            <option value="">(未選択)</option>
            {officialRooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.type}: {formatRoomLabel(room)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary"
          onClick={() => load()}
          disabled={isLoading}
        >
          再読込
        </button>
      </div>

      {selectedRoom && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#475569' }}>
          <div>
            roomId: <code>{selectedRoom.id}</code>
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: 8, gap: 12, flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={allowExternalUsers}
            onChange={(e) => setAllowExternalUsers(e.target.checked)}
            disabled={!roomId || isLoading}
          />
          外部ユーザ参加を許可
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={allowExternalIntegrations}
            onChange={(e) => setAllowExternalIntegrations(e.target.checked)}
            disabled={!roomId || isLoading}
          />
          外部連携を許可
        </label>
        <button
          className="button"
          onClick={save}
          disabled={!roomId || isLoading}
        >
          保存
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>メンバー追加（外部ユーザ向け）</strong>
        <div
          className="row"
          style={{ gap: 12, flexWrap: 'wrap', marginTop: 8 }}
        >
          <label>
            userId（comma separated）
            <input
              type="text"
              value={memberUserIds}
              onChange={(e) => setMemberUserIds(e.target.value)}
              placeholder="external-1@example.com,external-2@example.com"
              disabled={!roomId || isLoading}
            />
          </label>
          <button
            className="button secondary"
            onClick={addMembers}
            disabled={!roomId || isLoading}
          >
            メンバー追加
          </button>
        </div>
      </div>
    </div>
  );
};
