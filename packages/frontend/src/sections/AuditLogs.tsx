import React, { useMemo, useState } from 'react';
import { api, apiResponse } from '../api';
import {
  Alert,
  AsyncStatePanel,
  Button,
  CrudList,
  DataTable,
  FilterBar,
  Input,
  Select,
  StatusBadge,
  erpStatusDictionary,
} from '../ui';
import type { DataTableColumn, DataTableRow } from '../ui';
import {
  downloadResponseAsFile,
  formatDateForFilename,
} from '../utils/download';

type AuditLogItem = {
  id: string;
  action: string;
  userId?: string | null;
  actorRole?: string | null;
  actorGroupId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  source?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
  targetTable?: string | null;
  targetId?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};

type FilterState = {
  from: string;
  to: string;
  userId: string;
  action: string;
  targetTable: string;
  targetId: string;
  reasonCode: string;
  reasonText: string;
  source: string;
  actorRole: string;
  actorGroupId: string;
  requestId: string;
  limit: string;
  format: 'json' | 'csv';
};

const buildQuery = (filters: FilterState) => {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.action) params.set('action', filters.action);
  if (filters.targetTable) params.set('targetTable', filters.targetTable);
  if (filters.targetId) params.set('targetId', filters.targetId);
  if (filters.reasonCode) params.set('reasonCode', filters.reasonCode);
  if (filters.reasonText) params.set('reasonText', filters.reasonText);
  if (filters.source) params.set('source', filters.source);
  if (filters.actorRole) params.set('actorRole', filters.actorRole);
  if (filters.actorGroupId) params.set('actorGroupId', filters.actorGroupId);
  if (filters.requestId) params.set('requestId', filters.requestId);
  if (filters.limit) params.set('limit', filters.limit);
  params.set('format', filters.format);
  return params.toString();
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatMetadata = (value: Record<string, unknown> | null | undefined) => {
  if (!value) return '-';
  try {
    return JSON.stringify(value);
  } catch {
    return '-';
  }
};

