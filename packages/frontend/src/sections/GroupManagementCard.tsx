import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getAuthState } from '../api';

type GroupSummary = {
  id: string;
  displayName: string;
  externalId?: string | null;
  active?: boolean | null;
  memberCount?: number | null;
  updatedAt?: string | null;
  isScimManaged?: boolean | null;
};

type GroupMember = {
  userAccountId: string;
  userId: string;
  displayName?: string | null;
  active?: boolean | null;
  deletedAt?: string | null;
};

function parseUserIds(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export const GroupManagementCard: React.FC = () => {
  const auth = getAuthState();
  const roles = auth?.roles || [];
  const canManage = roles.includes('admin') || roles.includes('mgmt');

  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupId, setGroupId] = useState('');
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [createName, setCreateName] = useState('');
  const [createActive, setCreateActive] = useState(true);
  const [createMembers, setCreateMembers] = useState('');

  const [editName, setEditName] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [addMembers, setAddMembers] = useState('');
  const [removeMembers, setRemoveMembers] = useState('');

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === groupId) || null,
    [groups, groupId],
  );

  const loadGroups = useCallback(async () => {
    setIsLoading(true);
    setMessage('');
    try {
      const res = await api<{ items?: GroupSummary[] }>('/groups');
      const items = Array.isArray(res.items) ? res.items : [];
      setGroups(items);
      if (!groupId && items.length) {
        setGroupId(items[0].id);
      }
    } catch (err) {
      console.error('Failed to load groups.', err);
      setGroups([]);
      setMessage('グループ一覧の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [groupId]);

  const loadMembers = useCallback(async (targetGroupId: string) => {
    setIsLoading(true);
    setMessage('');
    try {
      const res = await api<{ items?: GroupMember[] }>(
        `/groups/${targetGroupId}/members`,
      );
      setMembers(Array.isArray(res.items) ? res.items : []);
    } catch (err) {
      console.error('Failed to load group members.', err);
      setMembers([]);
      setMessage('グループメンバーの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    const displayName = createName.trim();
    if (!displayName) {
      setMessage('表示名を入力してください');
      return;
    }
    setIsLoading(true);
    setMessage('');
    try {
      const res = await api<{ id?: string }>('/groups', {
        method: 'POST',
        body: JSON.stringify({
          displayName,
          active: createActive,
          userIds: parseUserIds(createMembers),
        }),
      });
      setCreateName('');
      setCreateMembers('');
      setCreateActive(true);
      await loadGroups();
      if (res.id) {
        setGroupId(res.id);
      }
      setMessage('グループを作成しました');
    } catch (err) {
      console.error('Failed to create group.', err);
      setMessage('グループ作成に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [createActive, createMembers, createName, loadGroups]);

  const handleUpdate = useCallback(async () => {
    if (!groupId) return;
    const displayName = editName.trim();
    if (!displayName) {
      setMessage('表示名を入力してください');
      return;
    }
    setIsLoading(true);
    setMessage('');
    try {
      await api(`/groups/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify({ displayName, active: editActive }),
      });
      await loadGroups();
      setMessage('グループを更新しました');
    } catch (err) {
      console.error('Failed to update group.', err);
      setMessage('グループ更新に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [editActive, editName, groupId, loadGroups]);

  const handleAddMembers = useCallback(async () => {
    if (!groupId) return;
    const userIds = parseUserIds(addMembers);
    if (!userIds.length) {
      setMessage('追加するユーザIDを入力してください');
      return;
    }
    setIsLoading(true);
    setMessage('');
    try {
      await api(`/groups/${groupId}/members`, {
        method: 'POST',
        body: JSON.stringify({ userIds }),
      });
      setAddMembers('');
      await loadMembers(groupId);
      setMessage('メンバーを追加しました');
    } catch (err) {
      console.error('Failed to add group members.', err);
      setMessage('メンバー追加に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [addMembers, groupId, loadMembers]);

  const handleRemoveMembers = useCallback(async () => {
    if (!groupId) return;
    const userIds = parseUserIds(removeMembers);
    if (!userIds.length) {
      setMessage('削除するユーザIDを入力してください');
      return;
    }
    setIsLoading(true);
    setMessage('');
    try {
      await api(`/groups/${groupId}/members`, {
        method: 'DELETE',
        body: JSON.stringify({ userIds }),
      });
      setRemoveMembers('');
      await loadMembers(groupId);
      setMessage('メンバーを削除しました');
    } catch (err) {
      console.error('Failed to remove group members.', err);
      setMessage('メンバー削除に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [groupId, loadMembers, removeMembers]);

  useEffect(() => {
    loadGroups().catch(() => undefined);
  }, [loadGroups]);

  useEffect(() => {
    if (!selectedGroup) return;
    setEditName(selectedGroup.displayName);
    setEditActive(selectedGroup.active !== false);
    loadMembers(selectedGroup.id).catch(() => undefined);
  }, [loadMembers, selectedGroup]);

  if (!canManage) {
    return (
      <div className="card" style={{ padding: 12 }}>
        <strong>グループ管理</strong>
        <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
          admin/mgmt のみ操作できます
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 12 }}>
      <strong>グループ管理</strong>
      <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
        SCIM 同期以外のグループ作成/メンバー管理
      </div>
      {message && <div style={{ marginTop: 8 }}>{message}</div>}
      <div style={{ marginTop: 8, display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontWeight: 600 }}>新規グループ</div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <label>
              表示名
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                disabled={isLoading}
              />
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={createActive}
                onChange={(e) => setCreateActive(e.target.checked)}
                disabled={isLoading}
              />
              有効
            </label>
            <label style={{ minWidth: 260, flex: '1 1 260px' }}>
              初期メンバー（userId, 区切り）
              <input
                type="text"
                value={createMembers}
                onChange={(e) => setCreateMembers(e.target.value)}
                placeholder="user-a, user-b"
                disabled={isLoading}
              />
            </label>
            <button
              className="button"
              onClick={handleCreate}
              disabled={isLoading}
            >
              作成
            </button>
          </div>
        </div>
        <div
          style={{
            borderTop: '1px solid #e2e8f0',
            paddingTop: 12,
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontWeight: 600 }}>既存グループ</div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <label>
              グループ
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                disabled={isLoading}
              >
                <option value="">(未選択)</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.displayName} ({group.memberCount ?? 0})
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button secondary"
              onClick={() => loadGroups()}
              disabled={isLoading}
            >
              再読込
            </button>
          </div>
          {selectedGroup && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 12, color: '#475569' }}>
                id: {selectedGroup.id} / 更新:{' '}
                {formatDateTime(selectedGroup.updatedAt)}
                {selectedGroup.externalId &&
                  ` / externalId: ${selectedGroup.externalId}`}
                {selectedGroup.isScimManaged ? ' / SCIM管理' : ''}
              </div>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <label>
                  表示名
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    disabled={isLoading}
                  />
                </label>
                <label
                  style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                >
                  <input
                    type="checkbox"
                    checked={editActive}
                    onChange={(e) => setEditActive(e.target.checked)}
                    disabled={isLoading}
                  />
                  有効
                </label>
                <button
                  className="button secondary"
                  onClick={handleUpdate}
                  disabled={isLoading}
                >
                  更新
                </button>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontWeight: 600 }}>メンバー管理</div>
                <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                  <label style={{ minWidth: 260, flex: '1 1 260px' }}>
                    追加（userId, 区切り）
                    <input
                      type="text"
                      value={addMembers}
                      onChange={(e) => setAddMembers(e.target.value)}
                      placeholder="user-a, user-b"
                      disabled={isLoading}
                    />
                  </label>
                  <button
                    className="button secondary"
                    onClick={handleAddMembers}
                    disabled={isLoading}
                  >
                    追加
                  </button>
                  <label style={{ minWidth: 260, flex: '1 1 260px' }}>
                    削除（userId, 区切り）
                    <input
                      type="text"
                      value={removeMembers}
                      onChange={(e) => setRemoveMembers(e.target.value)}
                      placeholder="user-a, user-b"
                      disabled={isLoading}
                    />
                  </label>
                  <button
                    className="button secondary"
                    onClick={handleRemoveMembers}
                    disabled={isLoading}
                  >
                    削除
                  </button>
                </div>
                <div style={{ fontSize: 12, color: '#475569' }}>
                  メンバー数: {members.length}
                </div>
                {members.length === 0 && (
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    メンバーが登録されていません
                  </div>
                )}
                {members.length > 0 && (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>userId</th>
                        <th>表示名</th>
                        <th>状態</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((member) => (
                        <tr key={member.userAccountId}>
                          <td>{member.userId}</td>
                          <td>{member.displayName || '-'}</td>
                          <td>
                            {member.deletedAt
                              ? '削除済み'
                              : member.active === false
                                ? '無効'
                                : '有効'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
