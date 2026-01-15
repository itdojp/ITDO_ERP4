import React, { useMemo, useState } from 'react';
import { api, apiResponse } from '../api';
import { Alert, Button, Card, EmptyState } from '../ui';
import { downloadResponseAsFile, formatDateForFilename } from '../utils/download';

type AccessReviewUser = {
  id: string;
  userName: string;
  displayName?: string | null;
  department?: string | null;
  active?: boolean | null;
};

type AccessReviewGroup = {
  id: string;
  displayName: string;
  active?: boolean | null;
};

type AccessReviewMembership = {
  userId: string;
  groupId: string;
};

type AccessReviewSnapshot = {
  users: AccessReviewUser[];
  groups: AccessReviewGroup[];
  memberships: AccessReviewMembership[];
};

export const AccessReviews: React.FC = () => {
  const [snapshot, setSnapshot] = useState<AccessReviewSnapshot | null>(null);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const membershipCountMap = useMemo(() => {
    const map = new Map<string, number>();
    snapshot?.memberships.forEach((member) => {
      map.set(member.userId, (map.get(member.userId) || 0) + 1);
    });
    return map;
  }, [snapshot]);

  const visibleUsers = snapshot?.users.slice(0, 20) || [];
  const hasMoreUsers = (snapshot?.users.length || 0) > visibleUsers.length;

  const loadSnapshot = async () => {
    try {
      setIsLoading(true);
      setMessage('');
      const data = await api<AccessReviewSnapshot>(
        '/access-reviews/snapshot?format=json',
      );
      setSnapshot(data);
      setFetchedAt(new Date().toISOString());
    } catch (err) {
      setSnapshot(null);
      setMessage('アクセス棚卸しの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const downloadCsv = async () => {
    try {
      setIsDownloading(true);
      setMessage('');
      const res = await apiResponse('/access-reviews/snapshot?format=csv');
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const fallbackName = `access-review-${formatDateForFilename()}.csv`;
      await downloadResponseAsFile(res, fallbackName);
    } catch (err) {
      setMessage('CSV出力に失敗しました');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div>
      <h2>アクセス棚卸し</h2>
      <div className="row" style={{ alignItems: 'center' }}>
        <Button onClick={loadSnapshot} loading={isLoading}>
          スナップショット取得
        </Button>
        <Button
          variant="secondary"
          onClick={downloadCsv}
          loading={isDownloading}
        >
          CSV出力
        </Button>
        {fetchedAt && (
          <span className="badge">
            取得: {fetchedAt.replace('T', ' ').slice(0, 16)}
          </span>
        )}
      </div>
      {message && (
        <div style={{ marginTop: 8 }}>
          <Alert variant="error">{message}</Alert>
        </div>
      )}
      {!snapshot && !message && (
        <div style={{ marginTop: 12 }}>
          <EmptyState title="スナップショット未取得" />
        </div>
      )}
      {snapshot && (
        <div style={{ marginTop: 12 }}>
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            <span className="badge">users: {snapshot.users.length}</span>
            <span className="badge">groups: {snapshot.groups.length}</span>
            <span className="badge">
              memberships: {snapshot.memberships.length}
            </span>
            {hasMoreUsers && (
              <span className="badge">上位20件を表示</span>
            )}
          </div>
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            {visibleUsers.map((user) => (
              <Card key={user.id} padding="small">
                <div
                  className="row"
                  style={{ justifyContent: 'space-between' }}
                >
                  <div>
                    <strong>{user.userName}</strong>{' '}
                    {user.displayName ? `(${user.displayName})` : ''}
                    <div style={{ fontSize: 12, color: '#475569' }}>
                      {user.department || '部門未設定'} / グループ数{' '}
                      {membershipCountMap.get(user.id) || 0}
                    </div>
                  </div>
                  <span className="badge">
                    {user.active === false ? 'inactive' : 'active'}
                  </span>
                </div>
              </Card>
            ))}
            {visibleUsers.length === 0 && <EmptyState title="ユーザなし" />}
          </div>
        </div>
      )}
    </div>
  );
};
