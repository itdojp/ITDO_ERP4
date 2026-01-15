import React, { useMemo, useState } from 'react';
import { api, apiResponse } from '../api';
import { Alert, Button, Card, EmptyState, Input, Select } from '../ui';
import { downloadResponseAsFile } from '../utils/download';

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
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const query = useMemo(() => buildQuery(filters), [filters]);

  const loadLogs = async () => {
    try {
      setIsLoading(true);
      setMessage('');
      const res = await api<{ items: AuditLogItem[] }>(
        `/audit-logs?${query}`,
      );
      setItems(res.items || []);
    } catch (err) {
      setItems([]);
      setMessage('監査ログの取得に失敗しました');
    } finally {
      setIsLoading(false);
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
      const fallbackName = `audit-logs-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      await downloadResponseAsFile(res, fallbackName);
    } catch (err) {
      setMessage('CSV出力に失敗しました');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div>
      <h2>監査ログ</h2>
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
          onChange={(e) => setFilters({ ...filters, from: e.target.value })}
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
          onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
        />
        <Input
          label="action"
          value={filters.action}
          onChange={(e) => setFilters({ ...filters, action: e.target.value })}
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
          onChange={(e) => setFilters({ ...filters, targetId: e.target.value })}
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
          onChange={(e) => setFilters({ ...filters, source: e.target.value })}
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
          onChange={(e) => setFilters({ ...filters, limit: e.target.value })}
        >
          {['50', '100', '200', '500', '1000'].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <div className="row" style={{ gap: 8 }}>
          <Button onClick={loadLogs} loading={isLoading}>
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
      </div>
      {message && (
        <div style={{ marginTop: 8 }}>
          <Alert variant="error">{message}</Alert>
        </div>
      )}
      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {items.map((item) => (
          <Card key={item.id} padding="small">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{item.action}</strong>{' '}
                {item.targetTable ? `(${item.targetTable})` : ''}
              </div>
              <span className="badge">{formatDateTime(item.createdAt)}</span>
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 6 }}>
              user: {item.userId || '-'} / target: {item.targetId || '-'}
            </div>
            <div style={{ fontSize: 12, color: '#475569' }}>
              role: {item.actorRole || '-'} / group: {item.actorGroupId || '-'}
            </div>
            <div style={{ fontSize: 12, color: '#475569' }}>
              reason: {item.reasonCode || '-'} {item.reasonText || ''}
            </div>
            <div style={{ fontSize: 12, color: '#475569' }}>
              source: {item.source || '-'} / requestId: {item.requestId || '-'}
            </div>
            <div style={{ fontSize: 12, color: '#475569' }}>
              metadata: {formatMetadata(item.metadata)}
            </div>
          </Card>
        ))}
        {items.length === 0 && <EmptyState title="監査ログなし" />}
      </div>
    </div>
  );
};