export const AuditLogs: React.FC = () => {
  const [filters, setFilters] = useState<FilterState>({
    from: '',
    to: '',
    userId: '',
    action: '',
    targetTable: '',
    targetId: '',
    reasonCode: '',
    reasonText: '',
    source: '',
    actorRole: '',
    actorGroupId: '',
    requestId: '',
    limit: '200',
    format: 'json',
  });
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [listStatus, setListStatus] = useState<
    'idle' | 'loading' | 'error' | 'success'
  >('idle');
  const [listError, setListError] = useState('');
  const [message, setMessage] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);

  const query = useMemo(() => buildQuery(filters), [filters]);

  const loadLogs = async () => {
    try {
      setListStatus('loading');
      setListError('');
      setMessage('');
      const res = await api<{ items: AuditLogItem[] }>(`/audit-logs?${query}`);
      setItems(res.items || []);
      setListStatus('success');
    } catch (err) {
      setItems([]);
      setListStatus('error');
      setListError('監査ログの取得に失敗しました');
    }
  };

  const downloadCsv = async () => {
    try {
      setIsDownloading(true);
      setMessage('');
      const csvQuery = buildQuery({ ...filters, format: 'csv' });
      const res = await apiResponse(`/audit-logs?${csvQuery}`);
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const fallbackName = `audit-logs-${formatDateForFilename()}.csv`;
      await downloadResponseAsFile(res, fallbackName);
    } catch (err) {
      setMessage('CSV出力に失敗しました');
    } finally {
      setIsDownloading(false);
    }
  };

  const rows = useMemo<DataTableRow[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        createdAt: formatDateTime(item.createdAt),
        action: item.action,
        user: item.userId || '-',
        target: `${item.targetTable || '-'} / ${item.targetId || '-'}`,
        roleGroup: `${item.actorRole || '-'} / ${item.actorGroupId || '-'}`,
        reason: `${item.reasonCode || '-'} ${item.reasonText || ''}`.trim(),
        sourceRequest: `${item.source || '-'} / ${item.requestId || '-'}`,
        metadata: formatMetadata(item.metadata),
      })),
    [items],
  );

  const columns = useMemo<DataTableColumn[]>(
    () => [
      { key: 'createdAt', header: '日時' },
      {
        key: 'action',
        header: '操作',
        cell: (row) => (
          <StatusBadge
            status={String(row.action || '')}
            dictionary={erpStatusDictionary}
            size="sm"
          />
        ),
      },
      { key: 'user', header: 'ユーザー' },
      { key: 'target', header: '対象' },
      { key: 'roleGroup', header: 'ロール/グループ' },
      { key: 'reason', header: '理由' },
      { key: 'sourceRequest', header: 'ソース/RequestID' },
      { key: 'metadata', header: 'metadata' },
    ],
    [],
  );

  const listContent = (() => {
    if (listStatus === 'idle' || listStatus === 'loading') {
      return <AsyncStatePanel state="loading" loadingText="監査ログを取得中" />;
    }
    if (listStatus === 'error') {
      return (
        <AsyncStatePanel
          state="error"
          error={{
            title: '監査ログの取得に失敗しました',
            detail: listError,
            onRetry: () => {
              void loadLogs();
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
            title: '監査ログなし',
            description: '条件を変更して再検索してください',
          }}
        />
      );
    }
    return <DataTable columns={columns} rows={rows} />;
  })();

  return (
    <div>
      <h2>監査ログ</h2>
      {message && (
        <div style={{ marginTop: 8 }}>
          <Alert variant="error">{message}</Alert>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <CrudList
          title="監査ログ一覧"
          description="条件を指定して監査ログを検索し、CSVを出力できます。"
          filters={
            <FilterBar
              actions={
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setFilters({
                        from: '',
                        to: '',
                        userId: '',
                        action: '',
                        targetTable: '',
                        targetId: '',
                        reasonCode: '',
                        reasonText: '',
                        source: '',
                        actorRole: '',
                        actorGroupId: '',
                        requestId: '',
                        limit: '200',
                        format: 'json',
                      });
                    }}
                  >
                    条件クリア
                  </Button>
                  <Button onClick={loadLogs} loading={listStatus === 'loading'}>
                    検索
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
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  alignItems: 'flex-end',
                }}
              >
                <Input
                  label="from"
                  type="date"
                  value={filters.from}
                  onChange={(e) =>
                    setFilters({ ...filters, from: e.target.value })
                  }
                />
                <Input
                  label="to"
                  type="date"
                  value={filters.to}
                  onChange={(e) => setFilters({ ...filters, to: e.target.value })}
                />
                <Input
                  label="userId"
                  value={filters.userId}
                  onChange={(e) =>
                    setFilters({ ...filters, userId: e.target.value })
                  }
                />
                <Input
                  label="action"
                  value={filters.action}
                  onChange={(e) =>
                    setFilters({ ...filters, action: e.target.value })
                  }
                />
                <Input
                  label="targetTable"
                  value={filters.targetTable}
                  onChange={(e) =>
                    setFilters({ ...filters, targetTable: e.target.value })
                  }
                />
                <Input
                  label="targetId"
                  value={filters.targetId}
                  onChange={(e) =>
                    setFilters({ ...filters, targetId: e.target.value })
                  }
                />
                <Input
                  label="reasonCode"
                  value={filters.reasonCode}
                  onChange={(e) =>
                    setFilters({ ...filters, reasonCode: e.target.value })
                  }
                />
                <Input
                  label="reasonText"
                  value={filters.reasonText}
                  onChange={(e) =>
                    setFilters({ ...filters, reasonText: e.target.value })
                  }
                />
                <Input
                  label="source"
                  value={filters.source}
                  onChange={(e) =>
                    setFilters({ ...filters, source: e.target.value })
                  }
                />
                <Input
                  label="actorRole"
                  value={filters.actorRole}
                  onChange={(e) =>
                    setFilters({ ...filters, actorRole: e.target.value })
                  }
                />
                <Input
                  label="actorGroupId"
                  value={filters.actorGroupId}
                  onChange={(e) =>
                    setFilters({ ...filters, actorGroupId: e.target.value })
                  }
                />
                <Input
                  label="requestId"
                  value={filters.requestId}
                  onChange={(e) =>
                    setFilters({ ...filters, requestId: e.target.value })
                  }
                />
                <Select
                  label="limit"
                  value={filters.limit}
                  onChange={(e) =>
                    setFilters({ ...filters, limit: e.target.value })
                  }
                >
                  {['50', '100', '200', '500', '1000'].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </div>
            </FilterBar>
          }
          table={listContent}
        />
      </div>
    </div>
  );
};
