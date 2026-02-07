import React, { useMemo, useState } from 'react';
import { api, apiResponse } from '../api';
import {
  Alert,
  AsyncStatePanel,
  Button,
  Card,
  CrudList,
  DataTable,
  FilterBar,
  type ListLoadStatus,
  StatusBadge,
} from '../ui';
import type { DataTableColumn, DataTableRow } from '../ui';
import {
  downloadResponseAsFile,
  formatDateForFilename,
} from '../utils/download';

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
  const [message, setMessage] = useState<{
    text: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);
  const [listStatus, setListStatus] = useState<ListLoadStatus>('idle');
  const [listError, setListError] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const membershipCountMap = useMemo(() => {
    const map = new Map<string, number>();
    snapshot?.memberships.forEach((member) => {
      map.set(member.userId, (map.get(member.userId) || 0) + 1);
    });
    return map;
  }, [snapshot]);

  const visibleUsers = useMemo(
    () => snapshot?.users.slice(0, 20) || [],
    [snapshot],
  );
  const hasMoreUsers = (snapshot?.users.length || 0) > visibleUsers.length;

  const rows = useMemo<DataTableRow[]>(
    () =>
      visibleUsers.map((user) => ({
        id: user.id,
        userName: user.userName,
        displayName: user.displayName || '-',
        department: user.department || '部門未設定',
        groupCount: membershipCountMap.get(user.id) || 0,
        active: user.active === false ? 'inactive' : 'active',
      })),
    [visibleUsers, membershipCountMap],
  );

  const columns = useMemo<DataTableColumn[]>(
    () => [
      { key: 'userName', header: 'ユーザID' },
      { key: 'displayName', header: '表示名' },
      { key: 'department', header: '部門' },
      { key: 'groupCount', header: 'グループ数' },
      {
        key: 'active',
        header: '状態',
        cell: (row) => (
          <StatusBadge
            status={String(row.active || '')}
            dictionary={{
              active: { label: 'active', tone: 'success' },
              inactive: { label: 'inactive', tone: 'neutral' },
            }}
            size="sm"
          />
        ),
      },
    ],
    [],
  );

  const loadSnapshot = async () => {
    try {
      setListStatus('loading');
      setListError('');
      setMessage(null);
      setFetchedAt(null);
      const data = await api<AccessReviewSnapshot>(
        '/access-reviews/snapshot?format=json',
      );
      setSnapshot(data);
      setFetchedAt(new Date().toISOString());
      setListStatus('success');
    } catch (err) {
      setSnapshot(null);
      setFetchedAt(null);
      setListStatus('error');
      setListError('アクセス棚卸しの取得に失敗しました');
    }
  };

  const downloadCsv = async () => {
    try {
      setIsDownloading(true);
      setMessage(null);
      const res = await apiResponse('/access-reviews/snapshot?format=csv');
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const fallbackName = `access-review-${formatDateForFilename()}.csv`;
      await downloadResponseAsFile(res, fallbackName);
      setMessage({ text: 'CSVを出力しました', type: 'success' });
    } catch (err) {
      setMessage({ text: 'CSV出力に失敗しました', type: 'error' });
    } finally {
      setIsDownloading(false);
    }
  };

  const table = (() => {
    if (listStatus === 'idle') {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title: 'スナップショット未取得',
            description: '「スナップショット取得」を実行してください',
          }}
        />
      );
    }
    if (listStatus === 'loading') {
      return (
        <AsyncStatePanel
          state="loading"
          loadingText="アクセス棚卸しスナップショットを取得中"
        />
      );
    }
    if (listStatus === 'error') {
      return (
        <AsyncStatePanel
          state="error"
          error={{
            title: 'アクセス棚卸しの取得に失敗しました',
            detail: listError,
            onRetry: () => {
              void loadSnapshot();
            },
            retryLabel: '再試行',
          }}
        />
      );
    }
    if (rows.length === 0) {
      return (
        <AsyncStatePanel
          state="empty"
          empty={{
            title: 'ユーザがありません',
          }}
        />
      );
    }
    return <DataTable columns={columns} rows={rows} />;
  })();

  return (
    <div>
      <h2>アクセス棚卸し</h2>
      <Card padding="small">
        <CrudList
          title="アクセス棚卸しスナップショット"
          description="ユーザ・グループ・メンバーシップのスナップショットを取得し、CSV出力できます。"
          filters={
            <FilterBar
              actions={
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSnapshot(null);
                      setFetchedAt(null);
                      setListStatus('idle');
                      setListError('');
                      setMessage(null);
                    }}
                  >
                    クリア
                  </Button>
                  <Button
                    onClick={loadSnapshot}
                    loading={listStatus === 'loading'}
                  >
                    スナップショット取得
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={downloadCsv}
                    loading={isDownloading}
                  >
                    CSV出力
                  </Button>
                </div>
              }
            >
              <div
                className="row"
                style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
              >
                <span className="badge">
                  users: {snapshot?.users.length ?? '-'}
                </span>
                <span className="badge">
                  groups: {snapshot?.groups.length ?? '-'}
                </span>
                <span className="badge">
                  memberships: {snapshot?.memberships.length ?? '-'}
                </span>
                {hasMoreUsers && <span className="badge">上位20件を表示</span>}
                {fetchedAt && (
                  <span className="badge">
                    取得: {fetchedAt.replace('T', ' ').slice(0, 16)}
                  </span>
                )}
              </div>
            </FilterBar>
          }
          table={table}
        />
        {message && (
          <div style={{ marginTop: 8 }}>
            <Alert
              variant={
                message.type === 'error'
                  ? 'error'
                  : message.type === 'success'
                    ? 'success'
                    : 'info'
              }
            >
              {message.text}
            </Alert>
          </div>
        )}
      </Card>
    </div>
  );
};
